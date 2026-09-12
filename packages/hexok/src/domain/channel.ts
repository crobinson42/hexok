/**
 * Byte sink for one connected client. WebSocket and SSE adapters wrap their
 * native connection as this shape.
 */
export type ChannelConnection = {
  /** Write one frame to this client. */
  send(data: string): void;
  /** Disconnect this client. */
  close(): void;
  /** Subscribe to the native close. */
  addEventListener(type: 'close', listener: () => void): void;
};

/**
 * Local presence + send. Bound with `.route(Channel, adapter)`.
 * Does not interpret routing hints or session claims.
 */
export interface ChannelAdapter<Session = unknown> {
  /** Bind a connected client into local presence. */
  join(id: string, session: Session, connection: ChannelConnection): void;
  /** Remove a client that left. */
  leave(id: string): void;
  /** Force-disconnect a client. */
  eject(id: string): void;
  /** Replace the session attached to a connected id. */
  update(id: string, session: Session): void;
  /** Snapshot of who is present. */
  list(): ReadonlyArray<{ id: string; session: Session }>;
  /** Send a payload to one connected id. */
  send(id: string, payload: string): void;
  /** Tear down the adapter. Optional. */
  stop?(): Promise<void>;
}
