import { Port } from 'hexok';

export abstract class SearchIndex extends Port('SearchIndex') {
  abstract indexUser(id: string, name: string, email: string): Promise<void>;
}
