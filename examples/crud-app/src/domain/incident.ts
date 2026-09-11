import type { Infer } from 'kerf/core';
import { Entity } from 'kerf/domain';
import { z } from 'zod';

export const incidentSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['open', 'closed']),
  closedAt: z.date().nullable(),
});

export type IncidentProps = Infer<typeof incidentSchema>;

/**
 * `rename` / `close` mutate **this** and return `this`.
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

  rename(title: string): this {
    return this.set((draft) => {
      draft.title = title;
    });
  }

  close(now: Date): this {
    if (this.props.status === 'closed') this.error('ALREADY_CLOSED');
    return this.set((draft) => {
      draft.status = 'closed';
      draft.closedAt = now;
    });
  }
}
