import { ApiUseCase, type ExecuteCtx } from '@plinth/app';
import { z } from 'zod';
import { DomainEvents, IncidentClosed } from '../domain/events.js';
import { Incident, incidentSchema } from '../domain/incident.js';
import { Clock, IncidentRepository } from '../ports.js';

/**
 * load → decide (entity) → save → publish → return
 */
export class CloseIncident extends ApiUseCase {
  static readonly key = 'incident.close';
  static input = z.object({ id: z.string() });
  static output = incidentSchema;
  static errors = {
    ...Incident.errors,
    NOT_FOUND: { status: 404, message: 'Incident not found' },
  } as const;
  static ports = {
    incidents: IncidentRepository,
    clock: Clock,
  };
  static publishes = [DomainEvents] as const;

  async execute({
    input,
    ports,
    errors,
    publish,
  }: ExecuteCtx<typeof CloseIncident>) {
    const incident = await ports.incidents.get(input.id);
    if (!incident) throw errors.NOT_FOUND();

    const closed = incident.close(ports.clock.now());
    if (!closed.ok) throw errors[closed.code]();

    await ports.incidents.save(closed.value);
    publish(
      new IncidentClosed({
        id: closed.value.id,
        closedAt: closed.value.closedAt as Date,
      }),
    );
    return closed.value.toProps();
  }
}
