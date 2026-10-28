import { spawn } from 'node:child_process';

export interface RunNodeOptions {
  /** Added to the parent's environment. */
  readonly env?: Record<string, string> | undefined;
  /** Runs with `--expose-gc`, so `heapUsed()` collects garbage first. */
  readonly exposeGc?: boolean | undefined;
  /** Kills the child with `SIGKILL` after this long. Default 10000. */
  readonly timeoutMs?: number | undefined;
}

export interface NodeRun {
  /** The exit code, or `null` when a signal ended the child. */
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  /** From spawn to exit. */
  readonly ms: number;
  /** `Date.now()` at exit. Compare it with a time the child prints. */
  readonly exitedAt: number;
  readonly stdout: string;
  readonly stderr: string;
  /** `heapUsed()` before the snippet's imports load and at exit. Missing when the child was killed. */
  readonly heap: { readonly start: number; readonly end: number } | undefined;
}

/**
 * Loaded with `--import` before the snippet. Node strips the types of a `.ts` import.
 * The resolve hook maps a relative `./x.js` that does not exist to `./x.ts`, as the source imports it.
 */
const preload = `
import { writeSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (!specifier.startsWith('.') || !specifier.endsWith('.js')) throw error;
      return next(specifier.slice(0, -3) + '.ts', context);
    }
  },
});
globalThis.heapUsed = () => {
  globalThis.gc?.();
  globalThis.gc?.();
  return process.memoryUsage().heapUsed;
};
const start = globalThis.heapUsed();
process.on('exit', () => {
  writeSync(3, JSON.stringify({ start, end: globalThis.heapUsed() }));
});
`;

/**
 * Runs an ES module `source` in a child Node and reports how it ended.
 * The source can import `.ts` files by URL, such as `new URL('./adapter.ts', import.meta.url).href`.
 * It has a global `heapUsed()` that returns `process.memoryUsage().heapUsed`, after two GCs when `exposeGc` is set.
 * The child keeps running until its event loop is empty, so `ms` shows whether anything was left open.
 */
export async function runNode(
  source: string,
  options: RunNodeOptions = {},
): Promise<NodeRun> {
  const started = Date.now();
  const child = spawn(
    process.execPath,
    [
      '--no-warnings',
      ...(options.exposeGc ? ['--expose-gc'] : []),
      `--import=data:text/javascript,${encodeURIComponent(preload)}`,
      '--input-type=module',
      '--eval',
      source,
    ],
    {
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
      timeout: options.timeoutMs ?? 10_000,
      killSignal: 'SIGKILL',
    },
  );
  const [stdout, stderr, report] = [1, 2, 3].map((fd) => {
    let text = '';
    child.stdio[fd]?.on('data', (chunk: Buffer) => {
      text += chunk.toString();
    });
    return () => text;
  }) as [() => string, () => string, () => string];
  let exitedAt = 0;
  child.once('exit', () => {
    exitedAt = Date.now();
  });
  const [code, signal] = await new Promise<
    [number | null, NodeJS.Signals | null]
  >((resolve, reject) => {
    child.once('error', reject);
    // `close` follows `exit` once the pipes drain, so the output is complete.
    child.once('close', (exitCode, exitSignal) =>
      resolve([exitCode, exitSignal]),
    );
  });
  return {
    code,
    signal,
    ms: exitedAt - started,
    exitedAt,
    stdout: stdout(),
    stderr: stderr(),
    heap: parseHeap(report()),
  };
}

function parseHeap(raw: string): NodeRun['heap'] {
  if (raw === '') return undefined;
  const parsed = JSON.parse(raw) as { start: number; end: number };
  return { start: parsed.start, end: parsed.end };
}
