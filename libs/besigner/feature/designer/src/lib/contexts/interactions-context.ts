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
 * Host-app-provided interactions for the Attributes panel (AGL-258): the
 * console supplies the host's element-scoped automations and section
 * experiments plus creators; the designer stays storage-agnostic and
 * hides the section when no context is provided. Element selectors use
 * the renderer's stable `[data-aglyn="leaf:<nodeId>"]` attribute.
 */
export interface InteractionAutomation {
  id: string
  name?: string
  event: string
  selector?: string
  enabled?: boolean
}

export interface SectionExperimentRef {
  id: string
  name?: string
  nodeId?: string
  status?: string
}

export type InteractionTriggerEvent =
  | 'elementClick'
  | 'elementVisible'
  | 'scrollToElement'
  // Hover choreography (AGL-562): mega menus, drawers, show/hide.
  | 'elementHoverEnter'
  | 'elementHoverLeave'

/**
 * A ready-to-persist interaction resolved from a preset's templates
 * (AGL-589): every ref is already a concrete `[data-aglyn="leaf:<id>"]`
 * selector. The host app validates and writes it like a builder save.
 */
export interface PresetInteractionDraftStep {
  type: string
  selector: string
  delayMs?: number
  dismissOn?: string[]
}

export interface PresetInteractionDraft {
  name: string
  event: InteractionTriggerEvent | string
  selector: string
  steps: PresetInteractionDraftStep[]
}

export interface InteractionsContextValue {
  /** The host's site-event automations (for per-element listing). */
  automations?: InteractionAutomation[]
  /** Screen/section experiments (badges + duplication guard). */
  sectionExperiments?: SectionExperimentRef[]
  /**
   * Opens the interaction builder for a new automation bound to the
   * node's element selector — trigger, steps, and frequency configure
   * inline without leaving the besigner (AGL-319).
   */
  onCreateInteraction?: (options: {
    nodeId: string
    event: InteractionTriggerEvent
  }) => void
  /** Reopens the builder for an existing element automation (AGL-319). */
  onEditInteraction?: (options: { id: string; nodeId: string }) => void
  /** Creates a draft section experiment targeting the node. */
  onCreateSectionExperiment?: (options: { nodeId: string }) => void
  /** Enables/disables an element automation in place (wave v7). */
  onToggleInteraction?: (options: { id: string; enabled: boolean }) => void
  /**
   * Persists interactions a preset declared for its inserted nodes
   * (AGL-589) — fired by the add-element flow after the subtree lands
   * so presets like Dropdown Panel arrive with their hover choreography
   * already wired and enabled.
   */
  onCreatePresetInteractions?: (options: {
    interactions: PresetInteractionDraft[]
  }) => void
  /** Soft-deletes an element automation (wave v7). */
  onDeleteInteraction?: (options: { id: string }) => void
}

export const InteractionsContext = createContext<InteractionsContextValue>({})

/** The selector the renderer/automations engine can target for a node. */
export function nodeElementSelector(nodeId: string): string {
  return `[data-aglyn="leaf:${nodeId}"]`
}
