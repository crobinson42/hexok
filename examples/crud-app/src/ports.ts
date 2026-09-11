import { Port } from 'hexok/domain';
import type { Incident } from './domain/incident.js';
import type { Site } from './domain/site.js';

export interface IncidentRepository {
  get(id: string): Promise<Incident | null>;
  save(incident: Incident): Promise<void>;
  list(): Promise<Incident[]>;
  delete(id: string): Promise<void>;
}
export const IncidentRepository =
  Port.token<IncidentRepository>('IncidentRepository');

export interface SiteRepository {
  get(id: string): Promise<Site | null>;
  save(site: Site): Promise<void>;
}
export const SiteRepository = Port.token<SiteRepository>('SiteRepository');

export interface Clock {
  now(): Date;
}
export const Clock = Port.token<Clock>('Clock');

export interface Notifier {
  send(payload: { id: string; closedAt: Date }): Promise<void>;
}
export const Notifier = Port.token<Notifier>('Notifier');
