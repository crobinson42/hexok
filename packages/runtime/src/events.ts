import type { EventUseCaseCtor } from '@plinth/app';
import type { EventAdapter, EventCatalog } from '@plinth/domain';
import { type InvokeDeps, invokeEvent } from './invoke.js';

export async function startHandlers(
  bound: Map<EventCatalog, EventAdapter>,
  handlers: Map<string, EventUseCaseCtor[]>,
  deps: InvokeDeps,
): Promise<void> {
  for (const [catalog, adapter] of bound) {
    for (const eventClass of catalog.list()) {
      const key = `${catalog.name}:${eventClass.name}`;
      const list = handlers.get(key) ?? [];
      if (list.length === 0) continue;
      if (adapter.kind === 'bus') {
        adapter.subscribe(eventClass.name, async (envelope) => {
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
            `plinth: broker handler "${ctor.id}" requires static group`,
          );
        }
        const group = groups.get(ctor.group) ?? [];
        group.push(ctor);
        groups.set(ctor.group, group);
      }
      for (const [group, ctors] of groups) {
        adapter.consume(
          eventClass.name,
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
  bound: Map<EventCatalog, EventAdapter>,
): Promise<void> {
  for (const adapter of bound.values()) {
    await adapter.stop?.();
  }
}
