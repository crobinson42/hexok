import type { Guard } from 'hexok/app';
import { CodedError } from 'hexok/core';

/** App-owned role gate. Hexok does not ship roles. */
export const Roles = {
  of(role: string): Guard {
    return {
      key: `role:${role}`,
      allow({ ctx, errors }) {
        const roles =
          (ctx as { principal?: { roles: string[] } }).principal?.roles ?? [];
        if (roles.includes(role) || roles.includes('admin')) return;
        if (typeof errors.FORBIDDEN === 'function') errors.FORBIDDEN();
        throw new CodedError({ code: 'FORBIDDEN' });
      },
    };
  },
};
