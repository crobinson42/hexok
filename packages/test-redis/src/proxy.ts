import { connect, createServer, type Server, type Socket } from 'node:net';

/** `pass` forwards. `refuse` closes the listener, so a new connection gets `ECONNREFUSED`. `blackhole` accepts and never answers. */
export type ProxyMode = 'pass' | 'refuse' | 'blackhole';

interface Pair {
  readonly client: Socket;
  upstream: Socket | undefined;
  /** Client bytes held while blackholed. They are sent in order on `restore()`, as TCP would retransmit them. */
  held: Buffer[];
  clientEnded: boolean;
}

/**
 * A TCP proxy in front of Redis that fakes outages for integration tests.
 * Point a client at `host` and `port`, then call `refuse()`, `blackhole()`, `drop()`, and `restore()`.
 */
export class RedisProxy {
  readonly host = '127.0.0.1';
  readonly #target: { host: string; port: number };
  readonly #pairs = new Set<Pair>();
  #server: Server | undefined;
  #port = 0;
  #mode: ProxyMode = 'pass';

  private constructor(target: { host: string; port: number }) {
    this.#target = target;
  }

  /** Starts a proxy on a free port. `target` defaults to `REDIS_URL`. */
  static async start(
    target: string | undefined = process.env.REDIS_URL,
  ): Promise<RedisProxy> {
    if (!target) throw new Error('test-redis: REDIS_URL is not set');
    const url = new URL(target);
    const proxy = new RedisProxy({
      host: url.hostname,
      port: Number(url.port || 6379),
    });
    await proxy.#listen();
    return proxy;
  }

  get port(): number {
    return this.#port;
  }

  get url(): string {
    return `redis://${this.host}:${this.#port}`;
  }

  get mode(): ProxyMode {
    return this.#mode;
  }

  /** Client sockets accepted and not yet closed. It is 0 once every client the proxy saw has closed its socket. */
  get connections(): number {
    return this.#pairs.size;
  }

  /** Sockets the proxy holds open, both sides. Subtract it from a process socket count to count only the client's sockets. */
  get sockets(): number {
    let open = 0;
    for (const pair of this.#pairs) {
      if (!pair.client.destroyed) open += 1;
      if (pair.upstream && !pair.upstream.destroyed) open += 1;
    }
    return open;
  }

  /** New connections are refused. Open connections keep working. Pair it with `drop()` for "Redis is down". */
  async refuse(): Promise<void> {
    this.#mode = 'refuse';
    const server = this.#server;
    this.#server = undefined;
    // close() stops accepting now. Its callback waits for open connections, so it is not awaited.
    server?.close();
  }

  /** Accepts connections and answers nothing, on open and new connections alike. Like a network partition. */
  blackhole(): void {
    this.#mode = 'blackhole';
    for (const pair of this.#pairs) pair.upstream?.pause();
  }

  /** Destroys every open connection. Clients see the socket close and reconnect. */
  drop(): void {
    for (const pair of [...this.#pairs]) this.#destroy(pair);
  }

  /** Goes back to pass-through. Held bytes are forwarded and refused connections are accepted again. */
  async restore(): Promise<void> {
    const wasRefusing = this.#server === undefined;
    this.#mode = 'pass';
    if (wasRefusing) await this.#listen();
    for (const pair of this.#pairs) this.#flow(pair);
  }

  /** Destroys every connection and closes the listener. It leaves no handles. */
  async close(): Promise<void> {
    this.#mode = 'refuse';
    this.drop();
    const server = this.#server;
    this.#server = undefined;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  async #listen(): Promise<void> {
    const server = createServer({ allowHalfOpen: true }, (client) => {
      this.#accept(client);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.#port, this.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('test-redis: proxy has no port');
    }
    this.#port = address.port;
    this.#server = server;
  }

  #accept(client: Socket): void {
    const pair: Pair = {
      client,
      upstream: undefined,
      held: [],
      clientEnded: false,
    };
    this.#pairs.add(pair);
    client.on('error', () => {});
    client.on('close', () => this.#destroy(pair));
    client.on('data', (chunk: Buffer) => {
      if (this.#mode === 'blackhole' || pair.upstream === undefined) {
        pair.held.push(chunk);
      } else {
        pair.upstream.write(chunk);
      }
    });
    client.on('end', () => {
      pair.clientEnded = true;
      if (this.#mode !== 'blackhole') pair.upstream?.end();
    });
    if (this.#mode !== 'blackhole') this.#flow(pair);
  }

  /** Connects the upstream if needed, sends held bytes, and resumes replies. */
  #flow(pair: Pair): void {
    if (!this.#pairs.has(pair)) return;
    if (pair.upstream === undefined) {
      const upstream = connect({ ...this.#target, allowHalfOpen: true });
      pair.upstream = upstream;
      upstream.on('error', () => {});
      upstream.on('close', () => this.#destroy(pair));
      upstream.on('data', (chunk: Buffer) => pair.client.write(chunk));
      upstream.on('end', () => pair.client.end());
    }
    const upstream = pair.upstream;
    for (const chunk of pair.held) upstream.write(chunk);
    pair.held = [];
    if (pair.clientEnded) upstream.end();
    upstream.resume();
  }

  #destroy(pair: Pair): void {
    if (!this.#pairs.delete(pair)) return;
    pair.client.destroy();
    pair.upstream?.destroy();
  }
}
