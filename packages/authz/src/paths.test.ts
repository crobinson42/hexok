import { Event, type StandardSchemaV1 } from 'hexok';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryPathStore } from './memory.js';
import { Paths } from './paths.js';

const anything: StandardSchemaV1<{ id: string; parent?: string }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) => ({ value: value as { id: string; parent?: string } }),
  },
};

class Created extends Event('thing.created', anything) {}
class Moved extends Event('thing.moved', anything) {}
class Removed extends Event('thing.removed', anything) {}

describe('Paths', () => {
  let central: MemoryPathStore;
  let scans: MemoryPathStore;
  let places: MemoryPathStore;
  let paths: Paths<{ scans: MemoryPathStore; places: MemoryPathStore }>;

  const pathOf = async (store: MemoryPathStore, id: string) =>
    (await store.get([id]))[0]?.path;

  beforeEach(async () => {
    central = new MemoryPathStore();
    scans = new MemoryPathStore();
    places = new MemoryPathStore();
    paths = new Paths({ central, copies: { scans, places } });
    await paths.place({ id: 'org:a' });
    await paths.place({ id: 'region:w', parent: 'org:a' }, 'places');
    await paths.place({ id: 'region:e', parent: 'org:a' }, 'places');
    await paths.place({ id: 'loc:g', parent: 'region:w' }, 'places');
    await paths.place({ id: 'rtc:ops', parent: 'org:a' }, 'places');
    await paths.place({ id: 'rt:inc', parent: 'rtc:ops' }, 'places');
  });

  describe('place', () => {
    it('writes central and only the named copy', async () => {
      await paths.place({ id: 'scan:1', parent: 'loc:g' }, 'scans');
      const path = ['org:a', 'region:w', 'loc:g', 'scan:1'];
      expect((await central.get(['scan:1']))[0]).toEqual({
        id: 'scan:1',
        orgId: 'org:a',
        path,
        parents: ['loc:g'],
      });
      expect((await scans.get(['scan:1']))[0]).toEqual({
        id: 'scan:1',
        orgId: 'org:a',
        path,
        parents: ['loc:g'],
        resourceId: 'scan:1',
      });
      await expect(places.get(['scan:1'])).resolves.toEqual([]);
    });

    it('makes a tenant root its own organization', async () => {
      expect((await central.get(['org:a']))[0]).toEqual({
        id: 'org:a',
        orgId: 'org:a',
        path: ['org:a'],
        parents: [],
      });
    });

    it('stores the resource id it is given', async () => {
      const objectId = { oid: 'abc' };
      await paths.place(
        { id: 'scan:1', parent: 'loc:g', resourceId: objectId },
        'scans',
      );
      expect((await scans.get(['scan:1']))[0]?.resourceId).toBe(objectId);
    });

    it('takes the union of two parents', async () => {
      await paths.place(
        { id: 'report:5', parents: ['loc:g', 'rt:inc'] },
        'scans',
      );
      expect(await pathOf(central, 'report:5')).toEqual([
        'org:a',
        'region:w',
        'loc:g',
        'rtc:ops',
        'rt:inc',
        'report:5',
      ]);
    });

    it('throws ParentNotPlaced so a queue retries, then succeeds', async () => {
      await expect(
        paths.place({ id: 'scan:1', parent: 'loc:late' }, 'scans'),
      ).rejects.toMatchObject({
        code: 'ParentNotPlaced',
        data: { id: 'loc:late' },
      });
      await expect(central.get(['scan:1'])).resolves.toEqual([]);
      await paths.place({ id: 'loc:late', parent: 'region:w' }, 'places');
      await paths.place({ id: 'scan:1', parent: 'loc:late' }, 'scans');
      expect(await pathOf(scans, 'scan:1')).toContain('loc:late');
    });

    it('re-running is a no-op', async () => {
      await paths.place({ id: 'scan:1', parent: 'loc:g' }, 'scans');
      const before = [central.all(), scans.all()];
      await paths.place({ id: 'scan:1', parent: 'loc:g' }, 'scans');
      expect([central.all(), scans.all()]).toEqual(before);
    });

    it('a stale redelivery after a move keeps the moved path', async () => {
      await paths.place({ id: 'scan:1', parent: 'loc:g' }, 'scans');
      await paths.move({ id: 'loc:g', parent: 'region:e' });
      await paths.place({ id: 'loc:g', parent: 'region:w' }, 'places');
      await paths.place({ id: 'scan:1', parent: 'loc:g' }, 'scans');
      const moved = ['org:a', 'region:e', 'loc:g'];
      expect(await pathOf(central, 'loc:g')).toEqual(moved);
      expect(await pathOf(places, 'loc:g')).toEqual(moved);
      expect(await pathOf(scans, 'scan:1')).toEqual([...moved, 'scan:1']);
    });

    it('a retry after a failed copy write finishes the copy', async () => {
      const put = vi
        .spyOn(scans, 'put')
        .mockRejectedValueOnce(new Error('down'));
      await expect(
        paths.place({ id: 'scan:1', parent: 'loc:g' }, 'scans'),
      ).rejects.toThrow('down');
      put.mockRestore();
      await paths.place({ id: 'scan:1', parent: 'loc:g' }, 'scans');
      expect(await pathOf(scans, 'scan:1')).toEqual(
        await pathOf(central, 'scan:1'),
      );
    });

    it('refuses parents in two organizations, and its own id', async () => {
      await paths.place({ id: 'org:b' });
      await expect(
        paths.place({ id: 'x', parents: ['org:a', 'org:b'] }),
      ).rejects.toMatchObject({ code: 'InvalidPath', data: { id: 'x' } });
      await expect(paths.place({ id: 'x', parent: 'x' })).rejects.toMatchObject(
        { code: 'InvalidPath' },
      );
    });
  });

  describe('move', () => {
    it('rewrites the subtree in central and every copy', async () => {
      await paths.place({ id: 'scan:1', parent: 'loc:g' }, 'scans');
      await paths.place({ id: 'note:1', parent: 'scan:1' }, 'scans');
      await paths.move({ id: 'loc:g', parent: 'region:e' });
      const expected = ['org:a', 'region:e', 'loc:g', 'scan:1', 'note:1'];
      expect(await pathOf(central, 'note:1')).toEqual(expected);
      expect(await pathOf(scans, 'note:1')).toEqual(expected);
      expect(await pathOf(places, 'loc:g')).toEqual(expected.slice(0, 3));
      expect(await pathOf(central, 'region:w')).toEqual(['org:a', 'region:w']);
      await expect(scans.get(['loc:g'])).resolves.toEqual([]);
    });

    it('keeps both ancestries of a two-parent descendant', async () => {
      await paths.place(
        { id: 'report:5', parents: ['loc:g', 'rt:inc'] },
        'scans',
      );
      await paths.move({ id: 'loc:g', parent: 'region:e' });
      expect(new Set(await pathOf(scans, 'report:5'))).toEqual(
        new Set([
          'org:a',
          'region:e',
          'loc:g',
          'rtc:ops',
          'rt:inc',
          'report:5',
        ]),
      );
      await paths.place({ id: 'rtc:new', parent: 'org:a' }, 'places');
      await paths.move({ id: 'rt:inc', parent: 'rtc:new' });
      expect(new Set(await pathOf(central, 'report:5'))).toEqual(
        new Set([
          'org:a',
          'region:e',
          'loc:g',
          'rtc:new',
          'rt:inc',
          'report:5',
        ]),
      );
    });

    it('keeps a folder both parents still share', async () => {
      await paths.place({ id: 'rt:west', parent: 'region:w' }, 'places');
      await paths.place(
        { id: 'report:7', parents: ['loc:g', 'rt:west'] },
        'scans',
      );
      await paths.move({ id: 'loc:g', parent: 'region:e' });
      expect(await pathOf(central, 'report:7')).toContain('region:w');
      expect(await pathOf(central, 'report:7')).toContain('region:e');
    });

    it('handles a diamond under the moved record', async () => {
      await paths.place({ id: 'a', parent: 'loc:g' }, 'scans');
      await paths.place({ id: 'b', parent: 'loc:g' }, 'scans');
      await paths.place({ id: 'c', parents: ['a', 'b'] }, 'scans');
      await paths.move({ id: 'loc:g', parent: 'region:e' });
      expect(await pathOf(central, 'c')).toEqual([
        'org:a',
        'region:e',
        'loc:g',
        'a',
        'b',
        'c',
      ]);
    });

    it('moves a record to two parents', async () => {
      await paths.place({ id: 'scan:1', parent: 'loc:g' }, 'scans');
      await paths.move({ id: 'scan:1', parents: ['region:e', 'rt:inc'] });
      expect((await central.get(['scan:1']))[0]?.parents).toEqual([
        'region:e',
        'rt:inc',
      ]);
      expect(await pathOf(scans, 'scan:1')).not.toContain('loc:g');
    });

    it('a retry after a failed copy write gives the same result', async () => {
      await paths.place({ id: 'scan:1', parent: 'loc:g' }, 'scans');
      const update = vi
        .spyOn(scans, 'update')
        .mockRejectedValueOnce(new Error('down'));
      await expect(
        paths.move({ id: 'loc:g', parent: 'region:e' }),
      ).rejects.toThrow('down');
      expect(await pathOf(scans, 'scan:1')).toContain('region:w');
      update.mockRestore();
      await paths.move({ id: 'loc:g', parent: 'region:e' });
      expect(await pathOf(scans, 'scan:1')).toEqual(
        await pathOf(central, 'scan:1'),
      );
      expect(await pathOf(scans, 'scan:1')).toContain('region:e');
    });

    it('keeps the resource id on the copy', async () => {
      await paths.place(
        { id: 'scan:1', parent: 'loc:g', resourceId: 'oid-1' },
        'scans',
      );
      await paths.move({ id: 'loc:g', parent: 'region:e' });
      expect((await scans.get(['scan:1']))[0]?.resourceId).toBe('oid-1');
    });

    it('refuses its own subtree, another organization, and no parent', async () => {
      await paths.place({ id: 'scan:1', parent: 'loc:g' }, 'scans');
      await paths.place({ id: 'org:b' });
      for (const target of [
        { id: 'loc:g', parent: 'scan:1' },
        { id: 'loc:g', parent: 'loc:g' },
        { id: 'loc:g', parent: 'org:b' },
        { id: 'loc:g', parents: [] },
      ]) {
        await expect(paths.move(target)).rejects.toMatchObject({
          code: 'InvalidPath',
          data: { id: 'loc:g' },
        });
      }
      expect(await pathOf(central, 'scan:1')).toContain('region:w');
    });

    it('throws ParentNotPlaced for an unplaced record or parent', async () => {
      await expect(
        paths.move({ id: 'nope', parent: 'region:e' }),
      ).rejects.toMatchObject({
        code: 'ParentNotPlaced',
        data: { id: 'nope' },
      });
      await expect(
        paths.move({ id: 'loc:g', parent: 'nope' }),
      ).rejects.toMatchObject({
        code: 'ParentNotPlaced',
        data: { id: 'nope' },
      });
    });
  });

  describe('remove', () => {
    it('removes the subtree everywhere, and a repeat is safe', async () => {
      await paths.place({ id: 'scan:1', parent: 'loc:g' }, 'scans');
      await paths.remove('loc:g');
      await paths.remove('loc:g');
      await expect(central.get(['loc:g', 'scan:1'])).resolves.toEqual([]);
      await expect(places.get(['loc:g'])).resolves.toEqual([]);
      await expect(scans.get(['scan:1'])).resolves.toEqual([]);
      await expect(central.get(['region:w'])).resolves.toHaveLength(1);
    });
  });

  describe('handlers', () => {
    it('carry a token and event, and run the work', async () => {
      const handlers = paths.handlers([
        paths.placeOn(
          Created,
          (thing) => ({
            id: thing.id,
            ...(thing.parent !== undefined ? { parent: thing.parent } : {}),
          }),
          'scans',
        ),
        paths.moveOn(Moved, (thing) => ({
          id: thing.id,
          parent: thing.parent as string,
        })),
        paths.removeOn(Removed, (thing) => thing.id),
      ]);
      const [place, move, remove] = handlers;
      expect(place?.token).toBe('authz.paths.place.thing.created');
      expect(place?.event).toBe(Created);
      expect(move?.token).toBe('authz.paths.move.thing.moved');
      expect(remove?.token).toBe('authz.paths.remove.thing.removed');

      await place?.handle(
        new Created({ id: 'scan:1', parent: 'loc:g' }) as never,
      );
      expect(await pathOf(scans, 'scan:1')).toContain('region:w');
      await move?.handle(
        new Moved({ id: 'loc:g', parent: 'region:e' }) as never,
      );
      expect(await pathOf(scans, 'scan:1')).toContain('region:e');
      await remove?.handle(new Removed({ id: 'scan:1' }) as never);
      await expect(scans.get(['scan:1'])).resolves.toEqual([]);
    });

    it('types the copy name and the payload', () => {
      // Never called. The compiler reads these lines.
      const wrong = () => [
        // @ts-expect-error not a copy
        paths.placeOn(Created, (thing) => ({ id: thing.id }), 'nope'),
        // @ts-expect-error not a field of the payload
        paths.removeOn(Removed, (thing) => thing.missing),
      ];
      expect(typeof wrong).toBe('function');
    });
  });
});
