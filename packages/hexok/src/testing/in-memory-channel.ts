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
  /** `{ id, payload }` records from `send`, in order. */
  readonly sent: Array<{ id: string; payload: string }> = [];
  #clients = new Map<string, Row<Session>>();

  /** Empty channel. Pass to `.route(Channel, InMemoryChannel.create())`. */
  static create<S>(): InMemoryChannel<S> {
    return new InMemoryChannel<S>();
  }

  /** Track a connected client. Replaces an existing row with the same `id`. */
  join(id: string, session: Session, connection: ChannelConnection): void {
    this.#clients.set(id, { session, connection });
    connection.addEventListener('close', () => {
      this.leave(id);
    });
  }

  /** Drop the client without closing the connection. */
  leave(id: string): void {
    this.#clients.delete(id);
  }

  /** Close the connection; the `close` listener then `leave`s. */
  eject(id: string): void {
    const row = this.#clients.get(id);
    if (!row) return;
    row.connection.close();
  }

  /** Replace session claims for a connected client. No-op if unknown `id`. */
  update(id: string, session: Session): void {
    const row = this.#clients.get(id);
    if (!row) return;
    row.session = session;
  }

  /** Snapshot of connected `{ id, session }` rows. */
  list(): Array<{ id: string; session: Session }> {
    return [...this.#clients.entries()].map(([id, row]) => ({
      id,
      session: row.session,
    }));
  }

  /** Record and deliver `payload` to `id`. Leaves the client if `send` throws. */
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

  /** Close every connection and clear clients. Does not clear `sent`. */
  async stop(): Promise<void> {
    for (const { connection } of this.#clients.values()) {
      connection.close();
    }
    this.#clients.clear();
  }
}
