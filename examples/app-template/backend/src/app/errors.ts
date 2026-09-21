import { defineErrors } from 'hexok/core';

export const AuthErrors = defineErrors({
  UNAUTHORIZED: { message: 'Unauthorized' },
  FORBIDDEN: { message: 'Forbidden' },
});
export type AuthErrors = typeof AuthErrors;

export const InvalidCredentials = defineErrors({
  INVALID_CREDENTIALS: { message: 'Invalid credentials' },
});
export type InvalidCredentials = typeof InvalidCredentials;

export const UserErrors = defineErrors({
  USER_NOT_FOUND: { message: 'User not found' },
});
export type UserErrors = typeof UserErrors;
