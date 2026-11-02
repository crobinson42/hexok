import { Entity } from 'hexok';
import { LocationSchema } from '../schemas/location.js';

export class LocationEntity extends Entity('Location', LocationSchema) {}
