import { CreateApiKey } from './api-keys/create-api-key.js';
import { DeleteApiKey } from './api-keys/delete-api-key.js';
import { AuthenticateApiKey } from './auth/authenticate-api-key.js';
import { Login } from './auth/login.js';
import { RegisterOrganization } from './organizations/register-organization.js';
import { CreateUser } from './users/internal/create-user.js';
import { SetupUserCredentials } from './users/setup-user-credentials.js';
import { UpdateUserCredentials } from './users/update-user-credentials.js';

export const useCases = {
  registerOrganization: RegisterOrganization,
  createUser: CreateUser,
  setupUserCredentials: SetupUserCredentials,
  updateUserCredentials: UpdateUserCredentials,
  login: Login,
  authenticateApiKey: AuthenticateApiKey,
  createApiKey: CreateApiKey,
  deleteApiKey: DeleteApiKey,
};

export {
  AuthenticateApiKey,
  CreateApiKey,
  CreateUser,
  DeleteApiKey,
  Login,
  RegisterOrganization,
  SetupUserCredentials,
  UpdateUserCredentials,
};
