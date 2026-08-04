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

import {
  stableStringify,
  type ResolvedProvenance,
} from './marketplace-provenance'

/**
 * The override layer (AGL-1019) — own the patch, never the copy.
 *
 * Customising a marketplace artifact and updating it are only compatible if
 * they are two different documents. Today they are one: you change a theme's
 * primary colour and that edits the theme, so the publisher's v2 can be taken
 * only by discarding your colour, or refused only by missing their fix.
 *
 * Here the publisher's version stays untouched as the **base** — AGL-1015
 * already stores it, content-addressed and immutable, in
 * `marketplaceArtifactBases/{sha256}` — the user's changes are a **sparse
 * patch** stored beside it, and readers resolve `base ⊕ patch`. Then:
 *
 * * updating replaces the base wholesale and the patch still applies;
 * * "what did I change" IS the patch, with no diffing at read time;
 * * "reset to the publisher's version" is deleting the patch;
 * * a conflict is narrow: only where the patch touches a path the update also
 *   changed, which {@link marketplace-merge}'s three-way plan already names.
 *
 * Pure and content-shaped, exactly like the merge module it sits next to: it
 * knows nothing about Firestore or artifact types, so one resolver serves a
 * theme, a node tree and a plugin settings map, and every rule below is
 * testable without a database.
 *
 * ## Which "base" a reader resolves against
 *
 * The installed document's OWN content fields — whatever the install route
 * wrote — are the base at read time, and {@link resolveArtifactContent} takes
 * them directly. `marketplaceArtifactBases` is not that: it is closed to
 * clients in both directions (a base can hold paid content, and its key is on
 * the installed document, so a readable collection would hand out any listing's
 * content by hash). It is the immutable snapshot the server diffs and resets
 * against, nothing more.
 *
 * The two agree because an update writes the publisher's new version onto the
 * document and stamps a base at that same hash in one operation — which is the
 * property that makes "never mutate the vendored artifact" enforceable rather
 * than merely intended. The moment a user edit lands in those content fields
 * instead of in the override, both the diff and this resolver are wrong.
 *
 * ## Two rules that are load-bearing
 *
 * **Deletion needs a sentinel, and it is not `null`.** A sparse patch says
 * nothing about paths it omits, so "omit it to remove it" is unavailable —
 * omission already means "inherit". `null` cannot serve either: it is a real
 * value in this codebase's content, and the besigner's `null`-means-cleared
 * convention is what took every `/product/*` page down in AGL-1226. So removal
 * is spelled with {@link OVERRIDE_DELETE}, a value nothing else produces.
 *
 * **Arrays are never merged by index.** An insert at position 0 shifts every
 * element after it, so index-wise merging reports — and then writes — a change
 * to every one of them. Arrays therefore replace wholesale by default, which is
 * also how {@link planArtifactUpdate} compares them. Where elements carry a
 * stable identity the patch may instead use the keyed form
 * ({@link keyedArrayPatch}) and edit one element by key, so a publisher who
 * inserts an element does not collide with a user who edited a different one.
 */

/**
 * The removal sentinel: a patch value of exactly this string removes the path
 * from the resolved output.
 *
 * A string rather than a wrapper object because a patch travels through
 * Firestore, JSON responses and React state unchanged, and a scalar survives
 * all three without anyone needing to know it is special. The cost is that an
 * artifact whose real content is this exact string cannot be expressed; that is
 * a deliberate trade for a sentinel that cannot be produced by accident, and
 * {@link diffOverride} is the only thing that emits it.
 *
 * Note this is a field *value*, never a field *name* — Firestore rejects field
 * names matching `__.*__`, and this deliberately has no trailing underscores so
 * that a careless refactor into a key still fails loudly rather than silently.
 */
export const OVERRIDE_DELETE = '__aglynOverrideDelete'

/**
 * The field on an installed artifact document that holds its override.
 *
 * Beside the base, never inside it. The document's content fields keep holding
 * the publisher's version verbatim, which is what makes an update a wholesale
 * replacement of those fields and nothing else. Writing the user's edits into
 * the content instead is precisely the state this issue exists to leave.
 */
export const ARTIFACT_OVERRIDE_FIELD = 'overrides'

