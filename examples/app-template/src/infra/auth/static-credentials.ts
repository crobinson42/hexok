import { timingSafeEqual } from 'node:crypto';
import { Adapter } from 'hexok';
import { Credentials } from '../../app/ports/auth/credentials.js';

/**
 * The template's users. Passwords are compared as given. A product replaces
 * this adapter and stores a hash.
 */
export const demoUsers: ReadonlyMap<string, string> = new Map([
  ['ada', 'password'],
  ['bea', 'password'],
]);

export class StaticCredentials extends Adapter(Credentials) {
  readonly #users: ReadonlyMap<string, string>;

  constructor(users: ReadonlyMap<string, string>) {
    super();
    this.#users = users;
  }

  override async check(input: {
    userId: string;
    password: string;
  }): Promise<boolean> {
    const expected = this.#users.get(input.userId);
    if (expected === undefined) return false;
    const actual = Buffer.from(input.password);
    const target = Buffer.from(expected);
    if (actual.length !== target.length) return false;
    return timingSafeEqual(actual, target);
  }
}
