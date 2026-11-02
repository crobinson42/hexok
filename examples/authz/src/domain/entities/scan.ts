import { Entity } from 'hexok';
import { ScanSchema } from '../schemas/scan.js';

export class ScanEntity extends Entity('Scan', ScanSchema) {
  rename(title: string): this {
    return this.set((draft) => {
      draft.title = title;
    });
  }
}
