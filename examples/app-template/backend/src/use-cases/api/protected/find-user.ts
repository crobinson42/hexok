import type { UseCase } from 'hexok';
import type { UserRepository } from '../../../ports/user-repository.js';
import { ActorApiUseCase } from '../../factory.js';

export class FindUserUseCase extends ActorApiUseCase('user.find', {
  allowedActors: ['user'],
  input: undefined,
}) {
  constructor(
    private deps: {
      usersRepo: UserRepository;
    },
  ) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof ActorApiUseCase>,
    { userId }: { userId: string },
  ) {
    // Simulate fetching user data from a database or external service
    const user = await this.deps.usersRepo.get(userId);
    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }
    return user;
  }
}
