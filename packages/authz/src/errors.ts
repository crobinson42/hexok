/** Invalid catalog, tuple, or actor. A denied check is `false`, not an error. */
export class AuthzError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthzError';
  }
}
