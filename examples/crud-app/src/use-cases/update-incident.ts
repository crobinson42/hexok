import { type ExecuteCtx, ExternalUseCase } from 'hexok/app';
import { z } from 'zod';
import { incidentSchema } from '../domain/incident.js';
import { IncidentRepository } from '../ports.js';

export class UpdateIncident extends ExternalUseCase {
  static readonly key = 'incident.update';

  static input = z.object({ id: z.string(), title: z.string() });

  static output = incidentSchema;

  static errors = {
    NOT_FOUND: { message: 'Incident not found' },
  };

  static ports = { incidents: IncidentRepository };

  async execute({ input, ports, errors }: ExecuteCtx<typeof UpdateIncident>) {
    const incident = await ports.incidents.get(input.id);

    if (!incident) throw errors.NOT_FOUND();

    const renamed = incident.rename(input.title);

    await ports.incidents.save(renamed);

    return renamed.toProps();
  }
}
