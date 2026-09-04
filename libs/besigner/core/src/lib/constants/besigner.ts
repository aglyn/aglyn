/**
 * @license
 * Copyright 2022 Aglyn LLC
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

export enum InteractionModeFlag {
  SELECT = 0x1,
  REARRANGE = 0x2,
  PREVIEW = 0x3,
}

export enum BesignerPanelViewFlag {
  PANEL_LEFT = 0x1,
  PANEL_RIGHT = 0x2,
  PANEL_BOTTOM = 0x3,
}

export enum BesignerPanelTabFlag {
  ELEMENTS_TREE = 0x1,
  ELEMENT_BROWSE = 0x2,
  /**
   * Retired. The Info panel's two accordions — the component's own
   * description, and the element/parent/component/plugin ids — moved to the
   * bottom of Attributes, where they are reference detail beside the fields
   * they describe rather than a tab of their own.
   *
   * The VALUE stays reserved. Panel state is persisted, so a reader whose
   * last session ended on Info would otherwise come back to a tab id that now
   * means something else.
   */
  ELEMENT_INFO = 0x3,
  ELEMENT_PROPS_FORM = 0x4,
  ELEMENT_STYLES = 0x5,
  ELEMENT_INTERACTIONS = 0x6,
}

export enum DndDragType {
  CANVAS = 'canvas',
  TEMPLATE = 'template',
  TREE = 'tree',
}

export enum DndDropType {
  BEFORE = 0x1,
  INSIDE = 0x2,
  AFTER = 0x3,
}

/**
 * The interaction state the canvas is HOLDING ON for the element being
 * styled (AGL-2486 item 39).
 *
 * You cannot hover an element while working in a side panel, so a state
 * whose styles you cannot see is a state you cannot design. Selecting a
 * state in the Styles panel's chip row holds it on the canvas for that one
 * element; `undefined` is the resting state.
 *
 * Canvas UI context only — it is a flag, never a document field, so it
 * cannot be saved, cannot reach Preview and cannot reach a published page.
 * The union is declared HERE rather than in the designer so the flag store
 * and the panel share one source of truth.
 */
export type BesignerStateFlag =
  | 'hover'
  | 'active'
  | 'focusVisible'
  | 'disabled'

export enum BesignerDeviceFlag {
  SCALE = 0x1,
  RESPONSIVE = 0x2,
  XS = 0x3,
  SM = 0x4,
  MD = 0x5,
  LG = 0x6,
  XL = 0x7,
}
