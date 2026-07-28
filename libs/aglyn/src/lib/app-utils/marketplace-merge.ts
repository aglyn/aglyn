/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { stableStringify } from './marketplace-provenance'

/**
 * Three-way diff for COPIED marketplace artifacts (AGL-1018).
 *
 * Plugins are pinned: an update moves a pointer at immutable bytes and nothing
 * can be lost. Everything else — components, layouts, templates, dataset
 * schemas, email templates — is copied into the workspace and then edited, so
 * an update is the vendor-branch problem. Re-installing overwrote the copy, and
 * a customer's edits went with it, silently.
 *
 * With AGL-1015's base snapshot every field is classifiable against three
 * versions, and the classification is the whole design:
 *
 * * changed upstream, untouched here → **safe**, take it
 * * changed here, untouched upstream → **kept**, theirs is already right
 * * changed on both sides → **conflict**, ask, and default to keeping theirs
 *
 * Pure and content-shaped on purpose: it knows nothing about Firestore or
 * artifact types, so the same function classifies a component tree, a layout
 * and a dataset schema, and can be tested without a database.
 */

/** How a single field changed across base → current → incoming. */
export type ChangeKind =
  /** Upstream changed it, the user did not. Applying is lossless. */
  | 'safe'
  /** The user changed it, upstream did not. Applying would lose their edit. */
  | 'kept'
  /** Both changed it, to different values. Needs a decision. */
  | 'conflict'

export interface ArtifactChange {
  /** Dotted path into the content, e.g. `nodes.abc123.props.title`. */
  path: string
  kind: ChangeKind
  /** The publisher's original value at install. */
  base: unknown
  /** What the workspace has now. */
  current: unknown
  /** What the publisher ships in the new version. */
  incoming: unknown
  /**
   * True when the change adds or removes the field rather than editing it.
   * A removal is worth saying out loud separately: for a dataset schema it
   * means existing records, and for a node tree it means content disappearing
   * from a page rather than merely looking different.
   */
  added?: boolean
  removed?: boolean
}

export interface ArtifactUpdatePlan {
  safe: ArtifactChange[]
  kept: ArtifactChange[]
  conflicts: ArtifactChange[]
  /** Fields identical in all three versions — reported as a count only. */
  unchanged: number
  /** Nothing to take: the incoming content matches what is installed. */
  identical: boolean
}

/**
 * Paths whose CHILDREN are compared as a unit rather than walked.
 *
 * A besigner node is `{id, type, props, childIds}`. Walking into it produces
 * true field-level granularity, which is what the issue asks for; but the
 * `childIds` array is where structure lives, and comparing arrays element-wise
 * makes a single insert read as a change to every position after it. Arrays are
 * therefore atomic everywhere (see {@link isAtomic}), and node maps are walked
 * by KEY — which is the structural, id-keyed comparison a node tree needs, and
 * the reason a re-ordered tree does not read as a conflict in every node.
 */
function isAtomic(value: unknown): boolean {
  return (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    // Dates, Firestore timestamps and anything else non-plain: comparing their
    // enumerable members would compare internals, not content.
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
}

function same(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

const ABSENT = Symbol('absent')

function get(container: unknown, key: string): unknown | typeof ABSENT {
  if (container === ABSENT || container == null || typeof container !== 'object') {
    return ABSENT
  }
  const record = container as Record<string, unknown>
  return key in record ? record[key] : ABSENT
}

function keysOf(...containers: unknown[]): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const container of containers) {
    if (container === ABSENT || container == null || typeof container !== 'object') {
      continue
    }
    for (const key of Object.keys(container as Record<string, unknown>)) {
      if (!seen.has(key)) {
        seen.add(key)
        keys.push(key)
      }
    }
  }
  return keys
}

/**
 * Classifies every field of an artifact against its base, the workspace's
 * current copy, and the version on offer.
 *
 * `base` is required and not defaulted: without the snapshot there is no way to
 * tell the publisher's change from the user's, and guessing at one is how you
 * produce a confident, wrong merge. Callers with no base offer "install as a
 * new copy" and nothing else.
 */
