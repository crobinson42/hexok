const DRAFT = Symbol('plinth.cow');

type ParentLink = { parent: object; key: PropertyKey };

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value) || value instanceof Date) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isCowNode(value: unknown): value is object {
  return isPlainObject(value) || Array.isArray(value);
}

export function applyCowDraft<T extends object>(
  root: T,
  owned: WeakSet<object> | undefined,
  producer: (draft: T) => void,
): { root: T; owned: WeakSet<object> | undefined; wrote: boolean } {
  const copies = new WeakMap<object, object>();
  const proxies = new WeakMap<object, object>();
  const parents = new WeakMap<object, ParentLink>();
  const nextOwned = owned ?? new WeakSet<object>();
  let wrote = false;
  let currentRoot: T = root;

  const sourceOf = <O extends object>(obj: O): O =>
    (copies.get(obj) as O | undefined) ?? obj;

  const dest = <O extends object>(obj: O): O => {
    const copied = copies.get(obj) as O | undefined;
    if (copied) return copied;
    if (nextOwned.has(obj)) return obj;

    wrote = true;
    const clone = (Array.isArray(obj) ? obj.slice() : { ...obj }) as O;
    copies.set(obj, clone);
    nextOwned.add(clone);

    const link = parents.get(obj);
    if (link) {
      const parentDest = dest(link.parent) as Record<PropertyKey, unknown>;
      parentDest[link.key] = clone;
    } else {
      currentRoot = clone as unknown as T;
    }
    return clone;
  };

  const unwrap = (value: unknown): unknown => {
    if (value !== null && typeof value === 'object') {
      const raw = (value as { [DRAFT]?: object })[DRAFT];
      if (raw !== undefined) return raw;
    }
    return value;
  };

  const wrap = (obj: object): object => {
    const existing = proxies.get(obj);
    if (existing) return existing;
    const proxy = new Proxy(obj, handler);
    proxies.set(obj, proxy);
    return proxy;
  };

  const handler: ProxyHandler<object> = {
    get(target, key) {
      if (key === DRAFT) return sourceOf(target);
      const value = Reflect.get(sourceOf(target), key);
      if (isCowNode(value)) {
        parents.set(value, { parent: target, key });
        return wrap(value);
      }
      return value;
    },
    set(target, key, value) {
      wrote = true;
      const next = unwrap(value);
      const targetDest = dest(target) as Record<PropertyKey, unknown>;
      targetDest[key] = next;
      if (isCowNode(next)) nextOwned.add(next);
      return true;
    },
    deleteProperty(target, key) {
      wrote = true;
      return Reflect.deleteProperty(dest(target), key);
    },
    has(target, key) {
      return Reflect.has(sourceOf(target), key);
    },
    ownKeys(target) {
      return Reflect.ownKeys(sourceOf(target));
    },
    getOwnPropertyDescriptor(target, key) {
      return Reflect.getOwnPropertyDescriptor(sourceOf(target), key);
    },
    defineProperty(target, key, attributes) {
      wrote = true;
      return Reflect.defineProperty(dest(target), key, attributes);
    },
  };

  producer(wrap(root) as T);

  if (!wrote) return { root, owned, wrote: false };
  return { root: currentRoot, owned: nextOwned, wrote: true };
}

export function frozenSnapshot<T>(value: T): T {
  return deepFreeze(deepClone(value));
}

function deepClone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      out[key] = deepClone(value[key]);
    }
    return out as T;
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value instanceof Date) {
    Object.freeze(value);
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    Object.freeze(value);
    return value;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}
