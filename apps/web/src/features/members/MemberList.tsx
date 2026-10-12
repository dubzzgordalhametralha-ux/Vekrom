import { Crown } from "lucide-react";
import type { Member, Role, Server } from "../../lib/api";
import { useMembers, useRoles } from "../../lib/queries";
import { useLive } from "../../lib/store";
import { Avatar } from "../../components/ui";

export const roleColor = (r?: Role | null) => (r?.color != null ? `#${r.color.toString(16).padStart(6, "0")}` : undefined);

export function topRole(m: Member, roles: Role[]) {
  return roles.filter((r) => m.roleIds.includes(r.id) && r.name !== "@everyone").sort((a, b) => b.position - a.position)[0];
}

export function MemberList({ server, onProfile }: { server: Server; onProfile: (id: string) => void }) {
  const { data: members, isPending } = useMembers(server.id);
  const { data: roles = [] } = useRoles(server.id);
  const live = useLive((s) => s.presence);
  const status = (m: Member) => live[m.id] ?? m.status ?? "offline";

  const groups = new Map<string, { label: string; color?: string; list: Member[] }>();
  const sortedRoles = roles.filter((r) => r.name !== "@everyone").sort((a, b) => b.position - a.position);
  for (const r of sortedRoles) groups.set(r.id, { label: r.name, color: roleColor(r), list: [] });
  groups.set("online", { label: "Online", list: [] });
  groups.set("offline", { label: "Offline", list: [] });
  for (const m of members ?? []) {
    if (status(m) === "offline") groups.get("offline")!.list.push(m);
    else groups.get(topRole(m, roles)?.id ?? "online")!.list.push(m);
  }

  return (
    <aside aria-label="Membros" className="hidden h-full w-[244px] shrink-0 flex-col border-l border-line bg-bg-1 lg:flex">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-6 pt-3">
        {isPending &&
          [0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-2">
              <div className="skeleton h-8 w-8 rounded-full" />
              <div className="skeleton h-3 flex-1 rounded" />
            </div>
          ))}
        {[...groups.values()]
          .filter((g) => g.list.length)
          .map((g) => (
            <section key={g.label} className="mb-4">
              <h3 className="section-label mb-1 px-2">{g.label} — {g.list.length}</h3>
              {g.list.map((m) => {
                const st = status(m);
                const color = roleColor(topRole(m, roles));
                return (
                  <button key={m.id} onClick={() => onProfile(m.id)} className={`row h-11 gap-3 ${st === "offline" ? "opacity-45 hover:opacity-100" : ""}`}>
                    <Avatar user={m} size={32} status={st} ring="ring-bg-1" />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium" style={{ color }}>{m.nickname || m.username}</span>
                    {m.id === server.ownerId && <Crown size={14} className="text-warn" aria-label="Dono" />}
                  </button>
                );
              })}
            </section>
          ))}
      </div>
    </aside>
  );
}
