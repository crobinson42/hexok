import type { ApiKeyRepository } from '../app/ports/repos/api-keys-repo.js';
import type { UserCredentialsRepository } from '../app/ports/repos/user-credentials-repo.js';
import type { UserRepository } from '../app/ports/repos/users-repo.js';
import type { AuthTokenService } from '../app/ports/services/authTokenService.js';
import type { EmailService } from '../app/ports/services/email.js';
import type { PasswordHasher } from '../app/ports/utilities/password-hasher.js';
import type { ApiKey } from '../domain/entities/api-key.js';
import type { User } from '../domain/entities/user.js';
import type { UserCredentials } from '../domain/entities/user-credentials.js';
import { type Actor, actorSchema } from '../domain/schemas/actor.js';

export function stubToken(): AuthTokenService {
  return {
    async issue(actor: Actor) {
      return btoa(JSON.stringify(actor));
    },
    async verify(token: string) {
      try {
        const parsed = actorSchema.safeParse(JSON.parse(atob(token)));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
  };
}

export function stubPasswordHasher(): PasswordHasher {
  return {
    async verify(password, passwordHash) {
      return password === passwordHash;
    },
  };
}

export function stubEmail(): EmailService {
  return {
    async send() {},
  };
}

export function memoryUsers(): UserRepository {
  const byId = new Map<string, User>();
  return {
    async get(id) {
      return byId.get(id) ?? null;
    },
    async getByEmail(email) {
      for (const user of byId.values()) {
        if (user.props.email === email) return user;
      }
      return null;
    },
    async save(user) {
      byId.set(user.props.id, user);
    },
  };
}

export function memoryUserCredentials(): UserCredentialsRepository {
  const byId = new Map<string, UserCredentials>();
  return {
    async get(id) {
      return byId.get(id) ?? null;
    },
    async getByUserId(userId) {
      for (const credentials of byId.values()) {
        if (credentials.props.userId === userId) return credentials;
      }
      return null;
    },
    async save(credentials) {
      byId.set(credentials.props.id, credentials);
    },
  };
}

export function memoryApiKeys(): ApiKeyRepository {
  const byId = new Map<string, ApiKey>();
  return {
    async get(id) {
      return byId.get(id) ?? null;
    },
    async getByKey(key) {
      for (const apiKey of byId.values()) {
        if (apiKey.props.key === key) return apiKey;
      }
      return null;
    },
    async save(apiKey) {
      byId.set(apiKey.props.id, apiKey);
    },
    async delete(id) {
      byId.delete(id);
    },
  };
}
