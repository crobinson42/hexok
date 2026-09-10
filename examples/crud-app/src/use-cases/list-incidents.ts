import { ApiUseCase, type ExecuteCtx } from '@plinth/app';
import { z } from 'zod';
import { incidentSchema } from '../domain/incident.js';
import { IncidentRepository } from '../ports.js';

export class ListIncidents extends ApiUseCase {
  static readonly key = 'incident.list';
  static readonly input = z.object({});
  static readonly output = z.array(incidentSchema);
  static readonly errors = {} as const;
  static readonly ports = { incidents: IncidentRepository };

  async execute({ ports }: ExecuteCtx<typeof ListIncidents>) {
    const incidents = await ports.incidents.list();
    return incidents.map((incident) => incident.toProps());
  }
}
