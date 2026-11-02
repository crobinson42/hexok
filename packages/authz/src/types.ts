/**
 * `type:id`. The id may contain colons. It cannot contain `#`, whitespace, or NUL.
 * Checked when a tuple is written.
 */
export type ObjectRef = string;

/**
 * `type:id` or `type:id#relation`.
 * Checked when a tuple is written.
 */
export type SubjectRef = string;

/** One relationship. The store is a set of these. */
export type Tuple = {
  readonly object: ObjectRef;
  readonly relation: string;
  readonly subject: SubjectRef;
};

/**
 * The product builds this after authentication.
 * `id` is the product's stable subject id. The default type is `user`,
 * so `{ id: 'alice' }` is the subject `user:alice`.
 */
export type Actor = {
  readonly id: string;
  readonly type?: string;
};

export type ExplanationVia = 'direct' | 'userset' | 'ancestor';

/** One tuple on the path that granted an action. */
export type ExplanationStep = {
  readonly object: ObjectRef;
  readonly relation: string;
  readonly subject: SubjectRef;
  readonly via: ExplanationVia;
};

/** The first granting path, or an empty path when the action is denied. */
export type Explanation = {
  readonly allowed: boolean;
  readonly action: string;
  readonly resource: ObjectRef;
  readonly actor: SubjectRef;
  readonly steps: readonly ExplanationStep[];
};

/**
 * Synchronous view of tuples used by one check or list.
 * `reader()` on a store may load this view before the walk starts.
 */
export interface TupleReader {
  read(object: string, relation?: string): readonly Tuple[];
  idsOfType(type: string): readonly string[];
}

/** Persistence boundary. The core package ships an in-memory implementation. */
export interface TupleStore {
  write(tuples: readonly Tuple[]): Promise<void>;
  delete(tuples: readonly Tuple[]): Promise<void>;
  reader(): Promise<TupleReader>;
}
