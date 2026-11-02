import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodedError } from 'hexok';
import { serve } from 'srvx';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../servers/api.js';
import { createRuntime } from '../servers/composition.js';
import { createHttpHandler } from '../servers/http/handler.js';
import { createApiApp } from '../servers/rpc/app.js';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

let handle: (request: Request) => Promise<Response>;

beforeEach(async () => {
  const runtime = await createRuntime();
  handle = createHttpHandler(createApiApp(createApi(runtime)));
});

describe('lists', () => {
  it('returns the scans each actor can view', async () => {
    const expected: Record<string, readonly string[]> = {
      alice: ['91', '92'],
      'user:alice': ['91', '92'],
      erin: ['91', '92'],
      'group:night-crew': ['91', '92'],
      dave: [],
      helen: ['50', '91', '92', '93'],
      bob: ['92'],
      carol: ['93'],
      contractor: ['91'],
      gina: ['7'],
      frank: ['93'],
      ada: ['50', '7', '91', '92', '93'],
    };
    for (const [actor, scanIds] of Object.entries(expected)) {
      const result = await call(actor, 'scans/list', {});
      expect(result.status, actor).toBe(200);
      expect(ids(output(result.json)), actor).toEqual(scanIds);
    }
  });

  it('returns scan records with no grant fields', async () => {
    const result = await call('alice', 'scans/list', {});
    expect(output(result.json)).toEqual([
      { id: '91', title: 'Gate A', locationId: 'gate-a' },
      { id: '92', title: 'Gate B', locationId: 'gate-b' },
    ]);
  });

  it('returns locations from the same tuples', async () => {
    const expected: Record<string, readonly string[]> = {
      alice: ['gate-a', 'gate-b'],
      helen: ['gate-a', 'gate-b', 'gate-c', 'hq'],
      contractor: ['gate-a'],
      gina: [],
      frank: ['gate-c'],
      dave: [],
      ada: ['foreign', 'gate-a', 'gate-b', 'gate-c', 'hq'],
    };
    for (const [actor, locationIds] of Object.entries(expected)) {
      const result = await call(actor, 'locations/list', {});
      expect(result.status, actor).toBe(200);
      expect(ids(output(result.json)), actor).toEqual(locationIds);
    }
  });

  it('returns groups a member or editor can open', async () => {
    const expected: Record<string, readonly string[]> = {
      alice: ['night-crew'],
      erin: ['day-crew', 'night-crew'],
      frank: ['auditors'],
      dave: [],
      ada: ['night-crew'],
    };
    for (const [actor, groupIds] of Object.entries(expected)) {
      const result = await call(actor, 'groups/list', {});
      expect(result.status, actor).toBe(200);
      expect(ids(output(result.json)), actor).toEqual(groupIds);
    }
    const group = await call('alice', 'groups/get', { id: 'night-crew' });
    expect(output(group.json)).toEqual({
      id: 'night-crew',
      name: 'Night crew',
    });
  });

  it('returns notes under visible scans', async () => {
    expect(ids(output((await call('alice', 'notes/list', {})).json))).toEqual([
      '5',
      '6',
    ]);
    expect(
      ids(output((await call('contractor', 'notes/list', {})).json)),
    ).toEqual(['5']);
    expect(ids(output((await call('bob', 'notes/list', {})).json))).toEqual([
      '6',
    ]);
    expect(ids(output((await call('dave', 'notes/list', {})).json))).toEqual(
      [],
    );
    expect(ids(output((await call('gina', 'notes/list', {})).json))).toEqual(
      [],
    );
  });
});

