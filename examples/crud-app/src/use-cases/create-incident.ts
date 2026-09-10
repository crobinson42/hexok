import { ApiUseCase, type ExecuteCtx } from '@plinth/app';
import { z } from 'zod';
import { DomainEvents, IncidentOpened } from '../domain/events.js';
import { Incident, incidentSchema } from '../domain/incident.js';
import { Clock, IncidentRepository } from '../ports.js';

export class CreateIncident extends ApiUseCase {
  static readonly key = 'incident.create';
  static input = z.object({ id: z.string(), title: z.string() });

  static output = incidentSchema;

  static errors = {
    DUPLICATE: { message: 'Incident already exists' },
  };

  static ports = { incidents: IncidentRepository, clock: Clock };

  static publishes = [DomainEvents];

  async execute({
    input,
    ports,
    errors,
    publish,
  }: ExecuteCtx<typeof CreateIncident>) {
    const existing = await ports.incidents.get(input.id);

    if (existing) throw errors.DUPLICATE();

    const incident = Incident.open(input.id, input.title);

    await ports.incidents.save(incident);

    publish(
      new IncidentOpened({
        id: incident.props.id,
        title: incident.props.title,
        openedAt: ports.clock.now(),
      }),
    );

    return incident.toProps();
  }
}
