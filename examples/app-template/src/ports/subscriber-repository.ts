import { Port } from 'hexok';
import type { SubscriberEntity } from '../entities/subscriber.js';

export abstract class SubscriberRepository extends Port(
  'SubscriberRepository',
) {
  abstract getByEmail(email: string): Promise<SubscriberEntity | null>;
  abstract list(): Promise<readonly SubscriberEntity[]>;
  abstract save(subscriber: SubscriberEntity): Promise<void>;
}
