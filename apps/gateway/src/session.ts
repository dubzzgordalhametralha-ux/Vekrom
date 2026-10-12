import type { WebSocket } from "ws";

/** Sessão de um socket autenticado. */
export interface Session {
  connectionId: string;
  userId: string;
  username: string;
  socket: WebSocket;
  /** Servidores dos quais o usuário é membro (carregado no IDENTIFY, atualizado por eventos). */
  servers: Set<string>;
  friends: Set<string>;
  status: string;
  expiresAt: number;
}

/** Sessões locais desta instância. Roteamento é O(n) por evento. */
// ponytail: varredura linear; índice serverId -> sessões quando passar de alguns milhares de conexões.
export class SessionStore {
  private byConnection = new Map<string, Session>();

  add(s: Session): void {
    this.byConnection.set(s.connectionId, s);
  }

  remove(connectionId: string): Session | undefined {
    const s = this.byConnection.get(connectionId);
    this.byConnection.delete(connectionId);
    return s;
  }

  get(connectionId: string): Session | undefined {
    return this.byConnection.get(connectionId);
  }

  ofUser(userId: string): Session[] {
    return [...this.byConnection.values()].filter((s) => s.userId === userId);
  }

  inServer(serverId: string): Session[] {
    return [...this.byConnection.values()].filter((s) => s.servers.has(serverId));
  }

  /** Quem pode ver a presença de `userId`: divide servidor ou é amigo. */
  audienceOf(userId: string, servers: Set<string>, friends: Set<string>): Session[] {
    return [...this.byConnection.values()].filter(
      (s) => s.userId === userId || friends.has(s.userId) || [...s.servers].some((id) => servers.has(id)),
    );
  }

  all(): Iterable<Session> {
    return this.byConnection.values();
  }

  get size(): number {
    return this.byConnection.size;
  }
}
