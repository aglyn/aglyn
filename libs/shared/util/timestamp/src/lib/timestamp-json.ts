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

/**
 * The serialised timestamp shape, WITHOUT the Firestore client (AGL-1151).
 *
 * `./timestamp` exports a `Timestamp` class that extends the Firestore SDK's,
 * and that `extends` is a hard runtime dependency — not type-only, not
 * tree-shakeable. Importing the class for any reason pulls `firebase/firestore`
 * into the bundle.
 *
 * That is correct for the console and plugin console cards, which write these
 * values straight into Firestore documents and therefore need instances the
 * SDK's serialiser recognises by `instanceof`. It is pure cost for a caller
 * that only wants to stamp a log line.
 *
 * This module has no imports at all, so a caller in that second category can
 * deep-import it and stay free of the SDK. Same split, and same reason, as
 * `compress()` moving off the shared barrel.
 */

/**
 * Wire tag Firestore uses for a serialised timestamp. Kept identical to
 * `Timestamp.toJSON()`'s so log output does not change shape.
 */
export const TIMESTAMP_JSON_TYPE = 'firestore/timestamp/1.0'

/** A `Timestamp` as it appears once serialised. */
export interface TimestampJson {
  seconds: number
  nanoseconds: number
  type: string
}

/**
 * The current time in the same shape `Timestamp.now().toJSON()` produces.
 *
 * Millisecond resolution, because `Date.now()` is — exactly as
 * `Timestamp.now()` already was, since it is defined as
 * `fromMillis(Date.now())`. The nanoseconds field is therefore always a whole
 * number of milliseconds here, which is not a new limitation.
 */
export const timestampNowJson = (): TimestampJson => {
  const milliseconds = Date.now()
  const seconds = Math.floor(milliseconds / 1e3)
  return {
    seconds,
    nanoseconds: Math.floor((milliseconds - seconds * 1e3) * 1e6),
    type: TIMESTAMP_JSON_TYPE,
  }
}
