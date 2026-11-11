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
 * What the log-drain receiver was built from (AGL-1921).
 *
 * The receiver is a Cloud Run service with its own deploy script, so a change
 * to its gate merges, promotes and reads as shipped while the old gate keeps
 * running: the closed-site 503 filter sat undeployed for four days and the
 * alert it was written to quiet kept paging. `prepare.mjs` bakes this stamp
 * into the image, the receiver answers it on GET, and
 * `check-log-drain-drift.mjs` compares it with the repo.
 *
 * Hashes the sources rather than the built `lib/`, so the check needs neither
 * a build nor a Google credential.
 */
import { createHash } from 'node:crypto'

export const LOG_DRAIN_SOURCES = [
  'cloud/log-drain/server.mjs',
  'libs/tenant/data/admin/src/lib/server/vercel-log-drain.ts',
  'libs/tenant/data/admin/src/lib/server/vercel-drain-signature.ts',
]

/** `read(path)` answers a repo-relative file's text, from disk or a git ref. */
export function logDrainSourceStamp(read) {
  const hash = createHash('sha256')
  for (const path of LOG_DRAIN_SOURCES) hash.update(`${path}\0${read(path)}\0`)
  return hash.digest('hex').slice(0, 16)
}