describe('checks', () => {
  it('rejects a hidden scan and an unknown id', async () => {
    expect((await call('alice', 'scans/get', { id: '7' })).status).toBe(403);
    expect((await call('dave', 'scans/get', { id: '91' })).status).toBe(403);
    expect((await call('ada', 'scans/get', { id: 'missing' })).status).toBe(
      403,
    );
    const visible = await call('ada', 'scans/get', { id: '7' });
    expect(visible.status).toBe(200);
    expect(output(visible.json)).toEqual({
      id: '7',
      title: 'Foreign',
      locationId: 'foreign',
    });
  });

  it('lets an editor of the scan or an ancestor change the title', async () => {
    expect(
      (await call('alice', 'scans/update', { id: '92', title: 'No' })).status,
    ).toBe(403);
    expect(
      (await call('helen', 'scans/update', { id: '91', title: 'No' })).status,
    ).toBe(403);
    const updated = await call('bob', 'scans/update', {
      id: '92',
      title: 'West gate',
    });
    expect(updated.status).toBe(200);
    expect(output(updated.json)).toEqual({
      id: '92',
      title: 'West gate',
      locationId: 'gate-b',
    });
    expect(
      output((await call('alice', 'scans/get', { id: '92' })).json),
    ).toEqual(output(updated.json));
    const east = await call('carol', 'scans/update', {
      id: '93',
      title: 'East gate',
    });
    expect(east.status).toBe(200);
    expect(
      (await call('bob', 'scans/update', { id: '91', title: 'No' })).status,
    ).toBe(403);
  });

  it('explains the first granting path', async () => {
    const allowed = await call('alice', 'access/explain', {
      action: 'scan:view',
      id: '91',
    });
    expect(allowed.status).toBe(200);
    expect(output(allowed.json)).toEqual({
      allowed: true,
      action: 'scan:view',
      resource: 'scan:91',
      actor: 'user:alice',
      steps: [
        {
          object: 'scan:91',
          relation: 'parent',
          subject: 'location:gate-a',
          via: 'ancestor',
        },
        {
          object: 'location:gate-a',
          relation: 'parent',
          subject: 'region:west',
          via: 'ancestor',
        },
        {
          object: 'region:west',
          relation: 'viewer',
          subject: 'group:night-crew',
          via: 'userset',
        },
        {
          object: 'group:night-crew',
          relation: 'member',
          subject: 'user:alice',
          via: 'direct',
        },
      ],
    });

    const group = await call('group:night-crew', 'access/explain', {
      action: 'scan:view',
      id: '91',
    });
    expect(output(group.json)).toEqual({
      allowed: true,
      action: 'scan:view',
      resource: 'scan:91',
      actor: 'group:night-crew',
      steps: [
        {
          object: 'scan:91',
          relation: 'parent',
          subject: 'location:gate-a',
          via: 'ancestor',
        },
        {
          object: 'location:gate-a',
          relation: 'parent',
          subject: 'region:west',
          via: 'ancestor',
        },
        {
          object: 'region:west',
          relation: 'viewer',
          subject: 'group:night-crew',
          via: 'direct',
        },
      ],
    });

    const denied = await call('alice', 'access/explain', {
      action: 'scan:edit',
      id: '91',
    });
    expect(output(denied.json)).toEqual({
      allowed: false,
      action: 'scan:edit',
      resource: 'scan:91',
      actor: 'user:alice',
      steps: [],
    });
  });
});

