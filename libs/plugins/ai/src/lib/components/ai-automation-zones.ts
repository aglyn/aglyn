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

/**
 * What the workflows plugin's Automation page zones hand this plugin's
 * widgets.
 *
 * `hostAutomations`, `automationEditor` and `automationRun` are zones the
 * workflows plugin hosts and declares (`registerPluginZone`), with their props
 * on its own zone tokens. A plugin never imports another plugin, so the
 * widgets registered there read the props through the shapes restated here —
 * the zone's props as the host documents them, by the same names. A widget is
 * handed whatever the host passes, so this restates what the host SENDS; every
 * member below is one the host documents in the injection zones reference.
 *
 * Types only: nothing here reaches a bundle.
 */

/** What the `hostAutomations` zone hands a widget. */
export interface ConsoleHostAutomationsZoneProps {
  hostId: string
  /** The org the page names; `undefined` while it resolves. */
  orgId: string | undefined
  /**
   * Opens the Actions editor on a listed action. `false` when the id names no
   * action the list has read yet.
   */
  openAction: (actionId: string) => boolean
}

/** One automation on the Automation page: an action, or a workflow. */
export interface ConsoleAutomationTarget {
  type: 'action' | 'workflow'
  id: string
  name: string
}

/** What the `automationEditor` zone hands a widget. */
export interface ConsoleAutomationEditorZoneProps {
  hostId: string
  orgId: string | undefined
  /** The automation the editor has open, as it is stored. */
  target: ConsoleAutomationTarget
}

/** What the `automationRun` zone hands a widget. */
export interface ConsoleAutomationRunZoneProps {
  hostId: string
  orgId: string | undefined
  /** The automation the run belongs to. */
  target: ConsoleAutomationTarget
  /** The run's entry in the site's activity log. */
  runId: string
}