/** The stored override, as written under {@link ARTIFACT_OVERRIDE_FIELD}. */
export interface ArtifactOverride {
  /** The sparse patch. Resolved over the artifact's content at read time. */
  patch: unknown
  /**
   * The base the patch was authored against — `installedFrom.sha256`.
   *
   * Recorded, not enforced: a patch stays valid across an update by design, and
   * the only thing this answers is "which publisher version was on screen when
   * these edits were made", which is what a conflict report needs to be honest.
   */
  baseSha256: string | null
  updatedAt?: unknown
  updatedBy?: string | null
}

/**
 * A patch node that edits an array BY KEY instead of replacing it.
 *
 * Only ever produced for arrays whose elements are objects carrying a unique
 * value under one identity field, because that is the only case where "the
 * third element" and "the element the publisher shipped third" are different
 * questions with the same answer.
 */
export interface KeyedArrayPatch {
  /** Discriminator. Present only on this form. */
  keyedBy: string
  /** Per-key sub-patches; a value of {@link OVERRIDE_DELETE} removes the element. */
  entries: Record<string, unknown>
  /**
   * The full key order, when the user reordered the array.
   *
   * Absent when they did not — and absence is the point: an array with no
   * `order` lets a publisher insert an element and have it appear, while an
   * array with one pins the order the user chose. Keys present in the base but
   * missing from `order` keep their relative position at the end, so a stale
   * `order` never drops an element.
   */
  order?: string[]
}

/** Identity fields tried, in order, when deciding whether an array is keyed. */
const KEY_FIELDS = ['id', 'key', 'slug', 'name'] as const

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value != null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null)

const same = (a: unknown, b: unknown): boolean =>
  stableStringify(a) === stableStringify(b)

export const isDeleteSentinel = (value: unknown): boolean =>
  value === OVERRIDE_DELETE

export function isKeyedArrayPatch(value: unknown): value is KeyedArrayPatch {
  return (
    isPlainObject(value) &&
    typeof value['keyedBy'] === 'string' &&
    isPlainObject(value['entries'])
  )
}

/**
 * The identity field this array is keyed by, or null when it is not keyed.
 *
 * Every element must be a plain object carrying the same field, and every value
 * must be a non-empty string that appears once. A single duplicate or missing
 * key makes the whole array unkeyed rather than partly keyed — a patch that can
 * address only some elements is worse than one that addresses none, because the
 * gaps are invisible at the call site.
 */
export function arrayKeyField(value: unknown): string | null {
  if (!Array.isArray(value) || !value.length) return null
  if (!value.every(isPlainObject)) return null
  for (const field of KEY_FIELDS) {
    const keys = value.map((entry) => (entry as Record<string, unknown>)[field])
    if (!keys.every((key) => typeof key === 'string' && key !== '')) continue
    if (new Set(keys as string[]).size !== keys.length) continue
    return field
  }
  return null
}

/** Builds a keyed-array patch, dropping it entirely when it says nothing. */
function keyedArrayPatch(
  keyedBy: string,
  entries: Record<string, unknown>,
  order: string[] | undefined,
): KeyedArrayPatch | undefined {
  if (!Object.keys(entries).length && !order) return undefined
  return { keyedBy, entries, ...(order ? { order } : {}) }
}

/**
 * `base ⊕ patch` — the resolved view every reader sees.
 *
 * Deep-merges plain objects; everything else the patch names replaces what the
 * base holds. The base is never mutated: each level is copied on write, so a
 * caller can resolve the same base against two patches and get two answers.
 *
 * A patch that names a path the base does not have simply adds it. That is what
 * makes the same function serve "override a publisher's field" and "set a field
 * the publisher never shipped", and it is why a resolved artifact can be richer
 * than its base rather than only a recolouring of it.
 */
export function resolveOverride<T = unknown>(base: unknown, patch: unknown): T {
  return resolve(base, patch) as T
}

function resolve(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base
  if (isDeleteSentinel(patch)) return undefined

  if (isKeyedArrayPatch(patch)) return resolveKeyedArray(base, patch)

  if (isPlainObject(patch) && isPlainObject(base)) {
    const merged: Record<string, unknown> = { ...base }
    for (const [key, value] of Object.entries(patch)) {
      const resolved = resolve(merged[key], value)
      if (resolved === undefined) delete merged[key]
      else merged[key] = resolved
    }
    return merged
  }

  // A patch object over a non-object base still applies — the patch wins, and
  // its own delete sentinels are honoured so that `{a: DELETE}` over `null`
  // resolves to `{}` rather than smuggling the sentinel into the output.
  if (isPlainObject(patch)) return resolve({}, patch)

  return patch
}

