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

import type { AiFreeCreditsLeft } from '../model/ai-site-job'
import type { AiUsageMeterWire } from '../usage/ai-usage-wire'
import { watchAiJobsReads } from './ai-jobs-store'
import { publishAiUsageMeter, readAiUsageMeter } from './use-ai-usage-meter'

/**
 * Bring a Free reader's usage strip up to what the jobs list just read
 * (AGL-3722): a job spends credits between chat messages, and nothing else
 * moves the strip. The warn state comes with the figures, worked out by the
 * route, so the strip's rule is not shipped to the browser twice. Kept out of `use-ai-usage-meter.ts` because that file is
 * in the plugin's eager bundle and the jobs store is not.
 *
 * Only an envelope already on the Free plan is touched, and `before` — the
 * envelope held when the read began — guards against overwriting one a door
 * published while the read was in flight, which is newer.
 */
export function refreshAiUsageMeterFree(
  uid: string,
  orgId: string,
  credits: Pick<AiFreeCreditsLeft, 'left' | 'used'> | null | undefined,
  before: AiUsageMeterWire | null,
): void {
  const used = credits?.used
  const known = readAiUsageMeter(uid, orgId)
  if (!used || !known?.mine.free || known !== before) return
  const mine = { ...known.mine, used: used.account ?? known.mine.used }
  const pool = { used: used.org, limit: used.orgBand ?? known.pool.limit }
  const refused = known.refused && (credits?.left ?? 1) <= 0
  publishAiUsageMeter(uid, orgId, { ...known, mine, pool, refused, state: used.state })
}

/**
 * Keep the usage strip current from the jobs list's reads, for as long as the
 * caller (the Assist panel) is mounted. Returns the way to stop.
 */
export function followAiJobsForUsageMeter(): () => void {
  const held = new Map<string, AiUsageMeterWire | null>()
  return watchAiJobsReads({
    start: (uid, orgId) => held.set(`${uid}\n${orgId}`, readAiUsageMeter(uid, orgId)),
    done: (uid, orgId, credits) =>
      refreshAiUsageMeterFree(uid, orgId, credits, held.get(`${uid}\n${orgId}`) ?? null),
  })
}
