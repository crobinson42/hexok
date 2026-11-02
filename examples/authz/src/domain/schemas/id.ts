import { z } from 'zod';

/** An authz id: 1 to 200 characters, with no whitespace, `#`, or NUL. */
export const idSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !/[\s#\0]/.test(value), { message: 'must be an id' });

/** A name, title, or note body. */
export const textSchema = z.string().min(1).max(200);
