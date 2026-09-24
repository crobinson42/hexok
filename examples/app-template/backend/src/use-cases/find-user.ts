import {UseCase} from "hexok";
import type {UserRepository} from "../ports/user-repository.js";

export class FindUserUseCase extends UseCase('user.find') {
    constructor(private deps: {
        usersRepo: UserRepository
    }) {
        super();
    }

    async execute({ userId }: { userId: string }) {
        // Simulate fetching user data from a database or external service
        const user = await this.deps.usersRepo.get(userId);
        if (!user) {
            throw new Error(`User with ID ${userId} not found`);
        }
        return user;
    }
}