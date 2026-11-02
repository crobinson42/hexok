import { z } from 'zod';

/** A relationship tuple on the wire. A product record does not store it. */
export const tupleSchema = z.object({
  object: z.string(),
  relation: z.string(),
  subject: z.string(),
});

export const explanationSchema = z.object({
  allowed: z.boolean(),
  action: z.string(),
  resource: z.string(),
  actor: z.string(),
  steps: z.array(
    z.object({
      object: z.string(),
      relation: z.string(),
      subject: z.string(),
      via: z.enum(['direct', 'userset', 'ancestor']),
    }),
  ),
});
