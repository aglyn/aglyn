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

import { parseTargets } from './status-model'

/** Where a console serves the capture script, beside the rest of its API. */
export const FIRST_TOUCH_SCRIPT_PATH = '/api/first-touch'

/**
 * Where this build loads the first-touch capture from (AGL-3289), or
 * undefined for nowhere.
 *
 * The capture is served by the console, so a docs build needs the console's
 * origin — and it already names that origin without a variable of its own:
 * as the `console` target its status page probes (`DOCS_STATUS_TARGETS`),
 * and as the endpoint its browser errors go to (`DOCS_ERROR_BEACON_ENDPOINT`).
 * The status target is read first because it names the console by
 * definition, while an error endpoint may be any collector at all. Neither
 * set → no tag: the "unset means off, never ours" rule every `DOCS_*` value
 * follows, so a build that names no console loads nothing from anybody.
 */
export function firstTouchScriptUrl(config: {
  statusTargets?: string
  errorBeaconEndpoint?: string
}): string | undefined {
  const consoleTarget = parseTargets(config.statusTargets).find(
    (target) => target.name === 'console',
  )
  for (const base of [consoleTarget?.base, config.errorBeaconEndpoint]) {
    if (!base) continue
    try {
      const url = new URL(FIRST_TOUCH_SCRIPT_PATH, base)
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString()
    } catch {
      // Not a URL; the next source may still be one.
    }
  }
  return undefined
}
