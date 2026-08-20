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
 * The mark a scheduled run leaves behind (AGL-1955).
 *
 * One line per cron route, right after it accepts the invocation, so
 * `/api/health/crons` can tell a job that stopped being scheduled from one
 * that is simply having a quiet week. Stamped on the INVOCATION and not on
 * the work: a sweep that found nothing to do still ran, and a check that
 * only noticed jobs which produced output would page on every idle week.
 *
 * Stamped BEFORE the work, deliberately. The question is "is this job still
 * being scheduled", and the answer is yes the moment the request arrives
 * authenticated. Whether the run then succeeded is a different question that
 * `scheduled-crons.yml` already answers by going red on a non-200 — moving
 * this to the end would fold two failures into one row and lose the one this
 * issue is about.
 *
 * NOTHING HERE THROWS, and the outer try/catch is not belt-and-braces on top
 * of `writeCronBeat`'s own. It covers the two steps before it — reaching the
 * admin app and its Firestore handle — because a monitor that can take down
 * the job it describes is a worse failure than the one it watches for. A
 * write that keeps failing still surfaces, and in the right place: as a
 * silent job on the health board.
 *
 * It is also what keeps a hundred-odd route specs, which mock the shared
 * server barrel down to the handful of symbols they use, from having to know
 * this exists. That does mean this call site cannot fail a test by being
 * absent, so the wiring is asserted on its own in
 * `specs/cron-beat-wiring.spec.ts` — against the real module, with nothing
 * mocked that could make the assertion vacuous.
 */
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { writeCronBeat } from '@aglyn/aglyn/server'

export async function recordCronBeat(jobId: string): Promise<void> {
  try {
    await writeCronBeat(firebaseAdmin.app().firestore(), jobId)
  } catch {
    // Deliberately swallowed. See above.
  }
}
