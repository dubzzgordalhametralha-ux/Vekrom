/** Espelho de apps/api/src/lib/access.ts. O servidor é quem decide; aqui só esconde botões. */
export const PERM = {
  ADMINISTRATOR: 1 << 0,
  MANAGE_SERVER: 1 << 1,
  MANAGE_CHANNELS: 1 << 2,
  MANAGE_ROLES: 1 << 3,
  MANAGE_MESSAGES: 1 << 4,
  KICK_MEMBERS: 1 << 5,
  BAN_MEMBERS: 1 << 6,
  MUTE_MEMBERS: 1 << 7,
  DEAFEN_MEMBERS: 1 << 8,
} as const;

export const PERM_LABELS: Array<{ bit: number; label: string; hint: string }> = [
  { bit: PERM.ADMINISTRATOR, label: "Administrador", hint: "Tudo liberado. Use com cuidado." },
  { bit: PERM.MANAGE_SERVER, label: "Gerenciar servidor", hint: "Nome e ícone do servidor." },
  { bit: PERM.MANAGE_CHANNELS, label: "Gerenciar canais", hint: "Criar, renomear e excluir canais." },
  { bit: PERM.MANAGE_ROLES, label: "Gerenciar cargos", hint: "Criar cargos e dar cargos a membros." },
  { bit: PERM.MANAGE_MESSAGES, label: "Gerenciar mensagens", hint: "Apagar mensagens de outras pessoas." },
  { bit: PERM.KICK_MEMBERS, label: "Expulsar membros", hint: "Tirar alguém do servidor." },
  { bit: PERM.BAN_MEMBERS, label: "Banir membros", hint: "Expulsar e impedir a volta." },
  { bit: PERM.MUTE_MEMBERS, label: "Silenciar na voz", hint: "Desligar o microfone de alguém." },
  { bit: PERM.DEAFEN_MEMBERS, label: "Ensurdecer na voz", hint: "Cortar o áudio que a pessoa ouve." },
];

export function can(perms: number | undefined, bit: number): boolean {
  return ((perms ?? 0) & bit) === bit || ((perms ?? 0) & PERM.ADMINISTRATOR) === PERM.ADMINISTRATOR;
}
