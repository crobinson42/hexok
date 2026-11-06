import { Entity } from 'hexok';
import { SubscriberSchema } from '../schemas/subscriber.js';

export class SubscriberEntity extends Entity('Subscriber', SubscriberSchema) {
  /** The endpoint answered 410. `get` then returns null, which stops pending deliveries. */
  disableWebhook(): this {
    return this.set((draft) => {
      draft.webhookDisabled = true;
    });
  }
}
