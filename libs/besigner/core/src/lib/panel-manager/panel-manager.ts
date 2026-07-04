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

import * as Aglyn from '@aglyn/aglyn'
import { observable, runInAction } from 'mobx'
import { computedFn } from 'mobx-utils'

export enum DockRegion { //BesignerPanelViewFlag
  DOCK_LEFT = 0x1,
  DOCK_RIGHT = 0x2,
  DOCK_BOTTOM = 0x3,
}

export enum PanelTab { //BesignerPanelTabFlag
  ELEMENTS_TREE = 0x1,
  ELEMENT_BROWSE = 0x2,
  ELEMENT_INFO = 0x3,
  ELEMENT_PROPS_FORM = 0x4,
  ELEMENT_STYLES = 0x5,
}

export const LEFT_DOCK_WIDTH = 290
export const RIGHT_DOCK_WIDTH = 375
export const BOTTOM_DOCK_HEIGHT = 320

export type PanelId = string

export type PanelSchema = {
  $id: PanelId
  region: DockRegion
  open: boolean
  width?: number | string
  height?: number | string
  tab?: PanelTab
}

interface PanelState {
  panels: Map<PanelId, PanelSchema>
  readonly panelsById: Record<PanelId, PanelSchema>
  readonly isPanelOpen: ($id: PanelId) => boolean
}

export const state = observable<PanelState>({
  panels: new Map<PanelId, PanelSchema>(),
  get panelsById(): Record<PanelId, PanelSchema> {
    return Object.fromEntries(this.panels.entries())
  },
  isPanelOpen: computedFn(($id: PanelId) => {
    return Boolean(state.panels.get($id)?.open)
  }),
})

export const panelLeft = setPanel({
  $id: 'panelLeft',
  region: DockRegion.DOCK_LEFT,
  open: true,
  width: LEFT_DOCK_WIDTH,
})
export const panelRight = setPanel({
  $id: 'panelRight',
  region: DockRegion.DOCK_RIGHT,
  open: true,
  width: RIGHT_DOCK_WIDTH,
})
export const panelBottom = setPanel({
  $id: 'panelBottom',
  region: DockRegion.DOCK_BOTTOM,
  open: false,
  height: BOTTOM_DOCK_HEIGHT,
})

export function hasPanel($id: PanelId): boolean {
  if (!$id) return false
  return state.panels.has($id)
}

export function getPanel($id: PanelId): PanelSchema | null {
  if (!$id) return null
  return state.panels.get($id)
}

export function addPanel(panel: PanelSchema): PanelSchema {
  if (hasPanel(panel?.$id)) throw new Error('Panel already exists')
  return runInAction(() => {
    const $id = panel?.$id || Aglyn.createIdUrlSafe()
    state.panels.set($id, { ...panel, $id })
    return getPanel($id)
  })
}

export function setPanel(panel: PanelSchema): PanelSchema {
  if (!panel?.$id) return
  return runInAction(() => {
    state.panels.set(panel?.$id, panel)
    return getPanel(panel?.$id)
  })
}

export function deletePanel($id: PanelId): boolean {
  if (!$id) return false
  return runInAction(() => {
    return state.panels.delete($id)
  })
}

export function togglePanel($id: PanelId): PanelSchema {
  const panel = getPanel($id)
  if (!panel) return
  return runInAction(() => {
    panel.open = !panel.open
    return panel
  })
}

export function isPanelOpen($id: PanelId): boolean {
  return state.isPanelOpen($id)
}
