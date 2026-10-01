import {PublicApiUseCase} from "../../factory.js";
import type {UserRepository} from "../../../ports/user-repository.js";

export class ListUserProfilesUseCase extends PublicApiUseCase('list-user-profiles') {
    constructor(private deps: {
        usersRepo: UserRepository
    }) {
        super();
    }

    async execute() {
        const users = await this.deps.usersRepo.findAll()

        return users.map(user => ({
            id: user.props.id,
            name: user.props.name,
        }));
    }
}