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

import {type LogLevelString} from '@aglyn/shared-util-logger'
import {
  type BesignerPanelTabFlag,
  type BesignerPanelViewFlag,
  type DndDragSourceTypeFlag,
  type DndDropLinealTypeFlag,
  type InteractionModeFlag,
} from '../constants/besigner'
import {
  type BesignerClosePanelPayload,
  type BesignerFlagInteractModePayload,
  type BesignerGetStorePayload,
  type BesignerOpenPanelPayload,
  type BesignerSetCanvasHoveredPayload,
  type BesignerSetCanvasSelectedPayload,
  type BesignerSetDndStatePayload,
  type BesignerSetPanelPayload,
} from '../constants/emitter'
import {
  type AglynModuleModelOptions,
  type AglynModuleModelT,
  type IAglynModuleModel,
} from '../models/aglyn-module.types'
import {type IAglynAppController} from './aglyn-app.types'
import {
  type AglynComponentHierarchy,
  type BundleUId,
  type ComponentId,
  type ElementId,
} from './aglyn-components.types'
import {type ContextDomain, type ContextStore} from './aglyn-contexts.types'


export type BesignerFlagState = {
  debug?: boolean
  logLevel?: LogLevelString
  interactMode?: InteractionModeFlag
  activeView?: BesignerPanelViewFlag
}
export type BesignerCanvasSelectedElement = {
  $id?: ElementId
  hierarchy?: ElementId[]
}
export type BesignerCanvasHoveredElement = {
  $id?: ElementId
  hierarchy?: ElementId[]
}
export type BesignerCanvasState = {
  selected?: BesignerCanvasSelectedElement
  hovered?: BesignerCanvasHoveredElement
}
export type BesignerPanelItem = {
  id?: BesignerPanelViewFlag
  size?: number | string
  toggled?: boolean
  tab?: BesignerPanelTabFlag
}
export type BesignerPanelsState = {
  panelLeft?: BesignerPanelItem
  panelRight?: BesignerPanelItem
  panelBottom?: BesignerPanelItem
}
export type BesignerDndElementBaseData<T extends DndDragSourceTypeFlag | DndDropLinealTypeFlag> = {
  $id: ElementId
  type?: T
  componentId?: ComponentId
  bundleId?: BundleUId
  hierarchy?: AglynComponentHierarchy
}
export type BesignerDndElementActive = BesignerDndElementBaseData<DndDragSourceTypeFlag>
export type BesignerDndElementOver = BesignerDndElementBaseData<DndDropLinealTypeFlag>
export type BesignerDndState = {
  active?: BesignerDndElementActive
  over?: BesignerDndElementOver
}
export type BesignerContextStores = {
  flags: BesignerFlagState
  canvas: BesignerCanvasState
  panels: BesignerPanelsState
  dnd: BesignerDndState
}
export type BesignerNestedStores<K extends keyof BesignerContextStores = keyof BesignerContextStores> = {
  [P in K]: ContextStore<BesignerContextStores[P]>
}

export interface BesignerContext {
  _domain: ContextDomain
  _store: ContextStore<BesignerContextStores>
  stores: BesignerNestedStores
  events: any
}

export interface AglynBesignerControllerOptions extends AglynModuleModelOptions {
  defaults?: Partial<BesignerContextStores>
}

export interface IAglynBesignerController extends IAglynModuleModel<AglynBesignerControllerOptions> {
  readonly _domain: ContextDomain
  readonly _store: ContextStore<BesignerContextStores>
  readonly stores: BesignerNestedStores
  readonly events: any
  readonly flags: ContextStore<BesignerFlagState>
  readonly canvas: ContextStore<BesignerCanvasState>
  readonly panels: ContextStore<BesignerPanelsState>
  readonly dnd: ContextStore<BesignerDndState>

  getStore<K extends keyof BesignerContextStores>(payload: BesignerGetStorePayload<K>): ContextStore<BesignerContextStores[K]>
  setFlag(payload: BesignerFlagInteractModePayload)
  setPanels(payload: BesignerSetPanelPayload)
  openPanel(payload: BesignerOpenPanelPayload)
  closePanel(payload: BesignerClosePanelPayload)
  setDndState(payload: BesignerSetDndStatePayload)
  setCanvasSelected(payload: BesignerSetCanvasSelectedPayload)
  setCanvasHovered(payload: BesignerSetCanvasHoveredPayload)
}

export interface AglynBesignerControllerT extends AglynModuleModelT<AglynBesignerControllerOptions> {
  new(app: IAglynAppController, options: AglynBesignerControllerOptions): IAglynBesignerController
}
