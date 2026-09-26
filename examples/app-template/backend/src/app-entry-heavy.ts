import { HeavyComputationTaskHandler } from './handlers/heavy-computation-task.js';
import type { DomainEventSubscriptions } from './ports/domain-event-subscriptions.js';

/** Worker process. Subscribes the heavy handler on the subscriptions port. */
export function createHeavyWorker(deps: {
  subscriptions: DomainEventSubscriptions;
}) {
  deps.subscriptions.subscribe([new HeavyComputationTaskHandler()]);
}
