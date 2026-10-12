const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" });
const short = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

export function fmtTime(iso: string) {
  return time.format(new Date(iso));
}

export function fmtDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Hoje";
  if (d.toDateString() === yesterday.toDateString()) return "Ontem";
  return day.format(d);
}

/** "14:02", "Ontem 14:02" ou "12/10 14:02". */
export function fmtStamp(iso: string) {
  const d = new Date(iso);
  const label = fmtDay(iso);
  if (label === "Hoje") return time.format(d);
  if (label === "Ontem") return `Ontem ${time.format(d)}`;
  return `${short.format(d)} ${time.format(d)}`;
}

export function sameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Cor estável por id (avatar sem foto, ícone de servidor). */
export function hueOf(id: string) {
  // Ângulo áureo: ids sequenciais (12, 13, 14) caem longe na roda de cores.
  if (/^\d+$/.test(id)) return Math.round((Number(id.slice(-9)) * 137.508) % 360);
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function initials(name: string) {
  const parts = name.replace(/[_.]/g, " ").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase();
}
