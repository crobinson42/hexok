import { EventHandler } from 'hexok';
import { UserCreatedEvent } from '../events/user-created.js';

export class HeavyComputationTaskHandler extends EventHandler(
  'heavy.computation.task',
  UserCreatedEvent,
) {
  static readonly groupId = 'heavy-computation-task';

  async handle(event: UserCreatedEvent): Promise<void> {
    // Placeholder for a heavy computation on the created user.
    void event;
  }
}
