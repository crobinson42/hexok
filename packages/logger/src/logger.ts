import { Port } from 'hexok';
import type { LogLevel } from './level.js';

export type LogFields = Record<string, unknown>;

export abstract class Logger extends Port('Logger') {
  abstract debug(message: string, fields?: LogFields): void;
  abstract info(message: string, fields?: LogFields): void;
  abstract warn(message: string, fields?: LogFields): void;
  abstract error(messageOrError: string | Error, fields?: LogFields): void;
  abstract child(bindings: LogFields): Logger;
}

export type { LogLevel };
