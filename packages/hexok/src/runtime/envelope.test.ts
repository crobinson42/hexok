import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DomainEvent, EventCatalog } from '../domain/index.js';
import { wrapEvent } from './envelope.js';

class DomainNote extends DomainEvent {
  static readonly key = 'note.posted';
  static readonly schema = z.object({ text: z.string() });
  constructor(public readonly payload: { text: string }) {
    super();
  }
}

class ClientNote extends DomainEvent {
  static readonly key = 'note.posted';
  static readonly schema = z.object({ text: z.string() });
  constructor(public readonly payload: { text: string }) {
    super();
  }
}

describe('wrapEvent', () => {
  const DomainEvents = new EventCatalog('domain', { kind: 'bus' }).event(
    DomainNote,
  );
  const ClientEvents = new EventCatalog('client', { kind: 'bus' }).event(
    ClientNote,
  );
  const publishes = [DomainEvents, ClientEvents];

  it('routes by constructor when two catalogs share a key', () => {
    const domain = wrapEvent(new DomainNote({ text: 'a' }), publishes);
    expect(domain).toMatchObject({
      catalog: 'domain',
      key: 'note.posted',
      kind: 'bus',
      payload: { text: 'a' },
    });

    const client = wrapEvent(new ClientNote({ text: 'a' }), publishes);
    expect(client).toMatchObject({
      catalog: 'client',
      key: 'note.posted',
      kind: 'bus',
      payload: { text: 'a' },
    });
  });

  it('throws when the class is not in publishes', () => {
    expect(() =>
      wrapEvent(new DomainNote({ text: 'a' }), [ClientEvents]),
    ).toThrow(/not in a bound catalog/);
  });

  it('copies ctx when the catalog declared .ctx()', () => {
    type Room = { room: string };
    class ChatSaid extends DomainEvent {
      static readonly key = 'chat.said';
      static readonly schema = z.object({ text: z.string() });
      constructor(
        public readonly payload: { text: string },
        public readonly ctx: Room,
      ) {
        super();
      }
    }
    const ClientEventsWithCtx = new EventCatalog('client', { kind: 'bus' })
      .ctx<Room>()
      .event(ChatSaid);

    const envelope = wrapEvent(
      new ChatSaid({ text: 'hi' }, { room: 'lobby' }),
      [ClientEventsWithCtx],
    );
    expect(envelope.ctx).toEqual({ room: 'lobby' });
    expect(envelope.catalog).toBe('client');
  });

  it('throws when a ctx catalog event has no ctx', () => {
    class BareNote extends DomainEvent {
      static readonly key = 'note.bare';
      static readonly schema = z.object({ text: z.string() });
      constructor(public readonly payload: { text: string }) {
        super();
      }
    }
    const catalog = new EventCatalog('client', { kind: 'bus' })
      .ctx<{ room: string }>()
      .event(BareNote as never);

    expect(() => wrapEvent(new BareNote({ text: 'x' }), [catalog])).toThrow(
      'hexok: event "note.bare" is missing ctx for catalog "client"',
    );
  });

  it('copies correlationId and causationId from request ctx', () => {
    const envelope = wrapEvent(new DomainNote({ text: 'a' }), publishes, {
      correlationId: 'corr',
      causationId: 'cause',
    });
    expect(envelope.correlationId).toBe('corr');
    expect(envelope.causationId).toBe('cause');
  });

  it('does not overwrite tracing ids on a passed-through envelope', () => {
    const existing = wrapEvent(new DomainNote({ text: 'a' }), publishes, {
      correlationId: 'keep',
    });
    const passed = wrapEvent(existing, publishes, { correlationId: 'new' });
    expect(passed.correlationId).toBe('keep');
  });

  it('does not copy ctx for catalogs that did not declare .ctx()', () => {
    class NoteWithCtx extends DomainEvent {
      static readonly key = 'note.extra';
      static readonly schema = z.object({ text: z.string() });
      constructor(
        public readonly payload: { text: string },
        public readonly ctx: { room: string },
      ) {
        super();
      }
    }
    const domain = new EventCatalog('domain', { kind: 'bus' }).event(
      NoteWithCtx,
    );
    const envelope = wrapEvent(new NoteWithCtx({ text: 'a' }, { room: 'x' }), [
      domain,
    ]);
    expect(envelope.ctx).toBeUndefined();
  });
});
