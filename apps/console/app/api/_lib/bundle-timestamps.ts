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

import { Timestamp } from 'firebase-admin/firestore'
import { TIMESTAMP_JSON_TYPE } from '@aglyn/shared-util-timestamp/timestamp-json'

/**
 * The bundle's timestamp wire form, in both directions (AGL-1392).
 *
 * ## The bug
 *
 * `JSON.stringify` on an Admin `Timestamp` yields `{_seconds, _nanoseconds}` —
 * the SDK's PRIVATE fields, because the Admin `Timestamp` has no `toJSON()`.
 * So every date in a bundle restored as a plain map holding the right numbers
 * in the wrong type, and the failure is silent in the worst way:
 *
 * * `publishSchedule.publishAt <= now` is a RANGE query
 *   (`apps/tenant/utils/publish-schedule-job.ts:77`). Firestore orders values
 *   by TYPE first and maps sort after timestamps, so a degraded document is
 *   not a near-miss — it is not in the result set at all. **A restored site
 *   looks correct and quietly stops publishing.**
 * * Every reader that reaches the value goes through `.seconds`, which a
 *   `_seconds` map does not have, and the two live readers fail in OPPOSITE
 *   directions: `applyDuePublishSchedule` reads `(publishAt?.seconds ?? 0)` so
 *   `undefined` becomes "already due", while `isLive` reads
 *   `(publishAt?.seconds ?? POSITIVE_INFINITY)` so a restored scheduled entry
 *   is never live.
 *
 * The repo already knew about this decay through another door — `get-screen.ts`
 * refuses to ISR-cache a doc with a pending schedule precisely because the JSON
 * round trip "decays that to `_seconds`". The bundle path had no such guard.
 *
 * ## Why the fix is on BOTH sides, and which one is canonical
 *
 * Export is canonical: the bundle is the artefact that outlives the account, so
 * it must not carry an SDK implementation detail as its date format. Import
 * still decodes, for the same reason AGL-1391 gave — fixing the export cannot
 * reach a file already on a customer's disk, and the only day anyone opens a
 * year-old backup is the day they need it. Two accepted forms, one emitted.
 *
 * ## Why a tagged envelope and not an ISO string
 *
 * An ISO string survives `JSON.stringify` too, which is exactly the trap: it
 * makes a timestamp indistinguishable from a STRING THAT LOOKS LIKE A DATE. An
 * entry body, a variable value or a screen name may legitimately hold
 * `2026-01-02T04:24:05Z`, and reviving by pattern would retype the customer's
 * own text into a `Timestamp` on restore — the same class of corruption in the
 * opposite direction. The tag makes the decision exact rather than a guess.
 *
 * ISO is also lossy: Firestore keeps nanoseconds and ISO-8601 keeps
 * milliseconds, so `.toISOString()` silently rounds every value it touches.
 *
 * The shape is not invented here. `{type, seconds, nanoseconds}` is what the
 * Firestore CLIENT SDK's own `Timestamp.toJSON()` emits and `Timestamp.fromJSON()`
 * reads, and `TIMESTAMP_JSON_TYPE` is already this repo's name for that wire
 * tag — so the bundle now carries the format Firestore itself defines, and one
 * module owns the constant.
 *
 * ## Why a deep walk rather than a list of fields
 *
 * Because a list of fields is precisely how this gap was filed. Timestamps sit
 * nested — `publishSchedule.publishAt`, `installedFrom.installedAt` — and any
 * enumeration is a thing to forget when the next feature adds a date. One rule,
 * applied to the whole bundle, cannot drift from the allow-lists beside it.
 */

/** The canonical wire form: what the export emits and the import prefers. */
interface TimestampWire {
  type: string
  seconds: number
  nanoseconds: number
}

/**
 * An Admin `Timestamp`, matched structurally as well as by class.
 *
 * `instanceof` alone is a hazard whenever two copies of `firebase-admin` can be
 * resolved in one process, and a false negative here is silent data corruption
 * rather than a crash. Nothing else in a bundle carries `toMillis` beside
 * numeric `seconds`/`nanoseconds`.
 */