describe('writes', () => {
  it('writes a parent tuple when a record is created', async () => {
    expect(
      (
        await call('alice', 'regions/create', {
          id: 'north',
          name: 'North',
          orgId: 'acme',
        })
      ).status,
    ).toBe(403);

    const region = await call('ada', 'regions/create', {
      id: 'north',
      name: 'North',
      orgId: 'acme',
    });
    expect(region.status).toBe(200);
    expect(output(region.json)).toEqual({
      id: 'north',
      name: 'North',
      orgId: 'acme',
    });

    const location = await call('ada', 'locations/create', {
      id: 'dock',
      name: 'Dock',
      parent: { type: 'region', id: 'north' },
    });
    expect(location.status).toBe(200);

    const scan = await call('ada', 'scans/create', {
      id: '94',
      title: 'Dock',
      locationId: 'dock',
    });
    expect(scan.status).toBe(200);
    expect(output(scan.json)).toEqual({
      id: '94',
      title: 'Dock',
      locationId: 'dock',
    });
    expect(ids(output((await call('helen', 'scans/list', {})).json))).toContain(
      '94',
    );
    expect(
      ids(output((await call('alice', 'scans/list', {})).json)),
    ).not.toContain('94');

    expect(
      (
        await call('carol', 'scans/create', {
          id: '95',
          title: 'East dock',
          locationId: 'gate-a',
        })
      ).status,
    ).toBe(403);
    const east = await call('carol', 'scans/create', {
      id: '95',
      title: 'East dock',
      locationId: 'gate-c',
    });
    expect(east.status).toBe(200);
    expect(ids(output((await call('carol', 'scans/list', {})).json))).toEqual([
      '93',
      '95',
    ]);

    const child = await call('ada', 'scans/create', {
      id: '96',
      title: 'New gate',
      locationId: 'gate-a',
    });
    expect(child.status).toBe(200);
    expect(ids(output((await call('alice', 'scans/list', {})).json))).toEqual([
      '91',
      '92',
      '96',
    ]);
    const explained = await call('alice', 'access/explain', {
      action: 'scan:view',
      id: '96',
    });
    expect(output(explained.json)).toEqual({
      allowed: true,
      action: 'scan:view',
      resource: 'scan:96',
      actor: 'user:alice',
      steps: [
        {
          object: 'scan:96',
          relation: 'parent',
          subject: 'location:gate-a',
          via: 'ancestor',
        },
        {
          object: 'location:gate-a',
          relation: 'parent',
          subject: 'region:west',
          via: 'ancestor',
        },
        {
          object: 'region:west',
          relation: 'viewer',
          subject: 'group:night-crew',
          via: 'userset',
        },
        {
          object: 'group:night-crew',
          relation: 'member',
          subject: 'user:alice',
          via: 'direct',
        },
      ],
    });

    expect(
      (
        await call('ada', 'scans/create', {
          id: '96',
          title: 'Again',
          locationId: 'gate-a',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call('alice', 'scans/create', {
          id: '97',
          title: 'Nope',
          locationId: 'gate-a',
        })
      ).status,
    ).toBe(403);
  });

  it('shares a resource with a tuple', async () => {
    expect(
      ids(output((await call('outsider', 'scans/list', {})).json)),
    ).toEqual([]);
    expect(
      (
        await call('alice', 'shares/grant', {
          type: 'scan',
          id: '91',
          relation: 'viewer',
          subject: 'user:outsider',
        })
      ).status,
    ).toBe(403);

    const share = await call('carol', 'shares/grant', {
      type: 'scan',
      id: '93',
      relation: 'viewer',
      subject: 'user:outsider',
    });
    expect(share.status).toBe(200);
    expect(output(share.json)).toEqual({
      object: 'scan:93',
      relation: 'viewer',
      subject: 'user:outsider',
    });
    expect(
      ids(output((await call('outsider', 'scans/list', {})).json)),
    ).toEqual(['93']);

    await call('carol', 'shares/grant', {
      type: 'scan',
      id: '93',
      relation: 'viewer',
      subject: 'user:outsider',
    });
    expect(
      ids(output((await call('outsider', 'scans/list', {})).json)),
    ).toEqual(['93']);

    const removed = await call('carol', 'shares/revoke', {
      type: 'scan',
      id: '93',
      relation: 'viewer',
      subject: 'user:outsider',
    });
    expect(removed.status).toBe(200);
    expect(
      ids(output((await call('outsider', 'scans/list', {})).json)),
    ).toEqual([]);

    const cross = await call('ada', 'shares/grant', {
      type: 'scan',
      id: '7',
      relation: 'viewer',
      subject: 'user:outsider',
    });
    expect(cross.status).toBe(200);
    expect(
      ids(output((await call('outsider', 'scans/list', {})).json)),
    ).toEqual(['7']);
    expect(ids(output((await call('gina', 'scans/list', {})).json))).toEqual([
      '7',
    ]);

    const parent = await call('ada', 'shares/grant', {
      type: 'scan',
      id: '7',
      relation: 'parent',
      subject: 'user:outsider',
    });
    expect(parent.status).toBe(400);
    expect(parent.json).toEqual({
      ok: false,
      error: {
        code: 'ShareRelationInvalid',
        message: 'A share relation is viewer or editor.',
      },
    });
  });

  it('adds a group member and grants the group', async () => {
    const created = await call('dave', 'groups/create', {
      id: 'helpers',
      name: 'Helpers',
    });
    expect(created.status).toBe(200);
    expect(output(created.json)).toEqual({ id: 'helpers', name: 'Helpers' });
    expect(ids(output((await call('dave', 'scans/list', {})).json))).toEqual(
      [],
    );
    expect(ids(output((await call('dave', 'groups/list', {})).json))).toEqual([
      'helpers',
    ]);

    const group = await call('ada', 'groups/create', {
      id: 'weekend',
      name: 'Weekend',
    });
    expect(group.status).toBe(200);
    expect(
      (
        await call('alice', 'groups/addMember', {
          id: 'weekend',
          subject: 'user:noah',
        })
      ).status,
    ).toBe(403);

    const member = await call('ada', 'groups/addMember', {
      id: 'weekend',
      subject: 'user:noah',
    });
    expect(output(member.json)).toEqual({
      object: 'group:weekend',
      relation: 'member',
      subject: 'user:noah',
    });
    expect(ids(output((await call('noah', 'scans/list', {})).json))).toEqual(
      [],
    );

    const grant = await call('ada', 'shares/grant', {
      type: 'location',
      id: 'gate-b',
      relation: 'viewer',
      subject: 'group:weekend',
    });
    expect(grant.status).toBe(200);
    expect(ids(output((await call('noah', 'scans/list', {})).json))).toEqual([
      '92',
    ]);

    await call('ada', 'groups/removeMember', {
      id: 'weekend',
      subject: 'user:noah',
    });
    expect(ids(output((await call('noah', 'scans/list', {})).json))).toEqual(
      [],
    );
  });

  it('writes a note under a scan the actor can edit', async () => {
    expect(
      (
        await call('bob', 'notes/create', {
          id: '8',
          body: 'Loose bolt',
          parent: { type: 'scan', id: '91' },
        })
      ).status,
    ).toBe(403);
    const note = await call('bob', 'notes/create', {
      id: '8',
      body: 'Loose bolt',
      parent: { type: 'scan', id: '92' },
    });
    expect(note.status).toBe(200);
    expect(output(note.json)).toEqual({
      id: '8',
      body: 'Loose bolt',
      parent: { type: 'scan', id: '92' },
    });
    expect(ids(output((await call('alice', 'notes/list', {})).json))).toEqual([
      '5',
      '6',
      '8',
    ]);
    expect(ids(output((await call('bob', 'notes/list', {})).json))).toEqual([
      '6',
      '8',
    ]);
  });
});

describe('requests', () => {
  it('requires an actor and a known procedure', async () => {
    expect((await call(null, 'scans/list', {})).status).toBe(401);
    const missing = await handle(
      new Request('http://127.0.0.1/missing', {
        method: 'POST',
        headers: { 'x-actor': 'alice', 'content-type': 'application/json' },
        body: JSON.stringify({ input: {} }),
      }),
    );
    expect(missing.status).toBe(404);

    const method = await handle(
      new Request('http://127.0.0.1/rpc/scans/get', {
        method: 'PUT',
        headers: { 'x-actor': 'alice', 'content-type': 'application/json' },
        body: JSON.stringify({ input: { id: '91' } }),
      }),
    );
    expect(method.status).toBe(405);

    const actor = await call('crew:ada', 'scans/list', {});
    expect(actor.status).toBe(400);
    expect(errorOf(actor.json).code).toBe('Authz');

    const bad = await call('alice', 'scans/create', {}, 'not-json');
    expect(bad.status).toBe(400);
    expect(errorOf(bad.json).code).toBe('BAD_REQUEST');

    const action = await call('alice', 'access/explain', {
      action: 'scan:delete',
      id: '91',
    });
    expect(action.status).toBe(422);
    expect(errorOf(action.json).code).toBe('VALIDATION');
  });

  it('rejects input the schema does not accept before execute runs', async () => {
    const api = createApi(await createRuntime());
    const error = await api.createScan
      .execute({ actor: { id: 'ada' } }, {
        id: 'x',
        title: 1,
        locationId: 'gate-a',
      } as never)
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(CodedError);
    expect((error as CodedError).code).toBe('VALIDATION');
    expect((error as CodedError).message).toBe('scan.create input is invalid');
  });

  it('serves the handler over HTTP', async () => {
    const server = serve({
      port: 0,
      fetch: handle,
      gracefulShutdown: false,
      silent: true,
    });
    try {
      await server.ready();
      const response = await fetch(`${server.url}rpc/scans/list`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-actor': 'alice',
        },
        body: JSON.stringify({ input: {} }),
      });
      expect(response.status).toBe(200);
      expect(output(await response.json())).toEqual([
        { id: '91', title: 'Gate A', locationId: 'gate-a' },
        { id: '92', title: 'Gate B', locationId: 'gate-b' },
      ]);
    } finally {
      await server.close();
    }
  });
});

