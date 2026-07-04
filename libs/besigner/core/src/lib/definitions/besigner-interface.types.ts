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

import type {
  AglynNodeHierarchy,
  BundleId,
  ComponentId,
  ComponentsLinealOrder,
  NodeId,
} from '@aglyn/aglyn'
import type { IBesignerAppController } from './besigner-app.types'
// eslint-disable-next-line @nx/enforce-module-boundaries
import type { LogLevelString } from '@aglyn/shared-util-logger'
import type { BehaviorSubject } from 'rxjs'
import type {
  BesignerDeviceFlag,
  BesignerPanelTabFlag,
  BesignerPanelViewFlag,
  DndDragType,
  DndDropType,
  InteractionModeFlag,
} from '../constants/besigner'
import type {
  BesignerClosePanelPayload,
  BesignerGetStorePayload,
  BesignerOpenPanelPayload,
  BesignerSetCanvasHoveredPayload,
  BesignerSetCanvasItemPayload,
  BesignerSetCanvasPayload,
  BesignerSetCanvasSelectedPayload,
  BesignerSetDndItemPayload,
  BesignerSetDndPayload,
  BesignerSetFlagPayload,
  BesignerSetFlagsPayload,
  BesignerSetPanelPayload,
  BesignerSetPanelsPayload,
  BesignerTogglePanelPayload,
} from '../constants/emitter'

export type BesignerContext = {
  flags: {
    debug: boolean
    logLevel: LogLevelString
    interactMode: InteractionModeFlag
    activeView?: BesignerPanelViewFlag
    devicePreview?: BesignerDeviceFlag
  }
  canvas: {
    selected?: {
      $id?: NodeId
      hierarchy?: NodeId[]
    }
    hovered?: {
      $id?: NodeId
      hierarchy?: NodeId[]
    }
  }
  panels: {
    panelLeft?: BesignerPanelItem
    panelRight?: BesignerPanelItem
    panelBottom?: BesignerPanelItem
  }
  dnd: {
    active?: BesignerDndElementBaseData<DndDragType>
    over?: BesignerDndElementBaseData<DndDropType>
  }
}
export type BesignerFlagsState = BesignerContext['flags']
export type BesignerFlagKey = keyof BesignerFlagsState
export type BesignerFlagValue<K extends BesignerFlagKey = BesignerFlagKey> =
  BesignerFlagsState[K]
export type BesignerCanvasState = BesignerContext['canvas']
export type BesignerCanvasItemKey = keyof BesignerCanvasState
export type BesignerCanvasItemValue<
  K extends BesignerCanvasItemKey = BesignerCanvasItemKey,
> = BesignerCanvasState[K]
export type BesignerCanvasSelectedElement = BesignerCanvasItemValue<'selected'>
export type BesignerCanvasHoveredElement = BesignerCanvasItemValue<'hovered'>
export type BesignerPanelsState = BesignerContext['panels']
export type BesignerPanelKey = keyof BesignerPanelsState
export type BesignerPanelValue<K extends BesignerPanelKey = BesignerPanelKey> =
  BesignerPanelsState[K]
export type BesignerDndState = BesignerContext['dnd']
export type BesignerDndItemKey = keyof BesignerDndState
export type BesignerDndItemValue<
  K extends BesignerDndItemKey = BesignerDndItemKey,
> = BesignerDndState[K]
export type BesignerDraggableItem = BesignerContext['dnd']['active']
export type BesignerDroppableItem = BesignerContext['dnd']['over']
export type BesignerPanelItem = {
  id?: BesignerPanelViewFlag
  size?: number | string
  toggled?: boolean
  tab?: BesignerPanelTabFlag
}
export type BesignerDndElementBaseData<T extends DndDragType | DndDropType> =
  JSX.AnyProps & {
    $id: NodeId
    componentId?: ComponentId
    pluginId?: BundleId
    trail?: AglynNodeHierarchy
    restrictParent?: ComponentsLinealOrder
    restrictChildren?: ComponentsLinealOrder
  }

export interface BesignerInterfaceControllerOptions {
  logLevel?: LogLevelString
  defaults?: Partial<BesignerContext>
}

export interface IBesignerInterfaceController {
  readonly __store__: {
    [K in keyof BesignerContext]: BehaviorSubject<BesignerContext[K]>
  }
  readonly canvas: this['__store__']['canvas']
  readonly dnd: this['__store__']['dnd']
  readonly flags: this['__store__']['flags']
  readonly panels: this['__store__']['panels']

  getStore<K extends keyof BesignerContext>(
    payload: BesignerGetStorePayload<K>,
  ): BehaviorSubject<BesignerContext[K]>

  closePanel(payload: BesignerClosePanelPayload): this
  openPanel(payload: BesignerOpenPanelPayload): this
  setCanvas(payload: BesignerSetCanvasPayload): this
  setCanvasHovered(payload: BesignerSetCanvasHoveredPayload): this
  setCanvasItem(payload: BesignerSetCanvasItemPayload): this
  setCanvasSelected(payload: BesignerSetCanvasSelectedPayload): this
  setDnd(payload: BesignerSetDndPayload): this
  setDndItem(payload: BesignerSetDndItemPayload): this
  setFlag(payload: BesignerSetFlagPayload): this
  setFlags(payload: BesignerSetFlagsPayload): this
  setPanel(payload: BesignerSetPanelPayload): this
  setPanels(payload: BesignerSetPanelsPayload): this
  togglePanel(payload: BesignerTogglePanelPayload): this
}

export interface BesignerInterfaceControllerT {
  new (
    app: IBesignerAppController,
    options: BesignerInterfaceControllerOptions,
  ): IBesignerInterfaceController
}
