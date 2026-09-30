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

import {
  registerPluginRecordIndex,
  type PluginIndexedRecord,
  type PluginRecordIndexScope,
} from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'

/**
 * The `pipeline` index the plugin that keeps pipelines publishes (AGL-3080),
 * stood in with the answers a spec hands it — this plugin may not load the
 * CRM that registers the real one. It answers in the shape the CRM's
 * `pipeline-record-index.ts` documents (live pipelines, `facts.stages`), and
 * records every question, so a spec can say what was asked. What the CRM
 * itself answers is held in its own spec.
 */

const OWNER = 'crm'

export interface StoodInPipelineIndex {
  /** Every `list` and `get` asked, in order. */
  asked: Array<PluginRecordIndexScope & { limit?: number; id?: string }>
}

/** Registers the index, answering `pipelines` to every site of every org. */
export function standInPipelineIndex(
  pipelines: ReadonlyArray<{ id: string; name: string; stages: ReadonlyArray<Record<string, unknown>> }>,
): StoodInPipelineIndex {
  const stood: StoodInPipelineIndex = { asked: [] }
  const records: PluginIndexedRecord[] = pipelines.map((pipeline) => ({
    id: pipeline.id,
    name: pipeline.name,
    facts: { stages: pipeline.stages },
  }))
  registerPluginRecordIndex(
    'pipeline',
    {
      async list(request) {
        stood.asked.push(request)
        return { records: records.slice(0, request.limit), truncated: records.length > request.limit }
      },
      async get(request) {
        stood.asked.push(request)
        return records.find((record) => record.id === request.id) ?? null
      },
    },
    { pluginId: OWNER },
  )
  return stood
}

/** Forgets it, so the next spec starts with no plugin keeping pipelines. */
export function removeStandInPipelineIndex(): void {
  unregisterPluginServices(OWNER)
}