describe('records', () => {
  it('keeps authorization out of domain records and repositories', () => {
    const roots = [join(srcRoot, 'domain'), join(srcRoot, 'infra', 'repos')];
    for (const root of roots) {
      for (const file of sources(root)) {
        const source = readFileSync(file, 'utf8');
        expect(source.includes('@hexok/authz'), file).toBe(false);
      }
    }
  });
});

function sources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sources(path));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

async function call(
  actor: string | null,
  path: string,
  input: unknown,
  body?: string,
): Promise<{ status: number; json: unknown }> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (actor !== null) headers.set('x-actor', actor);
  const response = await handle(
    new Request(`http://127.0.0.1/rpc/${path}`, {
      method: 'POST',
      headers,
      body: body ?? JSON.stringify({ input }),
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    json: text === '' ? null : (JSON.parse(text) as unknown),
  };
}

function output(body: unknown): unknown {
  if (body === null || typeof body !== 'object' || !('output' in body)) {
    throw new Error('expected an output envelope');
  }
  return body.output;
}

function errorOf(body: unknown): { code: string; message: string } {
  if (
    body === null ||
    typeof body !== 'object' ||
    !('error' in body) ||
    body.error === null ||
    typeof body.error !== 'object' ||
    !('code' in body.error) ||
    !('message' in body.error)
  ) {
    throw new Error('expected an error envelope');
  }
  const code = body.error.code;
  const message = body.error.message;
  if (typeof code !== 'string' || typeof message !== 'string') {
    throw new Error('expected an error code');
  }
  return { code, message };
}

function ids(body: unknown): string[] {
  if (!Array.isArray(body)) throw new Error('expected a list');
  return body.map((item) => {
    if (item === null || typeof item !== 'object' || !('id' in item)) {
      throw new Error('expected records');
    }
    const id = item.id;
    if (typeof id !== 'string') throw new Error('expected an id');
    return id;
  });
}
