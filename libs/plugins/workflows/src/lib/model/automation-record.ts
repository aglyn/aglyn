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

import type { PluginIndexedRecord } from '@aglyn/aglyn/plugin-manager/plugin-record-index'

/**
 * One stored workflow, webhook or action as this plugin shares it with
 * another (AGL-3080) — the one shape its server indexes
 * (`automation-record-index.ts`) and its console list sources
 * (`workflows-record-lists.ts`) both answer.
 *
 * A deleted record is left out (`null`), and so is an unnamed workflow or
 * webhook.
 *
 * A `workflow`'s `facts`:
 *   `steps` (the stored step list: `functionId`, `functionName`, `args`,
 *   `resultName` each), `returnValue` (a scope name, or `null`) and `trigger`
 *   (`{ event, filter? }`, or `null` for a workflow run only by hand).
 * A `webhook`'s `facts`:
 *   `direction` (`outbound` | `inbound`) and `enabled` (a boolean). Never its
 *   URL and never its secret.
 * An `action`'s `facts`:
 *   `trigger`, `steps` and `enabled`, as stored. An action with no stored
 *   name is named by its id — the name its run history already gives it.
 */

/** The stored kinds, by their Firestore collection under a site. */
export const AUTOMATION_COLLECTIONS = {
  workflow: 'workflows',
  webhook: 'webhooks',
  action: 'actions',
} as const

export type AutomationRecordKind = keyof typeof AUTOMATION_COLLECTIONS

type Data = Readonly<Record<string, unknown>>

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export function automationIndexedRecord(
  kind: AutomationRecordKind,
  id: string,
  data: Data | undefined,
): PluginIndexedRecord | null {
  if (!data || data['deletedAt'] != null) return null
  const stored = str(data['name'])
  if (kind === 'action') {
    return {
      id,
      name: stored || id,
      facts: {
        trigger: data['trigger'] ?? null,
        steps: Array.isArray(data['steps']) ? data['steps'] : [],
        enabled: data['enabled'] !== false,
      },
    }
  }
  if (!stored) return null
  if (kind === 'webhook') {
    return {
      id,
      name: stored,
      facts: { direction: data['direction'], enabled: data['enabled'] !== false },
    }
  }
  return {
    id,
    name: stored,
    facts: {
      steps: Array.isArray(data['steps']) ? data['steps'] : [],
      returnValue: str(data['returnValue']) || null,
      trigger: data['trigger'] ?? null,
    },
  }
}
