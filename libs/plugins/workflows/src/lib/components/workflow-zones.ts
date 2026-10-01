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

/**
 * The Automation page's Actions, beside Add action and Recipes (AGL-2919):
 * another way to start an automation. `openAction` opens a listed action in
 * the Actions editor, and answers `false` when the id names no action the
 * list has read yet — which is how a widget whose draft was just written
 * tells a list that has not caught up from one that opened it. A widget here
 * writes nothing through the page.
 */
export interface HostAutomationsZoneProps {
  hostId: string
  /** The org the page names; `undefined` while it resolves. */
  orgId: string | undefined
  openAction: (actionId: string) => boolean
}

/** One automation on the Automation page: an action, or a workflow (AGL-2919). */
export interface AutomationTarget {
  type: 'action' | 'workflow'
  id: string
  name: string
}

/**
 * The editor of one SAVED automation — an action or a workflow — on the
 * Automation page (AGL-2919). A widget here reads the automation as it is
 * stored and changes nothing in the editor.
 */
export interface AutomationEditorZoneProps {
  hostId: string
  /** The org the page names; `undefined` while it resolves. */
  orgId: string | undefined
  /** The automation the editor has open, as it is stored. */
  target: AutomationTarget
}

/**
 * One FAILED run in an automation's run history (AGL-2919), drawn once per
 * failed row. A widget here reads the run as it was recorded and changes
 * nothing.
 */
export interface AutomationRunZoneProps {
  hostId: string
  /** The org the page names; `undefined` while it resolves. */
  orgId: string | undefined
  /** The automation the run belongs to. */
  target: AutomationTarget
  /** The run's entry in the site's activity log. */
  runId: string
}

export const HOST_AUTOMATIONS_ZONE =
  definePluginZone<HostAutomationsZoneProps>('hostAutomations')

export const AUTOMATION_EDITOR_ZONE =
  definePluginZone<AutomationEditorZoneProps>('automationEditor')

export const AUTOMATION_RUN_ZONE =
  definePluginZone<AutomationRunZoneProps>('automationRun')
