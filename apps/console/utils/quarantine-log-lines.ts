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

import type { LockdownLogLine } from './lockdown-log-lines'

/*
 * THE LINE THE DISABLED-FILES PAGE KEEPS UNDER "ACTIONS TAKEN IN THIS SESSION" (AGL-1571).
 *
 * A disable or release that reached the server leaves one line, verified or NOT CONFIRMED by the route's own
 * read-back of the deny list. The page and the staff apps keep the same line; the route sends it as `logLines`
 * on every disable and release, and the page builds it from the same answer with this.
 */
export function quarantineLogLines(
  body: Record<string, unknown>,
  payload: Record<string, any>,
): LockdownLogLine[] {
  const confirmed = payload['confirmed'] !== false
  if (body['by'] === 'key') {
    return [{ text: `Released ${String(body['key'] ?? '')}`, confirmed }]
  }
  const keys = (payload['keys'] as unknown[] | undefined) ?? [payload['key']]
  const action = body['action'] === 'quarantine' ? 'Disabled' : 'Released'
  return [
    {
      text: `${action} ${String(body['mediaId'] ?? '').trim()} (${keys.length} key${keys.length === 1 ? '' : 's'})`,
      confirmed,
    },
  ]
}