function resolveKeyedArray(base: unknown, patch: KeyedArrayPatch): unknown[] {
  const source = Array.isArray(base) ? base : []
  const keyOf = (entry: unknown): string | undefined => {
    const key = isPlainObject(entry) ? entry[patch.keyedBy] : undefined
    return typeof key === 'string' && key !== '' ? key : undefined
  }

  const resolved: Array<{ key: string | undefined; value: unknown }> = []
  for (const entry of source) {
    const key = keyOf(entry)
    // An unkeyed element in an otherwise keyed array is unaddressable, so it is
    // carried through untouched rather than dropped: the patch never claimed to
    // describe it.
    if (key === undefined || !(key in patch.entries)) {
      resolved.push({ key, value: entry })
      continue
    }
    const value = resolve(entry, patch.entries[key])
    if (value !== undefined) resolved.push({ key, value })
  }

  // Entries the base does not hold are additions, appended in patch order.
  const present = new Set(resolved.map((entry) => entry.key))
  for (const [key, value] of Object.entries(patch.entries)) {
    if (present.has(key) || isDeleteSentinel(value)) continue
    const added = resolve(undefined, value)
    if (added !== undefined) resolved.push({ key, value: added })
  }

  if (!patch.order) return resolved.map((entry) => entry.value)

  // Ordered: the listed keys first, in the order given, then everything the
  // order did not mention in its existing relative position. A key in `order`
  // that no longer exists is skipped rather than inserted as a hole.
  const rank = new Map(patch.order.map((key, index) => [key, index]))
  return resolved
    .map((entry, index) => ({
      ...entry,
      rank: entry.key != null && rank.has(entry.key)
        ? (rank.get(entry.key) as number)
        : patch.order!.length + index,
    }))
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.value)
}

/**
 * "What did I change" — the sparse patch that turns `base` into `edited`.
 *
 * The inverse of {@link resolveOverride}, and held to it:
 * `resolveOverride(base, diffOverride(base, edited))` equals `edited` for every
 * shape this codebase stores. That round trip is the module's central property
 * and the thing its tests exist to defend, because every consumer downstream —
 * themes, theme overrides, host variables, plugin settings — inherits it.
 *
 * Returns `undefined` when nothing changed, so an unedited artifact stores no
 * override at all rather than an empty husk that reads as "customised".
 */
export function diffOverride(base: unknown, edited: unknown): unknown {
  if (same(base, edited)) return undefined
  if (edited === undefined) return OVERRIDE_DELETE

  if (isPlainObject(base) && isPlainObject(edited)) {
    const patch: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(edited)) {
      const child = diffOverride(base[key], value)
      if (child !== undefined) patch[key] = child
    }
    for (const key of Object.keys(base)) {
      if (!(key in edited)) patch[key] = OVERRIDE_DELETE
    }
    return patch
  }

  if (Array.isArray(base) && Array.isArray(edited)) {
    const keyed = diffKeyedArray(base, edited)
    if (keyed) return keyed
  }

  return edited
}

/**
 * A per-element patch for two keyed arrays, or null when they are not both
 * keyed by the same field — in which case the caller falls back to replacing
 * the array wholesale, which is always correct if sometimes coarse.
 */
function diffKeyedArray(
  base: unknown[],
  edited: unknown[],
): KeyedArrayPatch | undefined | null {
  const field = arrayKeyField(base)
  if (!field || arrayKeyField(edited) !== field) return null

  const keyOf = (entry: unknown) =>
    String((entry as Record<string, unknown>)[field])
  const baseByKey = new Map(base.map((entry) => [keyOf(entry), entry]))
  const editedKeys = edited.map(keyOf)

  const entries: Record<string, unknown> = {}
  for (const entry of edited) {
    const key = keyOf(entry)
    const child = diffOverride(baseByKey.get(key), entry)
    if (child !== undefined) entries[key] = child
  }
  for (const key of baseByKey.keys()) {
    if (!editedKeys.includes(key)) entries[key] = OVERRIDE_DELETE
  }

  // Order is stored only when the resolver would not already produce it —
  // surviving elements in the base's order, then additions in the order they
  // appear. So the common case (a value edit, or an element appended) stores no
  // order and leaves the publisher free to insert elements of their own, while
  // a genuine reorder or a mid-list insert is pinned.
  const natural = [
    ...base.map(keyOf).filter((key) => editedKeys.includes(key)),
    ...editedKeys.filter((key) => !baseByKey.has(key)),
  ]
  const reordered = !same(natural, editedKeys)

  return keyedArrayPatch(field, entries, reordered ? editedKeys : undefined)
}

