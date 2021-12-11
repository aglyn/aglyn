/**
 * @license
 * Copyright 2021 Aglyn LLC
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
  ELEMENT_INFO = 0x1,
  ELEMENT_PROPS_FORM = 0x2,
  ELEMENTS_TREE = 0x3
}

export enum DndDragSourceTypeFlag {
  CANVAS_ELEMENT = 0x1,
  COMPONENT_TEMPLATE = 0x2,
}

export enum DndDropLinealTypeFlag {
  ACTIVITY_ELEMENT_BEFORE = 0x1,
  ACTIVITY_ELEMENT_INSIDE = 0x2,
  ACTIVITY_ELEMENT_AFTER = 0x3,
}
