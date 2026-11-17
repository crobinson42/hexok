import { Port } from 'hexok';

/** The password check `Login` calls. A product replaces the adapter. */
export abstract class Credentials extends Port('Credentials') {
  abstract check(input: { userId: string; password: string }): Promise<boolean>;
}
