import { type InferSchema, Mapper } from 'hexok';
import { z } from 'zod';
import { UserEntity } from '../entities/user.js';

const userRecordSchema = z.object({
  _id: z.string(),
  name: z.string(),
  email: z.string(),
});

export type UserRecordData = InferSchema<typeof userRecordSchema>;

/** In-memory row. The entity property `id` is stored as `_id`. */
export class UserRecord extends Mapper(
  'memory.User',
  UserEntity,
  userRecordSchema,
) {
  protected fromSource(user: UserEntity): UserRecordData {
    const props = user.toProps();
    return { _id: props.id, name: props.name, email: props.email };
  }

  protected toSource(record: UserRecordData) {
    return { id: record._id, name: record.name, email: record.email };
  }
}
