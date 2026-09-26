import { EventHandler } from 'hexok';
import { UserCreatedEvent } from '../events/user-created.js';
import type { SearchIndex } from '../ports/search-index.js';

export class IndexUserHandler extends EventHandler(
  'index.user',
  UserCreatedEvent,
) {
  static readonly groupId = 'user-search-indexing';

  constructor(private readonly search: SearchIndex) {
    super();
  }

  async handle(event: UserCreatedEvent): Promise<void> {
    const { id, name, email } = event.payload;
    await this.search.indexUser(id, name, email);
  }
}
