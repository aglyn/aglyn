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

import { siteLockdownFromDocs } from '@aglyn/aglyn/app-utils/lockdown'

/**
 * Is this site suspended, so its sequences hold (AGL-3356)?
 *
 * The send job refuses a locked WORKSPACE through `sendRefusal`, which asks
 * the org and the member, but a sequence mails for a SITE of that workspace
 * — its consent group, its name on the message — and a staff lock on that
 * one site was never asked. The job already reads each site's document to
 * name it, so the answer costs nothing.
 *
 * Any active lock holds, a read-only window included: a sequence step is a
 * resumable sweep, so holding it is lossless and the enrollment sends on the
 * first run after the lift.
 */
export function outreachSiteHeld(
  host: Record<string, unknown> | null | undefined,
  nowMs: number,
): boolean {
  return siteLockdownFromDocs({ host: (host ?? null) as never }, nowMs) !== null
}
