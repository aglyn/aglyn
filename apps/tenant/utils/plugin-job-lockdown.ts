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
 * WHERE THE JOB BEAT GETS ITS LOCKDOWN VERDICT (AGL-2495).
 *
 * Core's `plugin-jobs.ts` owns the gate but cannot own the answer:
 * `@aglyn/tenant-data-admin` imports `@aglyn/aglyn/server`, so a core import
 * of the admin lib is a project cycle. This module is the one place the two
 * meet, and it is one line of behaviour on purpose.
 *
 * ## Why ANY active lock, and not `lockdownBlocks(state, 'write')`
 *
 * Every registered job MUTATES — it emails a site's customers, releases held
 * slots, rewrites stock, or POSTs to a merchant's supplier. There is no
 * read-only job on the beat, so the intent is always `write`, and
 * `lockdownBlocks(state, 'write')` is `true` for every active state anyway.
 * Asking the plain question keeps this identical to
 * `publish-schedule-job.ts`, which is the shape the AGL-1621 drill fixed and
 * the model every job here now follows. If a read-only job ever joins the
 * beat, THAT is the moment to give the gate an intent — not before.
 *
 * ## Fail-open, and the takedown ratchet, are NOT decided here
 *
 * `getSiteLockdown` catches its own read failures and answers `null`, and
 * whatever the enforcement-class work lands on top of that (a `takedown`
 * lock that holds through an unreachable Firestore) lands here too, for free
 * and on the same day, because this asks that function rather than keeping a
 * second copy of what a lock is.
 */

import { registerPluginJobHostLockdown } from '@aglyn/aglyn/server'
import { getSiteLockdown } from '@aglyn/tenant-data-admin'

registerPluginJobHostLockdown(
  async (hostId: string) => (await getSiteLockdown(hostId)) !== null,
)
