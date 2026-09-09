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
 * Put a CAUGHT error back on the path an uncaught one takes (AGL-1538).
 *
 * React 19 routes errors an error boundary catches to `console.error`, and
 * only uncaught ones to `reportError` — so a boundary that renders quietly
 * turns a reported crash into an invisible one. `reportError` dispatches an
 * `error` event on `window`, which is the listener `installErrorBeacon`
 * registers, so a re-dispatched failure lands in Cloud Error Reporting
 * exactly as it would have without the boundary.
 *
 * Every error boundary in both apps needs this and each of them had grown its
 * own copy of it. A module of its own rather than a function inside
 * `error-beacon.ts`, which re-exports it: an error boundary importing one
 * name off that file would drag the beacon's whole installer into its chunk,
 * and a boundary's chunk is downloaded by every visitor whether or not
 * anything ever throws.
 *
 * Optional and swallowed on both counts: jsdom and older Safari have no
 * `reportError`, and reporting a failure may never be the thing that causes
 * one.
 */
export function redispatchCaughtError(error: unknown): void {
  if (typeof window === 'undefined') return
  try {
    ;(
      window as Window & { reportError?: (error: unknown) => void }
    ).reportError?.(error)
  } catch {
    // Reporting never breaks the page.
  }
}
