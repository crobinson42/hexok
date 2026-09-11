import { Port } from 'hexok/domain';
import type { ApiKey } from '../../../domain/entities/index.js';

export interface ApiKeyRepository {
  get(id: string): Promise<ApiKey | null>;
  getByKey(key: string): Promise<ApiKey | null>;
  save(apiKey: ApiKey): Promise<void>;
  delete(id: string): Promise<void>;
}
export const ApiKeyRepository =
  Port.token<ApiKeyRepository>('ApiKeyRepository');
