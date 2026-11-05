import {
  Event,
  type InferSchema,
  type SchemaSource,
  type StandardSchemaV1,
} from 'hexok';

/** Instance of a {@link Message} class. */
export interface MessageInstance {
  readonly token: string;
  readonly version: number;
  readonly payload: unknown;
}

/** A class made with {@link Message}. */
export interface MessageConstructor {
  /** Message type. The same type across versions. */
  readonly token: string;
  /** Positive integer. A breaking change is a new version. */
  readonly version: number;
  /** Payload schema. */
  readonly schema: StandardSchemaV1;
  /** How a payload of this version becomes the previous version. */
  readonly downgrade: Downgrade | undefined;
  /** Validate `value` and construct the message. */
  parse(value: unknown): object;
  // biome-ignore lint/suspicious/noExplicitAny: message constructors take a payload whose type varies per message
  new (...args: any[]): MessageInstance;
}

/** A downgrade as {@link MessageConstructor} stores it. */
export interface Downgrade {
  readonly to: MessageConstructor;
  readonly map: (payload: never) => unknown;
}

/** Payload of a message class. */
export type MessagePayload<M extends MessageConstructor> =
  InstanceType<M>['payload'];

/**
 * `to` is the previous version of the same type. `map` turns a payload of
 * this version into a payload of `to`.
 */
export interface MessageOptions<
  S extends SchemaSource,
  To extends MessageConstructor,
> {
  readonly downgrade: {
    readonly to: To;
    readonly map: (payload: InferSchema<S>) => MessagePayload<To>;
  };
}

type DowngradeOf<S extends SchemaSource, To extends MessageConstructor> = [
  To,
] extends [never]
  ? undefined
  : MessageOptions<S, To>['downgrade'];

type EventBase<Type extends string, S extends SchemaSource> = ReturnType<
  typeof Event<Type, S>
>;

/**
 * The class {@link Message} returns. It is the hexok `Event` class for `Type`
 * and `S`, with a static and instance `version` and a static `downgrade`.
 */
export type MessageClass<
  Type extends string,
  Version extends number,
  S extends SchemaSource,
  To extends MessageConstructor,
> = {
  new (
    payload: InferSchema<S>,
  ): InstanceType<EventBase<Type, S>> & { readonly version: Version };
} & Omit<EventBase<Type, S>, 'prototype'> & {
    /** Version. Literal type of the number passed to {@link Message}. */
    readonly version: Version;
    /** The previous version and how to reach it. `undefined` without one. */
    readonly downgrade: DowngradeOf<S, To>;
  };

/**
 * A versioned event that crosses a product or service boundary. It is a hexok
 * `Event`, so `parse` and `EventHandler` work on it.
 *
 * ```ts
 * class InvoicePaid extends Message('invoice.paid', 1, invoicePaidSchema) {}
 * class InvoicePaidV2 extends Message('invoice.paid', 2, invoicePaidV2Schema, {
 *   downgrade: { to: InvoicePaid, map: (v2) => ({ invoiceId: v2.id }) },
 * }) {}
 * ```
 */
export function Message<
  const Type extends string,
  const Version extends number,
  S extends SchemaSource,
  To extends MessageConstructor = never,
>(
  type: Type,
  version: Version,
  schema: S,
  options?: MessageOptions<S, To>,
): MessageClass<Type, Version, S, To> {
  if (typeof type !== 'string' || type === '') {
    throw new Error('integration-events: message type must be a string');
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(
      `integration-events: "${type}" version must be a positive integer`,
    );
  }
  const downgrade = options?.downgrade;
  if (downgrade !== undefined) {
    assertDowngrade(type, version, downgrade);
  }
  const stored = (
    downgrade === undefined ? undefined : Object.freeze({ ...downgrade })
  ) as DowngradeOf<S, To>;

  class VersionedEvent extends Event(type, schema) {
    static readonly version: Version = version;
    static readonly downgrade: DowngradeOf<S, To> = stored;
    readonly version: Version = version;
  }

  return VersionedEvent;
}

function assertDowngrade(
  type: string,
  version: number,
  downgrade: { readonly to: unknown; readonly map: unknown },
): void {
  const to = downgrade.to as {
    readonly token?: unknown;
    readonly version?: unknown;
  };
  if (
    typeof downgrade.to !== 'function' ||
    to.token !== type ||
    typeof to.version !== 'number' ||
    to.version >= version
  ) {
    throw new Error(
      `integration-events: "${type}" v${version} must downgrade to an earlier version of "${type}"`,
    );
  }
  if (typeof downgrade.map !== 'function') {
    throw new Error(
      `integration-events: "${type}" v${version} downgrade map must be a function`,
    );
  }
}
