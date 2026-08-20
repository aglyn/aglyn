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

// Deciding whether a persisted synthetic `$id` is still in production, in a
// module with NO side effects so a test can import it (AGL-1889).
//
// `idField: '$id'` stamps the document id onto the in-memory row and nothing
// persists it — that is the whole point of the option. Four client writes
// spread such a row into a payload and stored it anyway (AGL-1374, fixed in
// `86270af4a`); the lint rule `aglyn/no-listener-row-spread-into-write`
// (`a4290c38c`) stops a fifth. This module is the other half: finding what
// was stored BEFORE those landed, and proving a clean answer is real.
//
// ## Why the positive control is in the code and not in the runbook
//
// The finder's failure mode is not a false positive, it is a vacuous zero. A
// finder that looks for the wrong key, or authenticates against an empty
// project, or crashes its walk on a Timestamp and swallows the error, reports
// "no hits" — the same words as a genuinely clean database. The original
// AGL-1374 pass guarded against that by noting it legitimately matched
// thousands of `$id` occurrences inside besigner node maps, so the key was
// demonstrably reachable.
//
// That control only works if somebody remembers to look at it, which is the
// AGL-2011 lesson about queues that depend on memory. So `assertPositiveControl`
// THROWS. A sweep that cannot demonstrate it can see the key is not allowed
// to report a verdict at all.

/** The synthetic key. It has exactly one meaning in this repo. */
export const SYNTHETIC_ID = '$id'

/** Thrown when a sweep's result would be vacuous. */
export class PositiveControlError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PositiveControlError'
  }
}

/**
 * The defect: `$id` as a TOP-LEVEL field of a stored document.
 *
 * Keyed off the KEY, not the value. A stored `$id` that happens to be null or
 * (through an export round trip) undefined is still the listener artifact
 * sitting in storage, and a value check would report the document clean.
 *
 * @param {Record<string, unknown>} data a document's fields
 * @returns {boolean}
 */
export function hasPersistedSyntheticId(data) {
  if (!data || typeof data !== 'object') return false
  return Object.prototype.hasOwnProperty.call(data, SYNTHETIC_ID)
}

/**
 * A plain JSON object, as opposed to a Firestore value type.
 *
 * `Timestamp`, `GeoPoint`, `DocumentReference` and `Buffer` all arrive as
 * class instances whose internals are not document data. Walking them invents
 * matches at best and follows a `DocumentReference`'s back-pointer to its
 * Firestore instance — a cyclic graph — at worst.
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * THE POSITIVE CONTROL. How many `$id` keys are nested inside this document's
 * values — besigner canvas nodes really do store their own, and that is what
 * proves a sweep can see the key at all.
 *
 * The document's own top-level `$id` is deliberately EXCLUDED: otherwise a
 * corrupt document supplies its own control, and a sweep that found nothing
 * else would still look proven.
 *
 * @param {Record<string, unknown>} data a document's fields
 * @returns {number}
 */
export function countNestedSyntheticIds(data) {
  if (!data || typeof data !== 'object') return 0
  let found = 0
  const walk = (value, depth) => {
    if (depth > 24 || value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)
      return
    }
    if (!isPlainObject(value)) return
    for (const [key, nested] of Object.entries(value)) {
      if (key === SYNTHETIC_ID) found += 1
      walk(nested, depth + 1)
    }
  }
  // Start BELOW the top level: the document's own `$id` is the thing under
  // test, never its own evidence.
  for (const [key, value] of Object.entries(data)) {
    if (key === SYNTHETIC_ID) continue
    walk(value, 0)
  }
  return found
}

/**
 * Refuse to report a verdict the sweep cannot support.
 *
 * @param {{ nestedKeys: number, documentsScanned: number }} control
 */
export function assertPositiveControl({ nestedKeys, documentsScanned }) {
  if (!documentsScanned) {
    throw new PositiveControlError(
      'Positive control DEAD: the sweep read 0 documents, so "no hits" is a ' +
        'statement about the credentials, not about the database.',
    )
  }
  if (!nestedKeys) {
    throw new PositiveControlError(
      `Positive control DEAD: ${documentsScanned} documents scanned and NOT ONE ` +
        `nested \`${SYNTHETIC_ID}\` key found. Besigner screens store one per ` +
        'canvas node, so a live sweep finds hundreds. Zero means this sweep ' +
        'cannot see the key — its clean result proves nothing. Fix the walk ' +
        'before trusting any verdict from it.',
    )
  }
}

/**
 * The scrub, as a plan over EXPLICITLY named documents.
 *
 * A repair of two documents must never be expressible as a repair of a
 * collection: the failure mode of a broad script here is stripping a key from
 * besigner nodes or from any document whose `$id` is real, and it is not
 * reversible. So the only input this accepts is a list of full document
 * paths, and it refuses anything that is not one.
 *
 * @param {readonly string[]} paths full Firestore document paths
 * @returns {Array<{ path: string, field: string }>}
 */
export function scrubPlan(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error(
      'A scrub takes an explicit list of document paths. Refusing to derive ' +
        'targets from a sweep — a two-document repair must never be able to ' +
        'become a collection-wide rewrite.',
    )
  }
  return paths.map((path) => {
    const segments = String(path).split('/').filter(Boolean)
    if (segments.length === 0 || segments.length % 2 !== 0) {
      throw new Error(
        `'${path}' is not a document path (a document has an EVEN number of ` +
          'segments). A collection path here would be a sweep.',
      )
    }
    return { path: segments.join('/'), field: SYNTHETIC_ID }
  })
}
