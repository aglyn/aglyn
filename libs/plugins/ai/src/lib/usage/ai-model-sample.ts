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

import { AI_METER_SENTINELS, type AiStepKind } from '../providers/catalog'
import type { AiUsage } from '../providers/contract'
import { aiMedianUsage } from '../providers/model-choice'

/**
 * The workspace's own typical exchange per step kind (AGL-2942), for the
 * price beside each option in the model switch.
 *
 * Read from `orgs/{orgId}/assistSignals` — the derived half of every metered
 * turn, which carries its route, its model and its tokens and no prose and no
 * uid — newest first, bounded, and only when the switch is opened. A signal
 * is matched to a step kind by the route it was metered under, docs answers
 * and cache hits are left out because no model ran, and the median needs
 * `AI_MEASURED_MEDIAN_MIN_SAMPLES` exchanges before it replaces the nominal
 * figure.
 */

/** Signals one read considers. */
export const AI_MODEL_SAMPLE_SIGNALS = 60

const COPY_ROUTE = '/api/ai/assist/'
const JOBS_ROUTE = 'ai/jobs'

/** Whether a signal's route is the door a step kind is served through. */
export function signalRouteMatchesStep(route: string, kind: AiStepKind): boolean {
  switch (kind) {
    case 'copy.element':
      return route === `${COPY_ROUTE}element`
    case 'copy.blog':
      return route === `${COPY_ROUTE}blog`
    case 'copy.section':
    case 'generate.section':
      return route === `${COPY_ROUTE}section`
    case 'job.text':
      return route === JOBS_ROUTE
    default:
      // A chat turn is metered under the console route it was asked from.
      return !route.startsWith(COPY_ROUTE) && route !== JOBS_ROUTE
  }
}

const SENTINELS = new Set<string>(Object.values(AI_METER_SENTINELS))

/** The measured median exchange for a step kind, or `null` too few. */
export async function readMeasuredStepUsage(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  kind: AiStepKind,
): Promise<AiUsage | null> {
  const snapshot = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection('assistSignals')
    .orderBy('createdAt', 'desc')
    .limit(AI_MODEL_SAMPLE_SIGNALS)
    .get()
  const samples: AiUsage[] = []
  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>
    if (data['deflected'] === true) continue
    if (SENTINELS.has(String(data['model'] ?? ''))) continue
    if (!signalRouteMatchesStep(String(data['route'] ?? ''), kind)) continue
    samples.push({
      inputTokens: Number(data['inputTokens'] ?? 0),
      outputTokens: Number(data['outputTokens'] ?? 0),
      cacheReadTokens: Number(data['cacheReadTokens'] ?? 0),
      cacheWriteTokens: Number(data['cacheWriteTokens'] ?? 0),
    })
  }
  return aiMedianUsage(samples)
}
