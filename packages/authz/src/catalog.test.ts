import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { type AccessAction, AccessCatalog, MANAGE } from './catalog.js';

class Shop extends AccessCatalog('shop', {
  actions: ['order:read', 'order:edit'],
}) {}

describe('AccessCatalog', () => {
  it('keeps the token and always includes MANAGE once', () => {
    expect(Shop.token).toBe('shop');
    expect(Shop.actions).toEqual(['order:read', 'order:edit', MANAGE]);
    class Declared extends AccessCatalog('declared', {
      actions: ['a:b', 'access:manage'],
    }) {}
    expect(Declared.actions).toEqual(['a:b', MANAGE]);
  });

  it('isAction, parse, and unknown read the list', () => {
    expect(Shop.isAction('order:read')).toBe(true);
    expect(Shop.isAction('order:gone')).toBe(false);
    expect(Shop.isAction(7)).toBe(false);
    expect(Shop.parse(['order:read', 'order:gone', 7])).toEqual(['order:read']);
    expect(Shop.unknown(['order:read', 'order:gone'])).toEqual(['order:gone']);
  });

  it('infers the literal union without as const', () => {
    expectTypeOf<AccessAction<typeof Shop>>().toEqualTypeOf<
      'order:read' | 'order:edit' | 'access:manage'
    >();
  });

  it('imports nothing, so browsers can load it', () => {
    const source = readFileSync(
      new URL('./catalog.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/^\s*(import|export .* from)\b/m);
    expect(source).not.toMatch(/\bimport\(/);
  });
});
