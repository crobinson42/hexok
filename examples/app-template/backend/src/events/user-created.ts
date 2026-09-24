import { Event } from 'hexok';
import { UserSchema } from '../schemas/user.js';

export class UserCreatedEvent extends Event('user.created', UserSchema) {}
