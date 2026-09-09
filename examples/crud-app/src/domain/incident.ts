import { fail, type Infer, ok, type Result } from '@plinth/core';
import { Entity } from '@plinth/domain';
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
  static readonly type = 'Incident';
  static readonly schema = incidentSchema;
  static readonly errors = {
    ALREADY_CLOSED: { status: 409, message: 'Incident already closed' },
  } as const;

  get id() {
    return this.props.id;
  }
  get title() {
    return this.props.title;
  }
  get status() {
    return this.props.status;
  }
  get closedAt() {
    return this.props.closedAt;
  }

  static open(id: string, title: string): Incident {
    const created = Incident.create({
      id,
      title,
      status: 'open',
      closedAt: null,
    });
    if (!created.ok) throw new Error('plinth: Incident.open failed validation');
    return created.value;
  }

  rename(title: string): Incident {
    return this.with({ title });
  }

  close(now: Date): Result<Incident, 'ALREADY_CLOSED'> {
    if (this.props.status === 'closed') return fail('ALREADY_CLOSED');
    return ok(this.with({ status: 'closed', closedAt: now }));
  }
}