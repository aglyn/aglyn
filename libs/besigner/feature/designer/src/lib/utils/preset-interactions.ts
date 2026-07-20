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

import type { NodeSchema, NodeSchemaNested, PresetSchema } from '@aglyn/aglyn'
import {
  nodeElementSelector,
  type PresetInteractionDraft,
  type PresetInteractionDraftStep,
} from '../contexts/interactions-context'

/**
 * Resolves a preset's `presetRef` markers to the node ids minted at
 * insert time (AGL-589). `createDuplicateNode` clones the preset's
 * `data` tree preserving field values and child order, so the authored
 * tree and the inserted subtree walk in lockstep — pairing them
 * positionally maps each marker to its live id without the preset ever
 * knowing ids exist.
 */
export function collectPresetRefIds(
  data: NodeSchemaNested<any> | undefined,
  live: NodeSchema<any> | undefined | null,
): Record<string, string> {
  const refs: Record<string, string> = {}
  const walk = (
    dataNode: NodeSchemaNested<any> | undefined,
    liveNode: NodeSchema<any> | undefined,
  ): void => {
    if (!dataNode || !liveNode) return
    if (dataNode.presetRef && liveNode.$id != null) {
      refs[dataNode.presetRef] = String(liveNode.$id)
    }
    const dataChildren = dataNode.nodes ?? []
    const liveChildren = liveNode.children ?? []
    for (let index = 0; index < dataChildren.length; index += 1) {
      walk(dataChildren[index], liveChildren[index])
    }
  }
  walk(data, live ?? undefined)
  return refs
}

/**
 * Materializes a preset's interaction templates into ready-to-persist
 * drafts: refs become `[data-aglyn="leaf:<id>"]` selectors. Templates
 * (or steps) whose refs don't resolve are dropped rather than written
 * broken — an unresolved ref means the preset author renamed a marker
 * without updating the template, and a selector-less action would fail
 * validation anyway.
 */
export function buildPresetInteractionDrafts(
  preset: PresetSchema<any>,
  live: NodeSchema<any> | undefined | null,
): PresetInteractionDraft[] {
  const interactions = preset?.interactions ?? []
  if (!interactions.length || !live) return []
  const refs = collectPresetRefIds(preset.data, live)
  const drafts: PresetInteractionDraft[] = []
  for (const interaction of interactions) {
    const triggerId = refs[interaction.triggerRef]
    if (!triggerId) continue
    const steps: PresetInteractionDraftStep[] = []
    for (const step of interaction.steps ?? []) {
      const targetId = refs[step.targetRef]
      if (!targetId) continue
      steps.push({
        type: step.type,
        selector: nodeElementSelector(targetId),
        ...(typeof step.delayMs === 'number' ? { delayMs: step.delayMs } : {}),
        ...(step.dismissOn?.length ? { dismissOn: [...step.dismissOn] } : {}),
      })
    }
    if (!steps.length) continue
    drafts.push({
      name: interaction.name,
      event: interaction.event,
      selector: nodeElementSelector(triggerId),
      steps,
    })
  }
  return drafts
}

export default buildPresetInteractionDrafts
