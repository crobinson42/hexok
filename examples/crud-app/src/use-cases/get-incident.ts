import { ApiUseCase, type ExecuteCtx } from 'hexok/app';
import { z } from 'zod';
import { incidentSchema } from '../domain/incident.js';
import { IncidentRepository } from '../ports.js';

export class GetIncident extends ApiUseCase {
  static readonly key = 'incident.get';
  static input = z.object({ id: z.string() });

  static output = incidentSchema;

  static errors = {
    NOT_FOUND: { message: 'Incident not found' },
  };

  static ports = { incidents: IncidentRepository };

  async execute({ input, ports, errors }: ExecuteCtx<typeof GetIncident>) {
    const incident = await ports.incidents.get(input.id);

    if (!incident) throw errors.NOT_FOUND();

    return incident.toProps();
  }
}