export function planArtifactUpdate(
  base: unknown,
  current: unknown,
  incoming: unknown,
): ArtifactUpdatePlan {
  const plan: ArtifactUpdatePlan = {
    safe: [],
    kept: [],
    conflicts: [],
    unchanged: 0,
    identical: false,
  }

  const walk = (
    baseValue: unknown,
    currentValue: unknown,
    incomingValue: unknown,
    path: string,
  ): void => {
    const userChanged = !same(baseValue, currentValue)
    const publisherChanged = !same(baseValue, incomingValue)

    if (!userChanged && !publisherChanged) {
      plan.unchanged += 1
      return
    }

    // Recurse while all three sides still have a walkable object here, so an
    // edit to one node's text and an upstream edit to a different node are two
    // independent changes rather than one whole-tree conflict.
    //
    // A side that is ABSENT stops the walk: the field was added or removed
    // wholesale, and reporting that as one change ("this node is gone") is both
    // truer and more readable than reporting every leaf inside it.
    const walkable =
      baseValue !== ABSENT &&
      currentValue !== ABSENT &&
      incomingValue !== ABSENT &&
      !isAtomic(baseValue) &&
      !isAtomic(currentValue) &&
      !isAtomic(incomingValue)
    if (walkable) {
      for (const key of keysOf(baseValue, currentValue, incomingValue)) {
        walk(
          get(baseValue, key),
          get(currentValue, key),
          get(incomingValue, key),
          path ? `${path}.${key}` : key,
        )
      }
      return
    }

    const change: ArtifactChange = {
      path,
      kind: userChanged
        ? publisherChanged
          ? 'conflict'
          : 'kept'
        : 'safe',
      base: baseValue === ABSENT ? undefined : baseValue,
      current: currentValue === ABSENT ? undefined : currentValue,
      incoming: incomingValue === ABSENT ? undefined : incomingValue,
      ...(baseValue === ABSENT ? { added: true } : {}),
      ...(incomingValue === ABSENT && baseValue !== ABSENT
        ? { removed: true }
        : {}),
    }
    // A conflict where both sides landed on the SAME value is not a conflict —
    // two people fixing the same typo agree.
    if (change.kind === 'conflict' && same(currentValue, incomingValue)) {
      plan.unchanged += 1
      return
    }
    if (change.kind === 'safe') plan.safe.push(change)
    else if (change.kind === 'kept') plan.kept.push(change)
    else plan.conflicts.push(change)
  }

  walk(base, current, incoming, '')
  plan.identical = same(current, incoming)
  return plan
}

function setPath(target: unknown, path: string[], value: unknown | typeof ABSENT): unknown {
  if (!path.length) return value === ABSENT ? undefined : value
  const [head, ...rest] = path
  const container: Record<string, unknown> =
    target != null && typeof target === 'object' && !Array.isArray(target)
      ? { ...(target as Record<string, unknown>) }
      : {}
  if (!rest.length) {
    if (value === ABSENT) delete container[head]
    else container[head] = value
    return container
  }
  container[head] = setPath(container[head], rest, value)
  return container
}

export interface ApplyUpdateOptions {
  /**
   * Conflicting paths the user chose to take from the publisher. Everything
   * absent from this list keeps the workspace's value — the default is always
   * the safe one, so a user who applies without reading loses nothing.
   */
  takePaths?: readonly string[]
}

export interface AppliedUpdate {
  content: unknown
  /** Paths actually written, for a summary that reports what happened. */
  applied: string[]
  /** Conflicting paths left at the workspace's value. */
  skipped: string[]
}

/**
 * Produces the merged content: the workspace's copy with every safe change
 * taken and only the explicitly chosen conflicts overwritten.
 *
 * Built by patching `current` rather than by patching `incoming`, because the
 * copy is what the site is running: anything this function fails to consider —
 * a field the publisher never shipped, a node the user added — survives by
 * default rather than vanishing.
 */
