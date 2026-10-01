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

import type { BindingRefVia } from '@aglyn/aglyn/app-utils/binding-tokens'
import type {
  PluginDependent,
  PluginDependentsAnswer,
  PluginDependentsRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-dependents'
import { workflowRecordIndex } from './automation-record-index'

/**
 * Which of a site's workflows call a function, for the "Used by" scan.
 *
 * A workflow step calls a site function by its document id, with the name it
 * had when the step was written beside it as a display hint (AGL-261); a step
 * written before ids existed carries the name alone. Either reference is a
 * dependent: the id survives a rename of the function, the name does not.
 */

/** How many of a site's workflows one scan reads. */
export const FUNCTION_DEPENDENTS_WORKFLOWS_READ = 100

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export async function findFunctionDependents(
  request: PluginDependentsRequest,
): Promise<PluginDependentsAnswer> {
  const id = request.id.trim()
  const name = text(request.name)
  const { records, truncated } = await workflowRecordIndex.list({
    hostId: request.hostId,
    limit: FUNCTION_DEPENDENTS_WORKFLOWS_READ,
  })
  const dependents: PluginDependent[] = []
  for (const record of records) {
    const steps = Array.isArray(record.facts['steps']) ? (record.facts['steps'] as unknown[]) : []
    const via = new Set<BindingRefVia>()
    for (const step of steps) {
      if (!step || typeof step !== 'object') continue
      const { functionId, functionName } = step as Record<string, unknown>
      if (id && text(functionId) === id) via.add('id')
      if (name && text(functionName) === name) via.add('name')
    }
    if (via.size) {
      dependents.push({
        type: 'workflow',
        id: record.id,
        name: record.name,
        via: (['id', 'name'] as const).filter((one) => via.has(one)),
      })
    }
  }
  return { dependents, truncated }
}
