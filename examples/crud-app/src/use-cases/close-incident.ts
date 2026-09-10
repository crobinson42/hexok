import { ApiUseCase, type ExecuteCtx } from "@plinth/app";
import { z } from "zod";
import {
  DomainEvents,
  IncidentClosed,
} from "../domain/events.js";
import { Incident, incidentSchema } from "../domain/incident.js";
import { Clock, IncidentRepository } from "../ports.js";

/**
 * load → decide (entity) → save → publish → return
 */
export class CloseIncident extends ApiUseCase {
  static readonly key = "incident.close";

  static input = z.object({ id: z.string() });

  static output = incidentSchema;

  static errors = {
    ...Incident.errors,
    NOT_FOUND: { message: "Incident not found" },
  };

  static ports = {
    incidents: IncidentRepository,
    clock: Clock,
  };

  static publishes = [DomainEvents];

  async execute({
    input,
    ports,
    errors,
    publish,
  }: ExecuteCtx<typeof CloseIncident>) {
    const incident = await ports.incidents.get(input.id);

    if (!incident) throw errors.NOT_FOUND();

    const closed = incident.close(ports.clock.now());

    await ports.incidents.save(closed);

    if (!closed.props.closedAt) {
      throw new Error("Failed to close incident");
    }

    publish(
      new IncidentClosed({
        id: closed.props.id,
        closedAt: closed.props.closedAt,
      })
    );

    return closed.toProps();
  }
}
