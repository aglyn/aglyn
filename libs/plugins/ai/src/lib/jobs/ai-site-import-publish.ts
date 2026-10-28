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

/*==========================================
 * EACH WAVE LANDS IN THE SITE'S PREVIEW (AGL-4084).
 *
 * A site brought in starts in preview (AGL-4086, `host.preview`): the public
 * sees its notice, and its team sees the whole site. So when a wave closes,
 * its pages go live INTO THE PREVIEW through the same writes a guided
 * start's publish makes (`aiPublishGuidedSite`): each page takes its
 * address, Home takes `/`, the links to a page still a draft come out, and
 * the cached pages go. The team opens the site and sees the wave; the public
 * still sees the notice until the person makes the site public.
 *
 * Only into a preview. A site that is not in preview keeps the wave's pages
 * as drafts, as every import did before: the public never sees a page no
 * person has looked at. And `site_published` is not sent here: the site is
 * published when its switch makes it public (AGL-4086), not when a wave
 * lands.
 *=========================================*/

import { isHostInPreview } from '@aglyn/aglyn/app-utils/site-preview'
import type { AiJob, AiJobItemLedger, AiJobOutput, AiJobSitePublish } from '../model/ai-jobs.types'
import type { AiSiteImportState, AiSiteImportWave } from '../model/ai-site-import'
import { aiMergeSitePublish, aiPublishGuidedSite, type AiSitePublishDeps } from './ai-site-publish'

export interface AiSiteImportPublishDeps {
  publish?: typeof aiPublishGuidedSite
  /** Whether the site is in preview now. */
  inPreview?: (firestore: FirebaseFirestore.Firestore, hostId: string) => Promise<boolean>
}

async function readInPreview(firestore: FirebaseFirestore.Firestore, hostId: string): Promise<boolean> {
  const host = await firestore.collection('hosts').doc(hostId).get()
  return host.exists && isHostInPreview({ preview: host.get('preview') })
}

const delivered = (row: AiJobItemLedger | undefined) => row?.status === 'succeeded' || row?.status === 'degraded'

/** The pages of the import a link may not go to yet: every one not in, the wave's own failures included. */
export function aiSiteImportUnbuilt(state: AiSiteImportState, items: readonly AiJobItemLedger[]): string[] {
  const rows = new Map(items.map((row) => [row.slot, row]))
  return state.pages.filter((page) => !delivered(rows.get(page.slot))).map((page) => page.draftId)
}

/** The wave's pages that came in, as the outputs that publish them, in the wave's order. */
export function aiSiteImportWaveOutputs(
  state: AiSiteImportState,
  wave: AiSiteImportWave,
  items: readonly AiJobItemLedger[],
  outputs: readonly AiJobOutput[],
): AiJobOutput[] {
  const rows = new Map(items.map((row) => [row.slot, row]))
  return wave.slots.flatMap((slot) => {
    const page = state.pages.find((entry) => entry.slot === slot)
    if (!page || !delivered(rows.get(slot))) return []
    const output = outputs.find((entry) => entry.resource === 'screen' && entry.id === page.draftId)
    return output ? [output] : []
  })
}

/**
 * A closed wave's pages, live in the site's preview (AGL-4084). `null` when
 * nothing went live: the site is not in preview, or none of the wave's pages
 * came in. The job's earlier publish is carried in the answer.
 */
export async function aiPublishImportedWave(
  firestore: FirebaseFirestore.Firestore,
  input: {
    job: Pick<AiJob, '$id' | 'orgId' | 'hostId'> & Partial<Pick<AiJob, 'inputs' | 'sitePublish'>>
    state: AiSiteImportState
    wave: AiSiteImportWave
    items: readonly AiJobItemLedger[]
    outputs: readonly AiJobOutput[]
    now: Date
  },
  deps: AiSiteImportPublishDeps = {},
): Promise<AiJobSitePublish | null> {
  const hostId = input.job.hostId
  if (!hostId) return null
  const pages = aiSiteImportWaveOutputs(input.state, input.wave, input.items, input.outputs)
  if (!pages.length) return null
  if (!(await (deps.inPreview ?? readInPreview)(firestore, hostId))) return null
  const publishDeps: AiSitePublishDeps = {
    // Published when its switch makes it public (AGL-4086), never when a wave lands.
    sendSitePublished: async () => undefined,
  }
  const already = input.job.sitePublish ?? null
  const result = await (deps.publish ?? aiPublishGuidedSite)(
    firestore,
    {
      job: input.job,
      outputs: pages,
      now: input.now,
      // The links to a page still to come, or one that did not come in, come out.
      unbuiltScreenIds: aiSiteImportUnbuilt(input.state, input.items),
      siteOrder: input.state.pages.map((page) => page.draftId),
      // A later wave joins what is live: it never takes the home address again.
      ...(already?.published.length ? { retry: true } : {}),
    },
    publishDeps,
  )
  return already ? aiMergeSitePublish(already, result) : result
}
