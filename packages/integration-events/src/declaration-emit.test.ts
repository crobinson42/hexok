import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The consumer sits at the workspace root and resolves the package through the
// node_modules link, so its declaration emit can only name what the package
// root exports. The linked package.json points at src, so the test does not
// need this package's dist.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const linkDir = join(root, 'node_modules/@hexok/integration-events');
const consumerFile = join(root, 'declaration-emit.fixture.ts');
const linkPackageJson = join(linkDir, 'package.json');

const consumer = `
import { Contract, type ContractEvent, Message } from '@hexok/integration-events';
import { z } from 'zod';

export class DealClosed extends Message('deal.closed', 1, z.object({ id: z.string() })) {}
export class DealClosedV2 extends Message('deal.closed', 2, z.object({ dealId: z.string() }), {
  downgrade: { to: DealClosed, map: (v2) => ({ id: v2.dealId }) },
}) {}
export const DealOpened = Message('deal.opened', 1, z.object({ id: z.string() }));
export class Crm extends Contract('crm', { deals: [DealClosed, DealClosedV2, DealOpened] }) {}
export const crm = Contract('crm', { deals: [DealClosed] });
export const accept = (event: ContractEvent<typeof Crm>) => event;
`;

const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  exactOptionalPropertyTypes: true,
  skipLibCheck: true,
  declaration: true,
  emitDeclarationOnly: true,
  preserveSymlinks: true,
};

function emitConsumer() {
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile } = host;
  host.fileExists = (file) => file === consumerFile || fileExists(file);
  host.readFile = (file) => {
    if (file === consumerFile) return consumer;
    if (file === linkPackageJson) {
      return JSON.stringify({
        name: '@hexok/integration-events',
        type: 'module',
        exports: { '.': { types: './src/index.ts' } },
      });
    }
    return readFile(file);
  };
  const outputs: string[] = [];
  host.writeFile = (_, text) => outputs.push(text);

  const program = ts.createProgram([consumerFile], options, host);
  program.emit(undefined, undefined, undefined, true);
  // With `declaration` on, this includes the declaration emit errors.
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  return { diagnostics, declaration: outputs.join('\n') };
}

describe('declaration emit', () => {
  it('names Message and Contract classes from the package root', () => {
    const { diagnostics, declaration } = emitConsumer();

    expect(diagnostics).toEqual([]);
    expect(declaration).toContain(
      'import("@hexok/integration-events").MessageClass<"deal.closed", 1',
    );
    expect(declaration).not.toMatch(/import\("[^"]*\/(src|dist)\//);
  });
});
