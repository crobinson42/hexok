import { describe, expect, it } from 'vitest';
import { createApi } from '../../../../api/index.js';

describe('OrganizationCreatedEventHandler', () => {
  it('projects organization.created onto the client bus', async () => {
    const { app, clientBus } = createApi();
    await app.start();

    await app.local.organization.register({
      organization: { id: 'org-1', name: 'Acme' },
      user: {
        id: 'u1',
        name: 'Ada',
        email: 'ada@example.com',
      },
    });

    expect(
      clientBus.published.filter(
        (envelope) =>
          envelope.catalog === 'client' &&
          envelope.key === 'organization.created',
      ),
    ).toEqual([
      expect.objectContaining({
        payload: { id: 'org-1', name: 'Acme' },
        ctx: { kind: 'organization', organizationIds: ['org-1'] },
      }),
    ]);

    await app.stop();
  });
});
