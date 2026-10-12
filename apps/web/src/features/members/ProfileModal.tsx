import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Crown, HeadphoneOff, MessageSquare, MicOff, UserMinus } from "lucide-react";
import { api, type Server } from "../../lib/api";
import { can, PERM } from "../../lib/permissions";
import { usePresence, useMembers, useRoles } from "../../lib/queries";
import { toast, toastError, useSession } from "../../lib/store";
import { hueOf } from "../../lib/format";
import { Avatar, Modal, presenceLabel } from "../../components/ui";
import { roleColor } from "./MemberList";

const since = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" });

export function ProfileModal({ userId, server, onClose }: { userId: string; server: Server | null; onClose: () => void }) {
  const me = useSession((s) => s.user)!;
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: members } = useMembers(server?.id ?? null);
  const { data: roles = [] } = useRoles(server?.id ?? null);
  const member = members?.find((m) => m.id === userId);
  const fetched = useQuery({ queryKey: ["user", userId], queryFn: () => api.user(userId), enabled: !member });
  const user = member ?? fetched.data;
  const status = usePresence(userId, user?.status);
  const self = userId === me.id;
  const perms = server?.permissions ?? 0;
  const targetIsOwner = server?.ownerId === userId;
  const canModerate = Boolean(server && member && !self && !targetIsOwner);

  const moderate = async (action: "kick" | "ban" | "voice_mute" | "sound_mute", enabled = true) => {
    if ((action === "kick" || action === "ban") && !confirm(`${action === "ban" ? "Banir" : "Expulsar"} ${user?.username}?`)) return;
    try {
      await api.moderate(server!.id, userId, action, enabled);
      await qc.invalidateQueries({ queryKey: ["members", server!.id] });
      toast(action === "kick" ? "Membro expulso." : action === "ban" ? "Membro banido." : "Pronto.", "success");
      if (action === "kick" || action === "ban") onClose();
    } catch (e) {
      toastError(e);
    }
  };

  const toggleRole = async (roleId: string, on: boolean) => {
    try {
      await api.setMemberRole(server!.id, roleId, userId, on);
      await qc.invalidateQueries({ queryKey: ["members", server!.id] });
    } catch (e) {
      toastError(e);
    }
  };

  const hue = hueOf(userId);
  const assignable = roles.filter((r) => r.name !== "@everyone");

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={<span className="sr-only">Perfil</span>}>
      {!user ? (
        <div className="skeleton h-40 rounded-xl" />
      ) : (
        <div className="-mx-5 -mt-12 sm:-mx-6">
          <div className="h-24" style={{ background: user.bannerColor ? `linear-gradient(135deg, ${user.bannerColor}, rgb(var(--bg-2)))` : `linear-gradient(135deg, hsl(${hue} 45% 32%), hsl(${(hue + 60) % 360} 50% 16%))` }} />
          <div className="px-5 sm:px-6">
            <div className="-mt-11 inline-block rounded-full ring-[6px] ring-bg-2">
              <Avatar user={user} size={80} status={status} ring="ring-bg-2" />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <h2 className="text-[20px] font-semibold tracking-tight">{member?.nickname || user.username}</h2>
              {targetIsOwner && <Crown size={16} className="text-warn" aria-label="Dono do servidor" />}
            </div>
            <p className="text-[13px] text-ink-3">@{user.username} · {presenceLabel(status)}</p>

            {user.bio && <p className="mt-4 whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">{user.bio}</p>}
            {user.createdAt && <p className="mt-3 text-[12px] text-ink-4">No Vekrom desde {since.format(new Date(user.createdAt))}</p>}

            {server && member && (assignable.length > 0 || member.roleIds.length > 0) && (
              <div className="mt-5">
                <p className="section-label mb-2">Cargos</p>
                <div className="flex flex-wrap gap-1.5">
                  {assignable
                    .filter((r) => member.roleIds.includes(r.id) || can(perms, PERM.MANAGE_ROLES))
                    .map((r) => {
                      const on = member.roleIds.includes(r.id);
                      const editable = can(perms, PERM.MANAGE_ROLES);
                      return (
                        <button
                          key={r.id}
                          disabled={!editable}
                          onClick={() => void toggleRole(r.id, !on)}
                          aria-pressed={on}
                          className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium ring-1 ring-inset transition-colors disabled:cursor-default ${on ? "bg-white/[0.06] text-ink-1 ring-white/[0.12]" : "border border-dashed border-white/15 text-ink-4 ring-transparent hover:text-ink-2"}`}
                        >
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: roleColor(r) ?? "rgb(var(--ink-4))" }} />
                          {r.name}
                        </button>
                      );
                    })}
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-2 pb-2">
              {!self && (
                <button className="btn btn-primary" onClick={() => (onClose(), nav(`/channels/@me/${userId}`))}>
                  <MessageSquare size={16} /> Mensagem
                </button>
              )}
              {canModerate && can(perms, PERM.MUTE_MEMBERS) && (
                <button className="btn btn-ghost" onClick={() => void moderate("voice_mute", !member!.voiceMuted)}>
                  <MicOff size={16} /> {member!.voiceMuted ? "Liberar voz" : "Silenciar"}
                </button>
              )}
              {canModerate && can(perms, PERM.DEAFEN_MEMBERS) && (
                <button className="btn btn-ghost" onClick={() => void moderate("sound_mute", !member!.soundMuted)}>
                  <HeadphoneOff size={16} /> {member!.soundMuted ? "Liberar áudio" : "Ensurdecer"}
                </button>
              )}
              {canModerate && can(perms, PERM.KICK_MEMBERS) && (
                <button className="btn btn-danger" onClick={() => void moderate("kick")}>
                  <UserMinus size={16} /> Expulsar
                </button>
              )}
              {canModerate && can(perms, PERM.BAN_MEMBERS) && (
                <button className="btn btn-danger" onClick={() => void moderate("ban")}>
                  <Ban size={16} /> Banir
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
