import type { EventUseCaseCtor } from '../app/index.js';
import type { AnyEventCatalog, EventAdapter } from '../domain/index.js';
import { type InvokeDeps, invokeEvent } from './invoke.js';

export async function startHandlers(
  bound: Map<AnyEventCatalog, EventAdapter>,
  handlers: Map<string, EventUseCaseCtor[]>,
  deps: InvokeDeps,
): Promise<void> {
  for (const [catalog, adapter] of bound) {
    for (const eventClass of catalog.list()) {
      const handlerKey = `${catalog.key}:${eventClass.key}`;
      const list = handlers.get(handlerKey) ?? [];
      if (list.length === 0) continue;
      if (adapter.kind === 'bus') {
        adapter.subscribe(eventClass.key, async (envelope) => {
          for (const ctor of list) {
            await invokeEvent(ctor, envelope, deps);
          }
        });
        continue;
      }
      const groups = new Map<string, EventUseCaseCtor[]>();
      for (const ctor of list) {
        if (ctor.group === undefined) {
          throw new Error(
            `kerf: broker handler "${ctor.key}" requires static group`,
          );
        }
        const group = groups.get(ctor.group) ?? [];
        group.push(ctor);
        groups.set(ctor.group, group);
      }
      for (const [group, ctors] of groups) {
        adapter.consume(
          eventClass.key,
          group,
          async (envelope, { attempt, ack, nack }) => {
            try {
              for (const ctor of ctors) {
                await invokeEvent(ctor, envelope, deps, { attempt });
              }
              await ack();
            } catch (error) {
              await nack();
              throw error;
            }
          },
        );
      }
    }
  }
}

export async function stopAdapters(
  bound: Map<AnyEventCatalog, EventAdapter>,
): Promise<void> {
  for (const adapter of bound.values()) {
    await adapter.stop?.();
  }
}
