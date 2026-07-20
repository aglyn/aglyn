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

import { createContext } from 'react'

/**
 * Host-app-provided binding options for the Attributes panel's "Insert
 * binding" menu (AGL-100): the console supplies the host's variables
 * (`{{name}}`) and functions (`{{fn:name(args)}}`); the designer stays
 * storage-agnostic and hides the control when no options exist.
 */
export interface BindingOption {
  /** Menu label, e.g. `Message` or `Sum(P1, P2)`. */
  label: string
  /** Token appended to the element text, e.g. `{{Message}}`. */
  token: string
  /** Section header the option renders under (e.g. Variables). */
  group?: string
  /**
   * Live value preview shown as the option's secondary line (AGL-262),
   * e.g. a variable's current value — picking a binding shouldn't
   * require remembering what it holds.
   */
  preview?: string
  /**
   * Caption rendered under the group's subheader (AGL-583) — e.g. where a
   * context-dependent token group resolves ("Resolves on collection
   * pages"). Read from the group's first visible option.
   */
  groupHint?: string
}

export interface BindingPickerContextValue {
  options?: BindingOption[]
  /**
   * Live-resolution inputs (AGL-97): the host's variable docs (by name)
   * and function definitions (by name) so the canvas can render resolved
   * values via `resolveBindings`. Optional — without them the canvas
   * shows raw tokens regardless of the toggle.
   */
  variables?: Record<string, import('@aglyn/aglyn').HostVariable>
  functions?: Record<string, import('@aglyn/aglyn').HostFunction>
}

export const BindingPickerContext = createContext<BindingPickerContextValue>(
  {},
)
BindingPickerContext.displayName = 'BindingPickerContext'

export default BindingPickerContext
