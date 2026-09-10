import { App, InMemoryBus, InMemoryRepository } from 'plinth/testing';
import { type AppContext, defaultContext } from './context.js';
import { DomainEvents } from './domain/events.js';
import { Incident } from './domain/incident.js';
import { Site } from './domain/site.js';
import {
  Clock,
  IncidentRepository,
  Notifier,
  SiteRepository,
} from './ports.js';
import { useCases } from './use-cases.js';

export function recordingNotifier() {
  const sent: Array<{ id: string; closedAt: Date }> = [];
  return {
    sent,
    async send(payload: { id: string; closedAt: Date }) {
      sent.push(payload);
    },
  };
}

export function createApp(options?: {
  now?: Date;
  notifier?: ReturnType<typeof recordingNotifier>;
}) {
  const notifier = options?.notifier ?? recordingNotifier();

  const now = options?.now ?? new Date('2026-01-01T00:00:00Z');

  const app = App.test(useCases)
    .provide(
      IncidentRepository,
      InMemoryRepository.of(IncidentRepository, {
        keyBy: 'id',
        seed: [Incident.open('1', 'Seeded')],
      }),
    )
    .provide(
      SiteRepository,
      InMemoryRepository.of(SiteRepository, {
        keyBy: 'id',
        seed: [Site.hq()],
      }),
    )
    .provide(Clock, { now: () => now })
    .provide(Notifier, notifier)
    .bind(DomainEvents, InMemoryBus.create())
    .ctx<AppContext>(defaultContext)
    .build();

  return { app, notifier };
}
