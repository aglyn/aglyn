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

import type {
  PersonErasureNote,
  PersonErasureNotesRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-person-erasure-notes'
import { waiverErasureKeptLine } from '../model/waiver-retention'
import type { StoredWaiverSignature } from '../model/waiver-signature'
import { waiversRefs } from './db'
import { siteRetentionYears } from './retention'

/*==========================================
 * WHAT THE ERASE A PERSON CARD SAYS ABOUT SIGNED WAIVERS (AGL-4042).
 *
 * The eraser (`person-eraser.ts`) keeps each signature for its site's period,
 * so the card says so before anyone files. The card is about an address not
 * yet known when it opens, so this answers for the workspace, not the person:
 * a workspace with no signature at all has nothing to say, and otherwise the
 * sentence holds for someone who signed nothing. It asks whether any signature
 * exists rather than whether the plugin is switched on, because the eraser
 * keeps what is there either way.
 *
 * The period is the one the eraser applies, `siteRetentionYears`, for each
 * site with a signature. Read only when the card opens: one signature, the
 * sites' retention states, and each site's settings.
 *=========================================*/

/** Past this many sites the sentence stops naming a figure. */
const MAX_SITES = 100

export async function waiversPersonErasureNotes(
  request: PersonErasureNotesRequest,
): Promise<PersonErasureNote[]> {
  const { orgId } = request
  const anySigned = await waiversRefs.signatures(orgId).limit(1).get()
  if (anySigned.empty) return []
  const states = await waiversRefs.retentions(orgId).limit(MAX_SITES).get()
  const hostIds = new Set<string>(states.docs.map((doc) => doc.id))
  // A site whose state was never written still has this signature's period.
  for (const doc of anySigned.docs) hostIds.add(String((doc.data() as StoredWaiverSignature).hostId ?? ''))
  const years =
    states.size >= MAX_SITES
      ? null
      : await Promise.all([...hostIds].map((hostId) => siteRetentionYears(orgId, hostId)))
  return [{ id: 'signed-waivers', text: waiverErasureKeptLine(years) }]
}
