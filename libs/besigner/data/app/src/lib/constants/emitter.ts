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

import type { PayloadData } from '@aglyn/core-data-foundation'
import type {
  BesignerCanvasHoveredElement,
  BesignerCanvasSelectedElement,
  BesignerCanvasState,
  BesignerContext,
  BesignerDndState,
  BesignerFlagsState,
  BesignerPanelKey,
  BesignerPanelsState,
} from '../definitions/besigner-interface.types'
import {
  BesignerCanvasItemKey,
  BesignerCanvasItemValue,
  BesignerDndItemKey,
  BesignerDndItemValue,
  BesignerFlagValue,
  BesignerPanelValue,
} from '../definitions/besigner-interface.types'

export enum BesignerAppEffectFlag {
  BESIGNER_GET_STORE = 'effect:besigner:get-store',
  BESIGNER_SET_FLAG = 'effect:besigner:set-flag',
  BESIGNER_SET_PANEL = 'effect:besigner:set-panel',
  BESIGNER_OPEN_PANEL = 'effect:besigner:open-panel',
  BESIGNER_CLOSE_PANEL = 'effect:besigner:close-panel',
}

export type BesignerGetStorePayload<K extends keyof BesignerContext = any> =
  PayloadData<{
    store: K
  }>
export type BesignerSetFlagPayload<K extends keyof BesignerFlagsState = any> =
  PayloadData<{
    flag: K
    value: (
      prev: BesignerFlagValue<K>,
      flags: BesignerFlagsState,
    ) => BesignerFlagValue<K>
  }>
export type BesignerSetFlagsPayload = PayloadData<{
  flags: (prev: BesignerFlagsState) => BesignerFlagsState
}>
export type BesignerSetPanelPayload<K extends BesignerPanelKey = any> =
  PayloadData<{
    panel: K
    value: (
      prev: BesignerPanelValue<K>,
      panels: BesignerPanelsState,
    ) => BesignerPanelValue<K>
  }>
export type BesignerSetPanelsPayload = PayloadData<{
  panels: (prev: BesignerPanelsState) => BesignerPanelsState
}>
export type BesignerTogglePanelPayload = PayloadData<{
  panel: BesignerPanelKey
}>
export type BesignerOpenPanelPayload = PayloadData<{ panel: BesignerPanelKey }>
export type BesignerClosePanelPayload = PayloadData<{ panel: BesignerPanelKey }>
export type BesignerSetDndPayload = PayloadData<{
  dnd: (prev: BesignerDndState) => BesignerDndState
}>
export type BesignerSetDndItemPayload<K extends BesignerDndItemKey = any> =
  PayloadData<{
    item: K
    value: (
      prev: BesignerDndItemValue<K>,
      dnd: BesignerDndState,
    ) => BesignerDndItemValue<K>
  }>
export type BesignerSetCanvasPayload = PayloadData<{
  canvas: (prev: BesignerCanvasState) => BesignerCanvasState
}>
export type BesignerSetCanvasItemPayload<
  K extends BesignerCanvasItemKey = any,
> = PayloadData<{
  item: K
  value: (
    prev: BesignerCanvasItemValue<K>,
    canvas: BesignerCanvasState,
  ) => BesignerCanvasItemValue<K>
}>
export type BesignerSetCanvasSelectedPayload = PayloadData<{
  selected: (
    prev: BesignerCanvasSelectedElement,
    canvas: BesignerCanvasState,
  ) => BesignerCanvasSelectedElement
}>
export type BesignerSetCanvasHoveredPayload = PayloadData<{
  hovered: (
    prev: BesignerCanvasHoveredElement,
    canvas: BesignerCanvasState,
  ) => BesignerCanvasHoveredElement
}>

declare module '@aglyn/core-data-foundation' {
  interface AglynModuleEffectPayload {
    [BesignerAppEffectFlag.BESIGNER_GET_STORE]: BesignerGetStorePayload
    [BesignerAppEffectFlag.BESIGNER_SET_FLAG]: BesignerSetFlagPayload
    [BesignerAppEffectFlag.BESIGNER_SET_PANEL]: BesignerSetPanelsPayload
    [BesignerAppEffectFlag.BESIGNER_OPEN_PANEL]: BesignerOpenPanelPayload
    [BesignerAppEffectFlag.BESIGNER_CLOSE_PANEL]: BesignerClosePanelPayload
  }
}
