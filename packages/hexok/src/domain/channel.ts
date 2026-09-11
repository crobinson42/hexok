/**
 * Byte sink for one connected client. WebSocket and SSE adapters wrap their
 * native connection as this shape.
 */
export type ChannelConnection = {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'close', listener: () => void): void;
};

/**
 * Local presence + send. Bound with `.route(Channel, adapter)`.
 * Does not interpret routing hints or session claims.
 */
export interface ChannelAdapter<Session = unknown> {
  join(id: string, session: Session, connection: ChannelConnection): void;
  leave(id: string): void;
  eject(id: string): void;
  update(id: string, session: Session): void;
  list(): ReadonlyArray<{ id: string; session: Session }>;
  send(id: string, payload: string): void;
  stop?(): Promise<void>;
}
