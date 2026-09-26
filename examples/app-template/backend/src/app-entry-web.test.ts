import { Adapter } from 'hexok';
import { describe, expect, it } from 'vitest';
import { inMemoryEvents } from './adapters/in-memory-events.js';
import { createHeavyWorker } from './app-entry-heavy.js';
import { createWebApp } from './app-entry-web.js';
import { UserCreatedEvent } from './events/user-created.js';
import { SendWelcomeEmailHandler } from './handlers/send-welcome-email.js';
import { EmailSender } from './ports/email-sender.js';
import { SearchIndex } from './ports/search-index.js';

class RecordingEmail extends Adapter(EmailSender) {
  readonly sent: { to: string; subject: string; body: string }[] = [];

  async send(to: string, subject: string, body: string): Promise<void> {
    this.sent.push({ to, subject, body });
  }
}

class RecordingSearch extends Adapter(SearchIndex) {
  readonly indexed: { id: string; name: string; email: string }[] = [];

  async indexUser(id: string, name: string, email: string): Promise<void> {
    this.indexed.push({ id, name, email });
  }
}

class FailingEmail extends Adapter(EmailSender) {
  async send(): Promise<void> {
    throw new Error('mail failed');
  }
}

const ada = { id: '1', name: 'Ada', email: 'ada@ex.com' };

describe('event handlers', () => {
  it('runs a handler with its port and no bus', async () => {
    const email = new RecordingEmail();
    await new SendWelcomeEmailHandler(email).handle(new UserCreatedEvent(ada));
    expect(email.sent.map((message) => message.to)).toEqual(['ada@ex.com']);
  });

  it('delivers a created user to the web handlers', async () => {
    const email = new RecordingEmail();
    const search = new RecordingSearch();
    const events = inMemoryEvents();
    const app = createWebApp({
      publisher: events.publisher,
      subscriptions: events.subscriptions,
      email,
      search,
    });
    await events.subscriptions.start();

    const user = await app.createUser.execute(ada);

    expect(user.props).toMatchObject(ada);
    expect(email.sent.map((message) => message.to)).toEqual(['ada@ex.com']);
    expect(search.indexed).toEqual([ada]);
    expect(events.publisher.published[0]).toBeInstanceOf(UserCreatedEvent);
  });

  it('subscribes the heavy handler beside the web handlers', async () => {
    const email = new RecordingEmail();
    const search = new RecordingSearch();
    const events = inMemoryEvents();
    const app = createWebApp({
      publisher: events.publisher,
      subscriptions: events.subscriptions,
      email,
      search,
    });
    createHeavyWorker({ subscriptions: events.subscriptions });
    await events.subscriptions.start();

    await app.createUser.execute(ada);

    expect(email.sent).toHaveLength(1);
    expect(search.indexed).toHaveLength(1);
    expect(events.publisher.failures).toEqual([]);
  });

  it('keeps the user and the other handlers when one handler throws', async () => {
    const search = new RecordingSearch();
    const events = inMemoryEvents();
    const app = createWebApp({
      publisher: events.publisher,
      subscriptions: events.subscriptions,
      email: new FailingEmail(),
      search,
    });
    createHeavyWorker({ subscriptions: events.subscriptions });
    await events.subscriptions.start();

    await expect(app.createUser.execute(ada)).resolves.toMatchObject({
      props: ada,
    });
    expect(search.indexed).toEqual([ada]);
    expect(events.publisher.failures).toEqual([
      expect.objectContaining({
        token: 'send.welcome.email',
        groupId: 'user-welcome-email',
      }),
    ]);
    expect(await app.users.get(ada.id)).toMatchObject({ props: ada });
  });

  it('requires start after handlers are subscribed', async () => {
    const events = inMemoryEvents();
    createWebApp({
      publisher: events.publisher,
      subscriptions: events.subscriptions,
      email: new RecordingEmail(),
      search: new RecordingSearch(),
    });

    await expect(
      events.publisher.publish(new UserCreatedEvent(ada)),
    ).rejects.toThrow(/start\(\)/);
  });
});
