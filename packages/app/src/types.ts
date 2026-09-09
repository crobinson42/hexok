import type { ErrorMap, Infer, StandardSchemaV1 } from '@plinth/core';
import type { EventCatalog, PortToken } from '@plinth/domain';

export type ResolvedPorts<P> = {
  [K in keyof P]: P[K] extends PortToken<infer I> ? I : never;
};

export type ErrorFactories<M> = {
  [K in keyof M]: M[K] extends { data: infer S }
    ? S extends StandardSchemaV1
      ? (data: Infer<S>) => never
      : () => never
    : () => never;
};

export type UseCaseBag = Record<string, UseCaseClass>;

export type UseCaseClass = ApiUseCaseCtor | EventUseCaseCtor;

export interface ApiUseCaseCtor {
  readonly trigger: 'api';
  readonly id: string;
  readonly input: StandardSchemaV1;
  readonly output: StandardSchemaV1;
  readonly errors: ErrorMap;
  readonly ports: Record<string, PortToken<unknown>>;
  readonly publishes?: readonly EventCatalog[];
  readonly middleware?: readonly unknown[];
  new (): { execute(ctx: never): Promise<unknown> };
}

export interface EventUseCaseCtor {
  readonly trigger: 'event';
  readonly id: string;
  readonly on: { readonly name: string };
  readonly catalog: EventCatalog;
  readonly group?: string;
  readonly ports?: Record<string, PortToken<unknown>>;
  readonly publishes?: readonly EventCatalog[];
  readonly errors?: ErrorMap;
  readonly middleware?: readonly unknown[];
  new (): { execute(ctx: never): Promise<void> };
}

export function isEventUseCase(ctor: UseCaseClass): ctor is EventUseCaseCtor {
  return ctor.trigger === 'event';
}

export function isApiUseCase(ctor: UseCaseClass): ctor is ApiUseCaseCtor {
  return ctor.trigger === 'api';
}
