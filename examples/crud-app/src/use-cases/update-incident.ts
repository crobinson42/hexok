import { ApiUseCase, type ExecuteCtx } from '@plinth/app';
import { z } from 'zod';
import { incidentSchema } from '../domain/incident.js';
import { IncidentRepository } from '../ports.js';

export class UpdateIncident extends ApiUseCase {
  static readonly id = 'incident.update';
  static readonly input = z.object({ id: z.string(), title: z.string() });
  static readonly output = incidentSchema;
  static readonly errors = {
    NOT_FOUND: { status: 404, message: 'Incident not found' },
  } as const;
  static readonly ports = { incidents: IncidentRepository };

  async execute({ input, ports, errors }: ExecuteCtx<typeof UpdateIncident>) {
    const incident = await ports.incidents.get(input.id);
    if (!incident) throw errors.NOT_FOUND();
    const renamed = incident.rename(input.title);
    await ports.incidents.save(renamed);
    return renamed.toProps();
  }
}
