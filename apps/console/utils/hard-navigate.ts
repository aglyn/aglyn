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
 * A full-page navigation (`window.location.assign`) behind a module seam.
 *
 * Exists so pages whose CORRECTNESS depends on when they hard-navigate can be
 * tested: jsdom's `location.assign` is read-only, so a component calling it
 * directly cannot have the navigation observed or suppressed in a spec
 * (AGL-1524 — where a hard navigation firing too early aborted an in-flight
 * `applyActionCode` and silently ate the user's email verification).
 *
 * A hard navigation aborts every in-flight fetch on the page. If the page has
 * an outstanding request whose completion matters, await it first.
 */
export function hardNavigate(url: string): void {
  if (typeof window !== 'undefined') window.location.assign(url)
}

export default hardNavigate
