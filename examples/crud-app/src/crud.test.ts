import type { CodedError } from '@plinth/core';
import { describe, expect, it } from 'vitest';
import { createApp } from './create-app.js';

describe('crud-app', () => {
  it('create / get / list / update / close via app.local', async () => {
    const { app } = createApp();
    const created = await app.local.incident.create({
      id: '2',
      title: 'New',
    });
    expect(created.title).toBe('New');
    expect((await app.local.incident.get({ id: '2' })).id).toBe('2');
    const listed = await app.local.incident.list({});
    expect(listed.map((row) => row.id).sort()).toEqual(['1', '2']);
    const updated = await app.local.incident.update({
      id: '2',
      title: 'Renamed',
    });
    expect(updated.title).toBe('Renamed');
    const closed = await app.local.incident.close({ id: '2' });
    expect(closed.status).toBe('closed');
  });

  it('ALREADY_CLOSED is 409 and NOT_FOUND is 404', async () => {
    const { app } = createApp();
    await app.local.incident.close({ id: '1' });
    await expect(app.local.incident.close({ id: '1' })).rejects.toMatchObject({
      code: 'ALREADY_CLOSED',
      status: 409,
    } satisfies Partial<CodedError>);
    await expect(
      app.local.incident.get({ id: 'missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('duplicate create is 409', async () => {
    const { app } = createApp();
    await expect(
      app.local.incident.create({ id: '1', title: 'dup' }),
    ).rejects.toMatchObject({ code: 'DUPLICATE', status: 409 });
  });

  it('close publishes; second close does not', async () => {
    const { app } = createApp();
    await app.local.incident.close({ id: '1' });
    expect(app.published).toHaveLength(1);
    expect(app.published[0]?.name).toBe('incident.closed');
    await expect(app.local.incident.close({ id: '1' })).rejects.toMatchObject({
      code: 'ALREADY_CLOSED',
    });
    expect(app.published).toHaveLength(1);
  });

  it('notify does not run until start()', async () => {
    const { app, notifier } = createApp();
    await app.local.incident.close({ id: '1' });
    expect(notifier.sent).toHaveLength(0);
    await app.start();
    await app.local.incident.create({ id: '3', title: 'later' });
    await app.local.incident.close({ id: '3' });
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]?.id).toBe('3');
    await app.stop();
  });

  it('HTTP POST /rpc/incident/close', async () => {
    const { app } = createApp();
    const response = await app.router.fetch(
      new Request('http://app/rpc/incident/close', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: { id: '1' } }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      output: { status: string };
    };
    expect(body.ok).toBe(true);
    expect(body.output.status).toBe('closed');
  });

  it('site relocate returns dirty keys', async () => {
    const { app } = createApp();
    const result = await app.local.site.relocate({
      id: 'hq',
      city: 'Denver',
      region: 'CO',
    });
    expect(result.site.address).toEqual({ city: 'Denver', region: 'CO' });
    expect(result.changedKeys).toEqual(['address']);
  });
});
