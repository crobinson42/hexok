import { describe, expect, it } from 'vitest';
import { MemoryWebhookEndpoints } from './memory-webhook-endpoints.js';

describe('MemoryWebhookEndpoints', () => {
  it('lists enabled endpoints of one organization for an event, and get() returns null once disabled', async () => {
    const endpoints = new MemoryWebhookEndpoints();
    const hook = {
      id: 'ep_1',
      url: 'https://a.example/in',
      secrets: ['whsec_a'],
    };
    endpoints.add('org_1', hook, ['post.published']);
    endpoints.add(
      'org_1',
      { id: 'ep_2', url: 'https://b.example/in', secrets: ['whsec_b'] },
      ['post.unpublished'],
    );
    endpoints.add(
      'org_2',
      { id: 'ep_3', url: 'https://c.example/in', secrets: ['whsec_c'] },
      ['post.published'],
    );
    expect(await endpoints.subscribed('org_1', 'post.published')).toEqual([
      hook,
    ]);
    expect(await endpoints.get('org_1', 'ep_1')).toEqual(hook);
    expect(await endpoints.get('org_2', 'ep_1')).toBeNull();
    endpoints.disable('org_1', 'ep_1');
    expect(await endpoints.subscribed('org_1', 'post.published')).toEqual([]);
    expect(await endpoints.get('org_1', 'ep_1')).toBeNull();
  });
});
