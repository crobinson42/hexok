import { CallableUseCase } from './callable-use-case.js';

/**
 * Public request/response use case. Declare static `key`, `input`, `output`,
 * `errors`, `ports`. Implement `execute`.
 *
 * ```ts
 * class CloseIncident extends ExternalUseCase {
 *   static readonly key = 'incident.close'
 *   static readonly input = z.object({ id: z.string() })
 *   static readonly output = Incident.schema
 *   static readonly errors = { NOT_FOUND: { message: 'Incident not found' } } as const
 *   static readonly ports = { incidents: IncidentRepository }
 *   async execute({ input, ports, errors }: ExecuteCtx<typeof CloseIncident>) {
 *     const incident = await ports.incidents.get(input.id)
 *     if (!incident) throw errors.NOT_FOUND()
 *     return incident.toProps()
 *   }
 * }
 * ```
 */
export abstract class ExternalUseCase extends CallableUseCase {
  /** Discriminator for `App.from` / `isExternalUseCase`. Do not override. */
  static readonly trigger = 'external' as const;
}
