import { type EventCtx, EventUseCase } from 'kerf/app';
import { DomainEvents, IncidentClosed } from '../domain/events.js';
import { Notifier } from '../ports.js';

export class NotifyOnClose extends EventUseCase {
  static readonly key = 'incident.notifyOnClose';

  static on = IncidentClosed;

  static catalog = DomainEvents;

  static ports = { notifier: Notifier };

  async execute({ event, ports }: EventCtx<typeof NotifyOnClose>) {
    await ports.notifier.send(event.payload);
  }
}
