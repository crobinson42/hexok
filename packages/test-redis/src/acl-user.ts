import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Redis } from 'ioredis';

/** One `ACL LOG` entry. `reason` is `command`, `key`, `channel`, or `auth`. */
export interface AclRefusal {
  readonly reason: string;
  readonly object: string;
  readonly username: string;
}

export interface AclUser {
  readonly name: string;
  /** `adminUrl` with this user's credentials. */
  readonly url: string;
  /** What Redis refused this user. `ACL LOG` is server-wide, so entries of other users are left out. */
  refusals(): Promise<readonly AclRefusal[]>;
}

/** The rules of the first `ACL SETUSER <name> ...` line in a README. The user name and any `>password` are left out. */
export async function documentedAclRules(
  readme: URL,
): Promise<readonly string[]> {
  const text = await readFile(readme, 'utf8');
  const line = text
    .split('\n')
    .find((candidate) => candidate.startsWith('ACL SETUSER '));
  if (line === undefined) throw new Error(`no ACL SETUSER line in ${readme}`);
  return line
    .split(' ')
    .slice(3)
    .filter((rule) => !rule.startsWith('>'));
}

/**
 * Runs `body` with a new user that has `rules` and a random name and password, then deletes the user.
 * `adminUrl` must be allowed to run `ACL SETUSER`, `ACL LOG`, and `ACL DELUSER`.
 */
export async function withAclUser<T>(
  adminUrl: string,
  rules: readonly string[],
  body: (user: AclUser) => Promise<T>,
): Promise<T> {
  const admin = new Redis(adminUrl);
  const name = `hexok-test-${randomUUID()}`;
  const password = randomUUID();
  try {
    await admin.acl('SETUSER', name, `>${password}`, ...rules);
    const url = new URL(adminUrl);
    url.username = name;
    url.password = password;
    return await body({
      name,
      url: url.href,
      refusals: async () => {
        const entries = (await admin.acl('LOG')) as unknown as unknown[][];
        return entries
          .map(refusalOf)
          .filter((refusal) => refusal.username === name);
      },
    });
  } finally {
    await admin.acl('DELUSER', name);
    await admin.quit();
  }
}

function refusalOf(entry: unknown[]): AclRefusal {
  const field = (name: string) => String(entry[entry.indexOf(name) + 1]);
  return {
    reason: field('reason'),
    object: field('object'),
    username: field('username'),
  };
}
