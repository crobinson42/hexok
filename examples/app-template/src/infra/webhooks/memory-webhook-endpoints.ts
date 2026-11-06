import { type WebhookEndpoint, WebhookEndpoints } from '@hexok/webhooks';
import { Adapter } from 'hexok';

interface Row {
  readonly endpoint: WebhookEndpoint;
  readonly eventTypes: readonly string[];
  enabled: boolean;
}

/** Endpoints in process memory. A product stores them in its own database, with secrets encrypted at rest. */
export class MemoryWebhookEndpoints extends Adapter(WebhookEndpoints) {
  readonly #rows = new Map<string, Row>();

  add(
    organizationId: string,
    endpoint: WebhookEndpoint,
    eventTypes: readonly string[],
  ): void {
    this.#rows.set(`${organizationId}\0${endpoint.id}`, {
      endpoint,
      eventTypes,
      enabled: true,
    });
  }

  /** The hooks call this when an endpoint answers 410. */
  disable(organizationId: string, endpointId: string): void {
    const row = this.#rows.get(`${organizationId}\0${endpointId}`);
    if (row) row.enabled = false;
  }

  override async subscribed(
    organizationId: string,
    eventType: string,
  ): Promise<readonly WebhookEndpoint[]> {
    const prefix = `${organizationId}\0`;
    return [...this.#rows]
      .filter(
        ([key, row]) =>
          key.startsWith(prefix) &&
          row.enabled &&
          row.eventTypes.includes(eventType),
      )
      .map(([, row]) => row.endpoint);
  }

  override async get(
    organizationId: string,
    endpointId: string,
  ): Promise<WebhookEndpoint | null> {
    const row = this.#rows.get(`${organizationId}\0${endpointId}`);
    return row?.enabled ? row.endpoint : null;
  }
}