/**
 * Every path the patch touches, dotted, for "what did I change" in a UI and for
 * pairing an override against an update plan's conflicts — whose paths
 * {@link planArtifactUpdate} spells the same way.
 *
 * A keyed array contributes `field[key]` segments rather than indices, because
 * an index is exactly the thing that stops meaning the same element the moment
 * the publisher inserts one.
 */
export function overridePaths(patch: unknown, prefix = ''): string[] {
  if (patch === undefined) return []
  if (isKeyedArrayPatch(patch)) {
    return Object.entries(patch.entries).flatMap(([key, value]) =>
      overridePaths(value, `${prefix}[${key}]`),
    )
  }
  if (isPlainObject(patch) && !isDeleteSentinel(patch)) {
    const keys = Object.keys(patch)
    if (keys.length) {
      return keys.flatMap((key) =>
        overridePaths(patch[key], prefix ? `${prefix}.${key}` : key),
      )
    }
  }
  return prefix ? [prefix] : []
}

/**
 * True when the patch says nothing — the artifact is the publisher's, as shipped.
 *
 * `undefined` is the only absence. A `null` is a VALUE the user chose, and
 * calling it empty here would silently discard "set this field to null" on
 * every save — the same conflation between "cleared" and "absent" that took
 * every `/product/*` page down in AGL-1226.
 */
export function isEmptyOverride(patch: unknown): boolean {
  if (patch === undefined) return true
  if (isKeyedArrayPatch(patch)) {
    return !patch.order && Object.values(patch.entries).every(isEmptyOverride)
  }
  if (isDeleteSentinel(patch)) return false
  if (isPlainObject(patch)) return Object.values(patch).every(isEmptyOverride)
  return false
}

/**
 * Is this shape storable as a whole-artifact override?
 *
 * A patch is a *sparse* description of edits to a structured artifact, so its
 * top level is an object or a keyed array and nothing else. A stored scalar —
 * above all a top-level `null` — would resolve the entire artifact away, which
 * is never something a user did on purpose and always something a half-written
 * or hand-edited field can produce. Nested nulls stay values; only the root is
 * constrained, and constraining it is what keeps a junk field from blanking a
 * live site.
 */
function isStorablePatch(patch: unknown): boolean {
  return (
    (isKeyedArrayPatch(patch) || isPlainObject(patch)) && !isEmptyOverride(patch)
  )
}

export interface OverrideEligibility {
  ok: boolean
  /** Why not, in the words the surface refusing it should use. */
  reason?: string
}

/**
 * Can this artifact hold an override at all? (AGL-1015's provenance, answered.)
 *
 * An override is a patch over the publisher's version, so an artifact with no
 * recorded base has nothing to be a patch *of*. Storing one anyway would
 * produce a patch against whatever the document happened to hold — including
 * the user's own earlier edits — and the first update would resolve it against
 * a base it was never written for. Saying so plainly is the whole point of the
 * `updatable` flag; this is the sentence to put next to the disabled control.
 */
export function canOverrideArtifact(
  provenance: ResolvedProvenance | null | undefined,
): OverrideEligibility {
  if (!provenance || provenance.state === 'unknown') {
    return {
      ok: false,
      reason:
        'This was not installed from the marketplace, so there is no ' +
        'publisher’s version to keep your changes separate from. Edit it ' +
        'directly — it is already yours.',
    }
  }
  if (!provenance.updatable) {
    return {
      ok: false,
      reason:
        'This was installed before update tracking recorded an original, so ' +
        'there is nothing to layer your changes over. Re-installing it from ' +
        'the listing records one, and your changes can be kept separately ' +
        'from then on.',
    }
  }
  return { ok: true }
}

