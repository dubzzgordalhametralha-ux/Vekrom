#!/usr/bin/env node
/**
 * Teste de fumaça ponta a ponta (Node 22+: fetch e WebSocket nativos).
 *   node scripts/smoke.mjs https://144-33-6-56.sslip.io
 *   API_URL=http://localhost:3001 WS_URL=ws://localhost:3002 node scripts/smoke.mjs
 * Cria 3 contas descartáveis, testa o fluxo principal e as barreiras de acesso, e apaga tudo no fim.
 */
const base = process.argv[2] ?? "http://localhost:5173";
const API = process.env.API_URL ?? `${base}/api`;
const WS = process.env.WS_URL ?? `${base.replace(/^http/, "ws")}/ws`;
const tag = `smk${Date.now().toString(36)}`;
const PASSWORD = `Sm0ke-${Math.random().toString(36).slice(2)}!`;

let failures = 0;
const results = [];
function check(name, ok, info = "") {
  results.push({ name, ok });
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${info ? `  (${info})` : ""}`);
}

async function call(method, path, { token, body, headers = {}, raw } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body && !raw ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* sem corpo */
  }
  return { status: res.status, data, headers: res.headers };
}

/** Abre o gateway, identifica e coleta eventos. */
function gateway(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const events = [];
    const waiters = [];
    ws.onmessage = (m) => {
      const evt = JSON.parse(m.data);
      events.push(evt);
      for (const w of [...waiters]) if (w.match(evt)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(evt);
      }
    };
    ws.onerror = () => reject(new Error("ws error"));
    const api = {
      ws,
      events,
      send: (t, d) => ws.send(JSON.stringify({ t, d })),
      wait: (match, ms = 5000) =>
        new Promise((res) => {
          const hit = events.find(match);
          if (hit) return res(hit);
          const w = { match, resolve: res };
          waiters.push(w);
          setTimeout(() => {
            const i = waiters.indexOf(w);
            if (i >= 0) waiters.splice(i, 1), res(null);
          }, ms);
        }),
    };
    ws.onopen = async () => {
      api.send("IDENTIFY", { token });
      const ready = await api.wait((e) => e.t === "READY");
      ready ? resolve(api) : reject(new Error("sem READY"));
    };
  });
}

// PNG 1x1 válido.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const users = {};
try {
  const h = await call("GET", "/health");
  check("health com db e redis", h.status === 200 && h.data?.db && h.data?.redis, JSON.stringify(h.data));

  for (const who of ["a", "b", "c"]) {
    const r = await call("POST", "/auth/register", { body: { username: `${tag}_${who}`, email: `${tag}.${who}@example.com`, password: PASSWORD } });
    check(`cadastro ${who}`, r.status === 200 && r.data?.token, `HTTP ${r.status}`);
    users[who] = { token: r.data.token, id: String(r.data.user.id), email: `${tag}.${who}@example.com` };
  }
  const { a, b, c } = users;

  const login = await call("POST", "/auth/login", { body: { email: a.email, password: PASSWORD } });
  const cookie = login.headers.get("set-cookie") ?? "";
  check("login", login.status === 200 && login.data?.token);
  check("cookie de refresh httpOnly + SameSite=Strict", /HttpOnly/i.test(cookie) && /SameSite=Strict/i.test(cookie) && (!API.startsWith("https") || /Secure/i.test(cookie)), cookie.replace(/refreshToken=[^;]+/, "refreshToken=***"));
  const refreshed = await call("POST", "/auth/refresh", { headers: { cookie: cookie.split(";")[0] } });
  check("refresh rotativo", refreshed.status === 200 && refreshed.data?.token);
  const reuse = await call("POST", "/auth/refresh", { headers: { cookie: cookie.split(";")[0] } });
  check("refresh antigo não vale de novo", reuse.status === 401);
  const bad = await call("POST", "/auth/login", { body: { email: a.email, password: "errada123" } });
  check("senha errada = 401", bad.status === 401);
  check("sem token = 401", (await call("GET", "/servers")).status === 401);

  const srv = await call("POST", "/servers", { token: a.token, body: { name: `Smoke ${tag}` } });
  check("cria servidor", srv.status === 200 && srv.data?.server?.id);
  const serverId = String(srv.data.server.id);
  const chans = await call("GET", `/servers/${serverId}/channels`, { token: a.token });
  check("canais padrão (texto + voz)", chans.data?.channels?.some((x) => x.type === "text") && chans.data?.channels?.some((x) => x.type === "voice"));
  const voiceId = String(chans.data.channels.find((x) => x.type === "voice").id);
  const ch = await call("POST", `/servers/${serverId}/channels`, { token: a.token, body: { name: "Canal Smoke", type: "text" } });
  check("cria canal", ch.status === 200 && ch.data?.channel?.name === "canal-smoke", ch.data?.channel?.name);
  const channelId = String(ch.data.channel.id);

  const inv = await call("POST", `/servers/${serverId}/invites`, { token: a.token, body: {} });
  check("cria convite", inv.status === 200 && inv.data?.invite?.code);
  const preview = await call("GET", `/invites/${inv.data.invite.code}`, { token: b.token });
  check("prévia do convite", preview.data?.invite?.server?.name === `Smoke ${tag}`);
  const join = await call("POST", `/invites/${inv.data.invite.code}/join`, { token: b.token });
  check("b entra pelo convite", join.status === 200);

  const gwA = await gateway(a.token);
  const gwB = await gateway(b.token);
  const gwC = await gateway(c.token);
  check("gateway READY (a, b, c)", true);

  const sent = await call("POST", `/channels/${channelId}/messages`, { token: a.token, body: { content: "olá **mundo** <img src=x onerror=alert(1)>" } });
  check("envia mensagem", sent.status === 200 && sent.data?.message?.id);
  const got = await gwB.wait((e) => e.t === "MESSAGE_CREATE" && e.d?.message?.id === sent.data.message.id);
  check("b recebe MESSAGE_CREATE pelo WebSocket", Boolean(got));
  check("conteúdo guardado cru (o web renderiza como texto)", got?.d?.message?.content === "olá **mundo** <img src=x onerror=alert(1)>");
  const leak = await gwC.wait((e) => e.t === "MESSAGE_CREATE", 1500);
  check("c (não-membro) não recebe a mensagem", !leak);

  gwB.send("TYPING_START", { channelId });
  check("indicador digitando chega para a", Boolean(await gwA.wait((e) => e.t === "TYPING_START" && e.d?.userId === b.id)));
  gwC.send("TYPING_START", { channelId });
  check("digitando de não-membro é ignorado", !(await gwA.wait((e) => e.t === "TYPING_START" && e.d?.userId === c.id, 1500)));
  gwC.send("VOICE_STATE_UPDATE", { channelId: voiceId });
  check("não-membro não entra na voz", Boolean(await gwC.wait((e) => e.t === "ERROR" && e.d?.code === 4030)));
  gwB.send("VOICE_STATE_UPDATE", { channelId: voiceId, mute: false, deaf: false });
  check("membro entra na voz e a vê", Boolean(await gwA.wait((e) => e.t === "voice:update" && e.d?.voiceState?.userId === b.id && e.d?.voiceState?.channelId === voiceId)));
  gwB.send("VOICE_STATE_UPDATE", { channelId: null });

  const list = await call("GET", `/channels/${channelId}/messages`, { token: b.token });
  check("b lê o histórico", list.data?.items?.length === 1);
  for (const [name, r] of [
    ["c não lê mensagens", await call("GET", `/channels/${channelId}/messages`, { token: c.token })],
    ["c não escreve", await call("POST", `/channels/${channelId}/messages`, { token: c.token, body: { content: "intruso" } })],
    ["c não vê membros", await call("GET", `/servers/${serverId}/members`, { token: c.token })],
    ["c não vê canais", await call("GET", `/servers/${serverId}/channels`, { token: c.token })],
  ]) check(name, r.status === 404, `HTTP ${r.status}`);
  check("b (sem permissão) não cria canal", (await call("POST", `/servers/${serverId}/channels`, { token: b.token, body: { name: "x" } })).status === 403);
  check("b não apaga mensagem de a", (await call("DELETE", `/messages/${sent.data.message.id}`, { token: b.token })).status === 403);
  check("id inválido = 400 (não 500)", (await call("GET", `/servers/abc/channels`, { token: a.token })).status === 400);
  check("anexo com URL externa recusado", (await call("POST", `/channels/${channelId}/messages`, { token: a.token, body: { content: "x", attachments: [{ url: "https://evil.example/x.png", name: "x.png", contentType: "image/png", sizeBytes: 10 }] } })).status === 400);

  const form = new FormData();
  form.append("file", new Blob([PNG], { type: "image/png" }), "pixel.png");
  const up = await call("POST", "/upload", { token: a.token, raw: form });
  check("upload de imagem", up.status === 200 && /\/[0-9a-f-]{36}\.png$/.test(up.data?.url ?? ""), up.data?.url);
  const file = await fetch(up.data.url);
  check("arquivo servido com image/png + nosniff", file.status === 200 && file.headers.get("content-type")?.startsWith("image/png") && file.headers.get("x-content-type-options") === "nosniff");
  const withFile = await call("POST", `/channels/${channelId}/messages`, { token: a.token, body: { content: "", attachments: [{ url: up.data.url, name: "pixel.png", contentType: "image/png", sizeBytes: PNG.length }] } });
  check("mensagem com anexo", withFile.status === 200);
  const fake = new FormData();
  fake.append("file", new Blob(["<script>alert(1)</script>"], { type: "image/png" }), "x.png");
  check("upload disfarçado (texto como .png) = 415", (await call("POST", "/upload", { token: a.token, raw: fake })).status === 415);
  // Atrás do Caddy o caminho é normalizado e cai no index.html do app; direto na API, 404. Nunca o arquivo.
  const travBody = await (await fetch(`${API}/files/..%2F..%2F.env`)).text();
  check("path traversal em /files não vaza arquivo", !/DATABASE_URL|JWT_SECRET/.test(travBody));

  const dm = await call("POST", `/dms/${b.id}/messages`, { token: a.token, body: { content: "oi b" } });
  check("DM entre quem divide servidor", dm.status === 200);
  check("b recebe DM_CREATE", Boolean(await gwB.wait((e) => e.t === "DM_CREATE" && e.d?.message?.id === dm.data?.message?.id)));
  check("c não manda DM para a (sem vínculo)", (await call("POST", `/dms/${a.id}/messages`, { token: c.token, body: { content: "spam" } })).status === 403);
  const fr = await call("POST", "/friends", { token: c.token, body: { username: `${tag}_a` } });
  check("pedido de amizade", fr.status === 200);
  const friendsA = await call("GET", "/friends", { token: a.token });
  const req = friendsA.data?.friends?.find((f) => f.direction === "incoming");
  check("a vê o pedido", Boolean(req));
  check("a aceita", (await call("POST", `/friends/${req.id}/accept`, { token: a.token })).status === 200);
  check("amigos podem trocar DM", (await call("POST", `/dms/${a.id}/messages`, { token: c.token, body: { content: "agora sim" } })).status === 200);

  const kick = await call("POST", `/servers/${serverId}/members/${b.id}/moderation`, { token: a.token, body: { action: "kick" } });
  check("dono expulsa b", kick.status === 200);
  check("b expulso não lê mais", (await call("GET", `/channels/${channelId}/messages`, { token: b.token })).status === 404);

  for (const g of [gwA, gwB, gwC]) g.ws.close();
} catch (err) {
  check("execução sem exceção", false, err.message);
} finally {
  for (const [who, u] of Object.entries(users)) {
    const r = await call("DELETE", "/users/@me", { token: u.token, body: { password: PASSWORD } }).catch(() => ({ status: 0 }));
    check(`limpeza: conta ${who} apagada`, r.status === 200);
  }
  console.log(`\n${results.length - failures}/${results.length} passaram`);
  process.exit(failures ? 1 : 0);
}