export function applyArtifactUpdate(
  plan: ArtifactUpdatePlan,
  current: unknown,
  options?: ApplyUpdateOptions,
): AppliedUpdate {
  const take = new Set(options?.takePaths ?? [])
  const applied: string[] = []
  const skipped: string[] = []
  let content = current
  const write = (change: ArtifactChange) => {
    const segments = change.path ? change.path.split('.') : []
    content = setPath(
      content,
      segments,
      change.removed ? ABSENT : change.incoming,
    )
    applied.push(change.path)
  }
  for (const change of plan.safe) write(change)
  for (const change of plan.conflicts) {
    if (take.has(change.path)) write(change)
    else skipped.push(change.path)
  }
  return { content, applied, skipped }
}

/**
 * A short human label for a change, so the dialog, the summary snackbar and the
 * server's response all describe the same edit the same way.
 *
 * Values are summarised, never dumped: the interesting thing about a changed
 * node is which node and what kind of change, and a page of serialised JSON in
 * a list row is unreadable by the time it matters.
 */
export function describeChange(change: ArtifactChange): string {
  const label = change.path || 'the whole artifact'
  if (change.added) return `${label} — added by the publisher`
  if (change.removed) return `${label} — removed by the publisher`
  return label
}

/** A one-line value preview for a diff row. */
export function summarizeValue(value: unknown): string {
  if (value === undefined) return '—'
  if (value === null) return 'null'
  if (typeof value === 'string') {
    return value.length > 60 ? `${value.slice(0, 57)}…` : value || '(empty)'
  }
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? '' : 's'}`
  }
  const keys = Object.keys(value as Record<string, unknown>)
  return `{ ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''} }`
}

/**
 * Dataset schemas, classified by what an update would do to EXISTING RECORDS
 * (AGL-1018).
 *
 * The sharp edge of the whole project: adding a field is inert, but removing or
 * retyping one reinterprets data that is already there. So the schema plan is
 * not "safe vs conflict" but "additive vs destructive", and destructive changes
 * are never taken without a count of the records at stake.
 */
export interface SchemaChangeSummary {
  /** Field ids the new version adds. Applying these cannot harm a record. */
  added: string[]
  /** Field ids it removes — the values in existing records become orphaned. */
  removed: string[]
  /** Field ids whose TYPE changed — existing values may not survive a re-read. */
  retyped: string[]
  /** Anything else (labels, options, ordering). */
  edited: string[]
  /** True when nothing removes or retypes a field. */
  additiveOnly: boolean
}

interface SchemaShape {
  order?: unknown
  fields?: Record<string, { type?: unknown } | undefined>
}

/**
 * Compares two dataset schemas field by field.
 *
 * Deliberately ignores the base: for a schema the question is not "who edited
 * this" but "what happens to the rows", and that is answered by the current
 * schema against the incoming one regardless of who moved which field.
 */
export function summarizeSchemaChange(
  current: SchemaShape | null | undefined,
  incoming: SchemaShape | null | undefined,
): SchemaChangeSummary {
  const currentFields = (current?.fields ?? {}) as Record<string, { type?: unknown }>
  const incomingFields = (incoming?.fields ?? {}) as Record<string, { type?: unknown }>
  const added: string[] = []
  const removed: string[] = []
  const retyped: string[] = []
  const edited: string[] = []
  for (const id of Object.keys(incomingFields)) {
    if (!(id in currentFields)) {
      added.push(id)
      continue
    }
    if (String(currentFields[id]?.type) !== String(incomingFields[id]?.type)) {
      retyped.push(id)
    } else if (!same(currentFields[id], incomingFields[id])) {
      edited.push(id)
    }
  }
  for (const id of Object.keys(currentFields)) {
    if (!(id in incomingFields)) removed.push(id)
  }
  return {
    added,
    removed,
    retyped,
    edited,
    additiveOnly: !removed.length && !retyped.length,
  }
}