/**
 * The value to write under {@link ARTIFACT_OVERRIDE_FIELD} — or `null`, meaning
 * "reset to the publisher's version", when the patch says nothing.
 *
 * ## Write this WHOLESALE. Never with `merge: true`.
 *
 * Firestore's `merge: true` deep-merges maps, and a patch is a map, so merging
 * a new patch onto an old one takes their union: every path the user has ever
 * overridden stays overridden, and removing an override becomes impossible
 * through the one write that looks like it should do it. `merge: true` on the
 * *document* is fine and expected — it is this *field* that must be replaced,
 * which is what passing this value under a `FieldPath` to `update`, or under
 * `set(..., {mergeFields})`, does:
 *
 * ```ts
 * await ref.set(
 *   { [ARTIFACT_OVERRIDE_FIELD]: overrideWriteValue(patch, sha256), updatedAt },
 *   { mergeFields: [ARTIFACT_OVERRIDE_FIELD, 'updatedAt'] },
 * )
 * ```
 *
 * The `null` for an empty patch is deliberate over a field delete: a reader
 * that sees `null` knows the override was considered and is empty, which reads
 * the same as absent and needs no second code path.
 */
export function overrideWriteValue(
  patch: unknown,
  baseSha256: string | null,
  meta?: { updatedAt?: unknown; updatedBy?: string | null },
): ArtifactOverride | null {
  if (!isStorablePatch(patch)) return null
  return {
    patch,
    baseSha256,
    ...(meta?.updatedAt !== undefined ? { updatedAt: meta.updatedAt } : {}),
    ...(meta?.updatedBy !== undefined ? { updatedBy: meta.updatedBy } : {}),
  }
}

/**
 * Reads a stored override off a document, tolerating the junk a client-writable
 * field can hold.
 *
 * Returns `undefined` for anything that is not a well-formed override, so a
 * corrupt field resolves to the publisher's version rather than throwing on a
 * page that would otherwise render.
 */
export function readArtifactOverride(
  doc: Record<string, unknown> | null | undefined,
): ArtifactOverride | undefined {
  const stored = doc?.[ARTIFACT_OVERRIDE_FIELD]
  if (!isPlainObject(stored)) return undefined
  if (!isStorablePatch(stored['patch'])) return undefined
  const sha = stored['baseSha256']
  return {
    patch: stored['patch'],
    baseSha256: typeof sha === 'string' && sha ? sha : null,
    ...(stored['updatedAt'] !== undefined ? { updatedAt: stored['updatedAt'] } : {}),
    ...(typeof stored['updatedBy'] === 'string'
      ? { updatedBy: stored['updatedBy'] }
      : {}),
  }
}

/**
 * The one call a reader makes: the publisher's content with this document's
 * override resolved over it.
 *
 * `content` is the artifact's own fields — whatever shape the install route
 * wrote, unchanged — so a caller never has to know whether an override exists.
 */
export function resolveArtifactContent<T = unknown>(
  content: unknown,
  doc: Record<string, unknown> | null | undefined,
): T {
  const override = readArtifactOverride(doc)
  return (override ? resolveOverride(content, override.patch) : content) as T
}

/**
 * The paths where an incoming update collides with what the user overrode.
 *
 * Narrow by construction, which is the payoff the whole layer was built for: a
 * patch touching four paths can conflict in at most four places no matter how
 * much of the artifact the publisher rewrote, so the question put to the user is
 * "the publisher also changed your heading colour — whose wins?" rather than
 * "this update rewrites 300 nodes, continue?".
 *
 * A path whose incoming value already equals what the override sets is not a
 * conflict — the publisher adopted the user's change, and there is nothing to
 * ask about.
 */
export function overrideConflicts(
  base: unknown,
  patch: unknown,
  incoming: unknown,
): string[] {
  const overridden = resolveOverride(base, patch)
  return overridePaths(patch).filter((path) => {
    const baseValue = readPath(base, path)
    const incomingValue = readPath(incoming, path)
    if (same(baseValue, incomingValue)) return false
    return !same(readPath(overridden, path), incomingValue)
  })
}

/** Reads a dotted path, understanding the `field[key]` segments keyed arrays use. */
function readPath(value: unknown, path: string): unknown {
  let cursor: unknown = value
  for (const segment of path.match(/[^.[\]]+/g) ?? []) {
    if (Array.isArray(cursor)) {
      const field = arrayKeyField(cursor)
      cursor = field
        ? cursor.find(
            (entry) => (entry as Record<string, unknown>)[field] === segment,
          )
        : undefined
      continue
    }
    if (!isPlainObject(cursor)) return undefined
    cursor = cursor[segment]
  }
  return cursor
}
