import type { Infer } from 'plinth/core';
import { Entity } from 'plinth/domain';
import { z } from 'zod';

export const incidentSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['open', 'closed']),
  closedAt: z.date().nullable(),
});

export type IncidentProps = Infer<typeof incidentSchema>;

/**
 * Untracked value object. `close` returns a **new** instance.
 */
export class Incident extends Entity<IncidentProps> {
  static schema = incidentSchema;

  static errors = {
    ALREADY_CLOSED: { message: 'Incident already closed' },
  };

  static open(id: string, title: string): Incident {
    return Incident.create({
      id,
      title,
      status: 'open',
      closedAt: null,
    });
  }

  rename(title: string): Incident {
    return this.with({ title });
  }

  close(now: Date): Incident {
    if (this.props.status === 'closed') this.error('ALREADY_CLOSED');
    return this.with({ status: 'closed', closedAt: now });
  }
}
