import type { ChannelAdapter, ChannelConnection } from '../domain/index.js';

type Row<Session> = {
  session: Session;
  connection: ChannelConnection;
};

/**
 * In-process channel adapter. Records `sent`. `stop()` closes connections.
 */
export class InMemoryChannel<Session = unknown>
  implements ChannelAdapter<Session>
{
  readonly sent: Array<{ id: string; payload: string }> = [];
  #clients = new Map<string, Row<Session>>();

  static create<S>(): InMemoryChannel<S> {
    return new InMemoryChannel<S>();
  }

  join(id: string, session: Session, connection: ChannelConnection): void {
    this.#clients.set(id, { session, connection });
    connection.addEventListener('close', () => {
      this.leave(id);
    });
  }

  leave(id: string): void {
    this.#clients.delete(id);
  }

  eject(id: string): void {
    const row = this.#clients.get(id);
    if (!row) return;
    row.connection.close();
  }

  update(id: string, session: Session): void {
    const row = this.#clients.get(id);
    if (!row) return;
    row.session = session;
  }

  list(): Array<{ id: string; session: Session }> {
    return [...this.#clients.entries()].map(([id, row]) => ({
      id,
      session: row.session,
    }));
  }

  send(id: string, payload: string): void {
    const row = this.#clients.get(id);
    if (!row) return;
    this.sent.push({ id, payload });
    try {
      row.connection.send(payload);
    } catch {
      this.leave(id);
    }
  }

  async stop(): Promise<void> {
    for (const { connection } of this.#clients.values()) {
      connection.close();
    }
    this.#clients.clear();
  }
}
