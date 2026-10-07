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

import type { AiLogicProposal } from '../model/ai-logic-job'

/**
 * What the logic plugin's Functions & Variables zones hand this plugin's
 * widgets (AGL-3603).
 *
 * `hostLogic`, `logicFunctionEditor` and `logicReferenceIssue` are zones the
 * logic plugin hosts and declares, with their props on its own zone tokens.
 * A plugin never imports another plugin, so the widgets registered there read
 * the props through the shapes restated here, by the same names. A proposal
 * is the logic plugin's `LogicProposal`, which this plugin's job output
 * carries in the same shape.
 *
 * Types only: nothing here reaches a bundle.
 */

/** What the `hostLogic` zone hands a widget. */
export interface ConsoleHostLogicZoneProps {
  hostId: string
  orgId: string | undefined
  /** The card the zone is drawn on. */
  kind: 'function' | 'variable'
  /** Opens a proposal in the card's editor, unsaved; `false` when it cannot. */
  propose: (proposal: AiLogicProposal) => boolean
}

/** What the `logicFunctionEditor` zone hands a widget. */
export interface ConsoleLogicFunctionEditorZoneProps {
  hostId: string
  orgId: string | undefined
  /** The function the editor has open, as it is stored. */
  target: { id: string; name: string }
  propose: (proposal: AiLogicProposal) => boolean
}

/** One broken reference, as the Reference health card lists it. */
export interface ConsoleLogicReferenceIssue {
  source: 'action' | 'workflow' | 'variable' | 'screen'
  sourceId: string
  sourceName: string
  refType: string
  missing: string
}

/** What the `logicReferenceIssue` zone hands a widget. */
export interface ConsoleLogicReferenceIssueZoneProps {
  hostId: string
  orgId: string | undefined
  issue: ConsoleLogicReferenceIssue
}
