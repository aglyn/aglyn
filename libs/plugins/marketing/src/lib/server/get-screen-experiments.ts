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

import * as Aglyn from '@aglyn/aglyn/server'
import * as MarketingModel from '../model'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import composeScreenNodes from '@aglyn/tenant-runtime/compose-screen-nodes'

/**
 * A screen/section experiment prepared for the page runtime (AGL-253):
 * the assignment inputs plus a composed node tree per variant whose
 * version differs from the published one (null payload = serve the
 * default tree). Section experiments swap the whole tree too — the
 * variant version differs only in the tested section by construction
 * (the editor duplicates the version and edits that section), so a
 * whole-tree swap is equivalent and avoids subtree surgery on the
 * client. `nodeId` stays as besigner metadata.
 */
export type { ScreenExperiment } from '../model/site-contract'
import type { ScreenExperiment } from '../model/site-contract'

export async function getScreenExperiments(options: {
  hostId: string
  screenId: string
  screen: Aglyn.AglynScreen
}): Promise<ScreenExperiment[]> {
  const experiments: ScreenExperiment[] = []
  try {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(options.hostId)
      .collection('experiments')
      .where('screenId', '==', options.screenId)
      .limit(10)
      .get()
    for (const doc of snapshot.docs) {
      const experiment = doc.data() as MarketingModel.HostExperiment
      if ((experiment as any).deletedAt) continue
      if (experiment.target !== 'screen' && experiment.target !== 'section') {
        continue
      }
      // Running experiments split traffic; finished ones with a winner
      // serve the winner to everyone until the editor republishes.
      const active =
        experiment.status === 'running' ||
        (experiment.status === 'done' && experiment.winnerVariantId)
      if (!active) continue
      const publishedVersionId = String(options.screen.versionId ?? '')
      const payloads: Record<string, Record<string, any> | null> = {}
      for (const variant of (experiment.variants ?? []).slice(
        0,
        MarketingModel.EXPERIMENT_MAX_VARIANTS,
      )) {
        const versionId = variant.versionId?.trim()
        if (!versionId || versionId === publishedVersionId) {
          payloads[variant.id] = null
          continue
        }
        payloads[variant.id] = await composeScreenNodes({
          hostId: options.hostId,
          screenId: options.screenId,
          screen: options.screen,
          versionId,
        })
      }
      experiments.push({
        id: doc.id,
        target: experiment.target,
        status: experiment.status,
        ...(experiment.nodeId ? { nodeId: experiment.nodeId } : {}),
        ...(experiment.winnerVariantId
          ? { winnerVariantId: experiment.winnerVariantId }
          : {}),
        ...(experiment.endAtMs ? { endAtMs: experiment.endAtMs } : {}),
        ...(experiment.goal ? { goal: experiment.goal } : {}),
        variants: (experiment.variants ?? []).map((variant) => ({
          id: variant.id,
          ...(variant.weight != null ? { weight: variant.weight } : {}),
          ...(variant.versionId ? { versionId: variant.versionId } : {}),
        })),
        payloads,
      })
    }
  } catch (error) {
    console.error(error)
  }
  return experiments
}

export default getScreenExperiments
