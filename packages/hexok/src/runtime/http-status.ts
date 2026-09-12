const BY_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  VALIDATION: 400,
  FORBIDDEN: 403,
  UNAUTHORIZED: 401,
};

/** Map a coded error to HTTP status. `NOT_FOUND` 404, `VALIDATION` 400, `FORBIDDEN` 403, `UNAUTHORIZED` 401; others 409. */
export function httpStatus(code: string): number {
  return BY_CODE[code] ?? 409;
}
