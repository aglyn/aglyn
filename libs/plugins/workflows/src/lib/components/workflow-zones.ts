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

import type { WhereUsedResult } from '@aglyn/aglyn/app-utils/where-used'
import { definePluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'

/**
 * Where a workflow is used, shown by whichever plugin draws references.
 *
 * The Automation page asks the platform's where-used scan what a workflow
 * computes and holds the answer. Laying that answer out — the rows, the deep
 * links into a published version, the flag on a legacy name token — is the
 * same dialog a variable and a function open, and it belongs to the plugin
 * that owns those. This page hosts the zone and hands it the answer.
 */
export interface WorkflowUsageZoneProps {
  hostId: string
  /** The scan this page already ran; `null` closes whatever is drawn. */
  usage: { name: string; result: WhereUsedResult } | null
  onClose: () => void
}

export const WORKFLOW_USAGE_ZONE =
  definePluginZone<WorkflowUsageZoneProps>('workflowUsage')
