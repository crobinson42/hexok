import { type ExecuteCtx, ExternalUseCase } from 'hexok/app';
import { z } from 'zod';
import { incidentSchema } from '../domain/incident.js';
import { IncidentRepository } from '../ports.js';

export class ListIncidents extends ExternalUseCase {
  static readonly key = 'incident.list';

  static input = z.object({});

  static output = z.array(incidentSchema);

  static errors = {};

  static ports = { incidents: IncidentRepository };

  async execute({ ports }: ExecuteCtx<typeof ListIncidents>) {
    const incidents = await ports.incidents.list();

    return incidents.map((incident) => incident.toProps());
  }
}
