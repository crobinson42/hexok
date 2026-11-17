import { procedure, router } from '@ts-pf/contract';
import { z } from 'zod';
import { loginInput } from '../../app/use-cases/auth/api/command/login.js';
import { logoutInput } from '../../app/use-cases/auth/api/command/logout.js';
import { whoAmIInput } from '../../app/use-cases/auth/api/command/who-am-i.js';
import { addMemberInput } from '../../app/use-cases/organizations/api/command/add-member.js';
import { createOrganizationInput } from '../../app/use-cases/organizations/api/command/create-organization.js';
import { listMineInput } from '../../app/use-cases/organizations/api/command/list-mine.js';
import { publishPostInput } from '../../app/use-cases/posts/api/command/publish-post.js';
import { savePostInput } from '../../app/use-cases/posts/api/command/save-post.js';
import { unpublishPostInput } from '../../app/use-cases/posts/api/command/unpublish-post.js';
import { subscribeToPostsInput } from '../../app/use-cases/subscribers/api/command/subscribe.js';
import { createUserInput } from '../../app/use-cases/users/api/command/create-user.js';
import { getUserInput } from '../../app/use-cases/users/api/command/get-user.js';
import { organizationSchema } from '../../domain/schemas/organization.js';
import { postSchema } from '../../domain/schemas/post.js';
import { subscriberSchema } from '../../domain/schemas/subscriber.js';
import { userSchema } from '../../domain/schemas/user.js';
import { clientErrors } from './errors.js';

/**
 * The API. HTTP serves it at `/rpc`, such as `POST /rpc/posts/save`.
 * Inputs are the use case schemas. Every procedure declares the same
 * client-facing domain errors. The use case decides which one it throws.
 */
const call = procedure.errors(clientErrors);

export const apiContract = router({
  auth: {
    login: call
      .input(loginInput)
      .output(z.object({ token: z.string().min(1) })),
    logout: call.input(logoutInput).output(z.null()),
    whoAmI: call.input(whoAmIInput).output(userSchema),
  },
  users: {
    create: call.input(createUserInput).output(userSchema),
    get: call.input(getUserInput).output(userSchema),
  },
  organizations: {
    create: call.input(createOrganizationInput).output(organizationSchema),
    addMember: call.input(addMemberInput).output(userSchema),
    listMine: call.input(listMineInput).output(z.array(organizationSchema)),
  },
  posts: {
    save: call.input(savePostInput).output(postSchema),
    publish: call.input(publishPostInput).output(postSchema),
    unpublish: call.input(unpublishPostInput).output(postSchema),
  },
  subscribers: {
    subscribe: call.input(subscribeToPostsInput).output(subscriberSchema),
  },
});
