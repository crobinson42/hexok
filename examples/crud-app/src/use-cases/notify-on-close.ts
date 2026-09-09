import { type EventCtx, EventUseCase } from '@plinth/app';
import { DomainEvents, IncidentClosed } from '../domain/events.js';
import { Notifier } from '../ports.js';

export class NotifyOnClose extends EventUseCase {
  static readonly id = 'incident.notifyOnClose';
  static readonly on = IncidentClosed;
  static readonly catalog = DomainEvents;
  static readonly ports = { notifier: Notifier };

  async execute({ event, ports }: EventCtx<typeof NotifyOnClose>) {
    const payload = event.payload as { id: string; closedAt: Date };
    await ports.notifier.send(payload);
  }
}