const isTimestamp = (value: unknown): value is Timestamp => {
  if (value instanceof Timestamp) return true
  const candidate = value as Timestamp | null
  return (
    typeof candidate?.toMillis === 'function' &&
    typeof candidate.seconds === 'number' &&
    typeof candidate.nanoseconds === 'number'
  )
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/**
 * The canonical envelope, or null.
 *
 * Exact — the tag, two finite numbers, and NOTHING else — for the same reason
 * `bufferEnvelopeBytes` is exact (AGL-1391): the alternative reading of this
 * object is a map a customer authored, and a wrong decode retypes their data.
 */
function wireTimestamp(value: Record<string, unknown>): Timestamp | null {
  const wire = value as unknown as TimestampWire
  if (wire.type !== TIMESTAMP_JSON_TYPE) return null
  if (!isFiniteNumber(wire.seconds) || !isFiniteNumber(wire.nanoseconds)) {
    return null
  }
  if (Object.keys(value).length !== 3) return null
  return new Timestamp(wire.seconds, wire.nanoseconds)
}

/**
 * The Admin SDK's private-field envelope every bundle downloaded BEFORE this
 * fix carries, or null.
 *
 * Equally exact: an Admin `Timestamp`'s own enumerable properties are exactly
 * `_seconds` and `_nanoseconds`, so a two-key object holding both as finite
 * numbers has one honest reading.
 */
function legacyTimestamp(value: Record<string, unknown>): Timestamp | null {
  const seconds = value['_seconds']
  const nanoseconds = value['_nanoseconds']
  if (!isFiniteNumber(seconds) || !isFiniteNumber(nanoseconds)) return null
  if (Object.keys(value).length !== 2) return null
  return new Timestamp(seconds, nanoseconds)
}

/**
 * Walk a value, replacing what `convert` claims and rebuilding only the
 * containers that actually changed.
 *
 * Returning the ORIGINAL reference when nothing changed is not just tidiness: a
 * bundle at the export caps runs to tens of thousands of nodes, and the
 * `{type:'Buffer', data:[…]}` envelope of a pre-AGL-1391 backup is an array of
 * hundreds of thousands of byte numbers. Copying those to change nothing would
 * make this walk the most expensive thing in the route.
 *
 * `ArrayBuffer` views are returned untouched — a version whose `nodes` failed
 * to decode still ships its raw bytes, and they are not a map to walk into.
 */
function walk(value: unknown, convert: (input: object) => unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (ArrayBuffer.isView(value)) return value

  const converted = convert(value)
  if (converted !== undefined) return converted

  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const walked = walk(item, convert)
      if (walked !== item) changed = true
      return walked
    })
    return changed ? next : value
  }

  let changed = false
  const next: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const walked = walk(item, convert)
    if (walked !== item) changed = true
    next[key] = walked
  }
  return changed ? next : value
}

/**
 * Every `Timestamp` in a bundle, as the tagged wire form. Call once, on the
 * whole bundle, immediately before `JSON.stringify`.
 */
export function encodeBundleTimestamps<T>(bundle: T): T {
  return walk(bundle, (value) =>
    isTimestamp(value)
      ? {
          type: TIMESTAMP_JSON_TYPE,
          seconds: value.seconds,
          nanoseconds: value.nanoseconds,
        }
      : undefined,
  ) as T
}

/**
 * Every serialised timestamp in an uploaded bundle, back to a real `Timestamp`.
 * Call once, on the whole bundle, before anything reads a field out of it — so
 * the cap checks, the allow-list and the writes all see one shape.
 */
export function decodeBundleTimestamps<T>(bundle: T): T {
  return walk(bundle, (value) => {
    if (Array.isArray(value)) return undefined
    const record = value as Record<string, unknown>
    return wireTimestamp(record) ?? legacyTimestamp(record) ?? undefined
  }) as T
}
