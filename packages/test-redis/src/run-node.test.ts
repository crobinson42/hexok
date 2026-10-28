import { describe, expect, it } from 'vitest';
import { runNode } from './run-node.js';

const greet = new URL('../fixtures/greet.ts', import.meta.url).href;

describe('runNode', () => {
  it('reports the exit code, stdout, and stderr', async () => {
    const result = await runNode(`
console.log('out');
console.error('err');
process.exitCode = 3;
`);
    expect(result).toMatchObject({
      code: 3,
      signal: null,
      stdout: 'out\n',
      stderr: 'err\n',
    });
  });

  it('imports TypeScript source and maps a relative .js import to .ts', async () => {
    const result = await runNode(`
import { greeting } from ${JSON.stringify(greet)};
console.log(greeting);
`);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('hello redis\n');
  });

  it('passes env to the child', async () => {
    const result = await runNode('console.log(process.env.GREETING);', {
      env: { GREETING: 'hi' },
    });
    expect(result.stdout).toBe('hi\n');
  });

  it('reports heap numbers, and heapUsed() collects garbage with exposeGc', async () => {
    const result = await runNode(
      `
const before = heapUsed();
let held = Array.from({ length: 200_000 }, (_, i) => ({ i }));
const holding = heapUsed();
held = undefined;
console.log(JSON.stringify({ grew: holding - before, freed: holding - heapUsed() }));
`,
      { exposeGc: true },
    );
    expect(result.code).toBe(0);
    const { grew, freed } = JSON.parse(result.stdout) as {
      grew: number;
      freed: number;
    };
    expect(grew).toBeGreaterThan(1_000_000);
    expect(freed).toBeGreaterThan(1_000_000);
    expect(result.heap?.start).toBeGreaterThan(0);
    expect(result.heap?.end).toBeGreaterThan(0);
  });

  it('ms includes a handle the child leaves open', async () => {
    const result = await runNode('setTimeout(() => {}, 400);');
    expect(result.code).toBe(0);
    expect(result.ms).toBeGreaterThanOrEqual(400);
    expect(result.exitedAt).toBeLessThanOrEqual(Date.now());
  });

  it('kills a child that outlives timeoutMs', async () => {
    const result = await runNode('setInterval(() => {}, 1000);', {
      timeoutMs: 300,
    });
    expect(result.code).toBeNull();
    expect(result.signal).toBe('SIGKILL');
    expect(result.heap).toBeUndefined();
  });
});
