import { Port } from 'hexok';

/** A caller whose token checked out. */
export type Caller = {
  readonly userId: string;
  /** One sign-in. Ending it revokes the token. */
  readonly sessionId: string;
  /** When the token stops checking out. Omitted when it does not expire. */
  readonly expiresAt?: Date;
};

export abstract class Authenticator extends Port('Authenticator') {
  /** The caller for `token`, or `null` when the token is not valid. */
  abstract authenticate(token: string): Promise<Caller | null>;

  /** The caller's token stops checking out, in every process. */
  abstract revoke(caller: Caller): Promise<void>;
}
