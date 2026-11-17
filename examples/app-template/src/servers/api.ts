import type { Credentials } from '../app/ports/auth/credentials.js';
import type { DomainEventPublisher } from '../app/ports/events/domain-event-publisher.js';
import type { OrganizationRepository } from '../app/ports/repos/organization-repository.js';
import type { PostRepository } from '../app/ports/repos/post-repository.js';
import type { SubscriberRepository } from '../app/ports/repos/subscriber-repository.js';
import type { UserRepository } from '../app/ports/repos/user-repository.js';
import { Membership } from '../app/services/membership.js';
import { Login } from '../app/use-cases/auth/api/command/login.js';
import { Logout } from '../app/use-cases/auth/api/command/logout.js';
import { WhoAmI } from '../app/use-cases/auth/api/command/who-am-i.js';
import { AddMember } from '../app/use-cases/organizations/api/command/add-member.js';
import { CreateOrganization } from '../app/use-cases/organizations/api/command/create-organization.js';
import { ListMine } from '../app/use-cases/organizations/api/command/list-mine.js';
import { PublishPost } from '../app/use-cases/posts/api/command/publish-post.js';
import { SavePost } from '../app/use-cases/posts/api/command/save-post.js';
import { UnpublishPost } from '../app/use-cases/posts/api/command/unpublish-post.js';
import {
  type CheckWebhookUrl,
  SubscribeToPosts,
} from '../app/use-cases/subscribers/api/command/subscribe.js';
import { CreateUser } from '../app/use-cases/users/api/command/create-user.js';
import { GetUser } from '../app/use-cases/users/api/command/get-user.js';

export type ApiPorts = {
  posts: PostRepository;
  subscribers: SubscriberRepository;
  users: UserRepository;
  organizations: OrganizationRepository;
  credentials: Credentials;
  domainEvents: DomainEventPublisher;
  checkWebhookUrl: CheckWebhookUrl;
};

/**
 * The API use cases, built from ports. Any transport calls these:
 * the RPC procedures in `rpc/app.ts`, a CLI, or a test.
 */
export function createApi(ports: ApiPorts) {
  const membership = new Membership({ users: ports.users });
  return {
    login: new Login({
      credentials: ports.credentials,
      users: ports.users,
    }),
    logout: new Logout(),
    whoAmI: new WhoAmI({ users: ports.users }),
    createUser: new CreateUser({ users: ports.users }),
    getUser: new GetUser({ users: ports.users }),
    createOrganization: new CreateOrganization({
      organizations: ports.organizations,
      users: ports.users,
    }),
    addMember: new AddMember({
      organizations: ports.organizations,
      users: ports.users,
    }),
    listMine: new ListMine({
      organizations: ports.organizations,
      users: ports.users,
    }),
    savePost: new SavePost({
      posts: ports.posts,
      membership,
      organizations: ports.organizations,
    }),
    publishPost: new PublishPost({
      posts: ports.posts,
      membership,
      domainEvents: ports.domainEvents,
    }),
    unpublishPost: new UnpublishPost({
      posts: ports.posts,
      membership,
      domainEvents: ports.domainEvents,
    }),
    subscribeToPosts: new SubscribeToPosts({
      subscribers: ports.subscribers,
      organizations: ports.organizations,
      domainEvents: ports.domainEvents,
      checkWebhookUrl: ports.checkWebhookUrl,
    }),
  };
}

export type Api = ReturnType<typeof createApi>;
