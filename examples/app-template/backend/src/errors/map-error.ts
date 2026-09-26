import { CodedError } from 'hexok';
import { DomainError } from './domain.js';

export type HttpResult = {
  status: number;
  body: {
    code: string;
    message?: string;
    id?: string;
  };
};

/** Application edge. Hexok does not map a catalog to a transport. */
export function mapError(error: unknown): HttpResult {
  if (error instanceof CodedError && error.code === 'VALIDATION') {
    return { status: 400, body: { code: error.code, message: error.message } };
  }
  if (!DomainError.is(error)) {
    return { status: 500, body: { code: 'INTERNAL' } };
  }
  return DomainError.match(error, {
    Unauthorized: (failure) => ({
      status: 401,
      body: { code: failure.code, message: failure.message },
    }),
    BlankName: (failure) => ({
      status: 400,
      body: { code: failure.code, message: failure.message },
    }),
    UserExists: (failure) => ({
      status: 409,
      body: {
        code: failure.code,
        message: failure.message,
        id: failure.data.id,
      },
    }),
  });
}
