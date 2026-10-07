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

import type { HostFunction, HostVariableType } from '@aglyn/aglyn'
import { definePluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'
import type { ReferenceIssue } from '../model/reference-audit'

/**
 * What another plugin may put in front of the logic editors (AGL-3603): a
 * function to open in the Functions editor, or a variable to open in the
 * Variables editor. Either opens UNSAVED; the editor's own Save is the only
 * write, and a person makes it, or does not.
 */
export type LogicProposal =
  | {
      kind: 'function'
      /** The saved function the proposal changes, or `null` for a new one. */
      functionId: string | null
      definition: HostFunction
    }
  | {
      kind: 'variable'
      variable: { name: string; type: HostVariableType; value: string }
    }

/**
 * Beside Add function on the Functions card and Add variable on the
 * Variables card: another way to start one. `kind` says which card the zone
 * is drawn on; `propose` opens a proposal of that kind in the card's editor,
 * unsaved, and answers `false` for one of the other kind or one the card
 * cannot open (its plan cap reached, say).
 */
export interface HostLogicZoneProps {
  hostId: string
  /** The org the page names; `undefined` while it resolves or where none is handed. */
  orgId: string | undefined
  kind: 'function' | 'variable'
  propose: (proposal: LogicProposal) => boolean
}

/**
 * Inside the editor of one SAVED function. A widget here reads the function
 * as it is stored; `propose` replaces what the editor holds with a changed
 * definition, unsaved, which the editor's Save writes.
 */
export interface LogicFunctionEditorZoneProps {
  hostId: string
  orgId: string | undefined
  /** The function the editor has open, as it is stored. */
  target: { id: string; name: string }
  propose: (proposal: LogicProposal) => boolean
}

/** One broken reference on the Reference health card. A widget here reads it and changes nothing. */
export interface LogicReferenceIssueZoneProps {
  hostId: string
  orgId: string | undefined
  issue: ReferenceIssue
}

export const HOST_LOGIC_ZONE = definePluginZone<HostLogicZoneProps>('hostLogic')

export const LOGIC_FUNCTION_EDITOR_ZONE =
  definePluginZone<LogicFunctionEditorZoneProps>('logicFunctionEditor')

export const LOGIC_REFERENCE_ISSUE_ZONE =
  definePluginZone<LogicReferenceIssueZoneProps>('logicReferenceIssue')
