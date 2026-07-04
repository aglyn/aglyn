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

import { AglynModuleModel } from '@aglyn/aglyn'
import type {
  AglynModuleEffectListener,
  IAglynAppController,
} from '@aglyn/aglyn'
import { cloneDeep } from '@aglyn/shared-util-tools'
import defaultsDeep from 'lodash-es/defaultsDeep'
import isEqual from 'lodash-es/isEqual'
import { BehaviorSubject } from 'rxjs'
// import {persist} from 'effector-storage/local'
import {
  BesignerDeviceFlag,
  BesignerPanelViewFlag,
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
import type {
  BesignerContext,
  BesignerInterfaceControllerOptions,
  IBesignerInterfaceController,
} from '../definitions/besigner-interface.types'

const TAG = 'BesignerInterface'
const NS = 'com.aglyn.besigner.data.controller.interface'

export class BesignerInterfaceController
  extends AglynModuleModel<BesignerInterfaceControllerOptions>
  implements IBesignerInterfaceController
{
  public readonly __store__: {
    [K in keyof BesignerContext]: BehaviorSubject<BesignerContext[K]>
  }

  public static get [Symbol.toStringTag](): string {
    return TAG
  }
  public static get namespace(): string {
    return NS
  }
  public get canvas(): this['__store__']['canvas'] {
    return this.__store__?.canvas
  }
  public get dnd(): this['__store__']['dnd'] {
    return this.__store__?.dnd
  }
  public get flags(): this['__store__']['flags'] {
    return this.__store__?.flags
  }
  public get panels(): this['__store__']['panels'] {
    return this.__store__?.panels
  }

  protected get listeners(): AglynModuleEffectListener<any>[] {
    return []
  }

  constructor(
    app: IAglynAppController,
    options: BesignerInterfaceControllerOptions,
  ) {
    super(app, options)
    const state = defaultsDeep({}, options.defaults, {
      flags: {
        debug: true,
        logLevel: 'info',
        interactMode: InteractionModeFlag.SELECT,
        devicePreview: BesignerDeviceFlag.RESPONSIVE,
      },
      panels: {
        panelLeft: {
          id: BesignerPanelViewFlag.PANEL_LEFT,
          size: 290,
          toggled: true,
        },
        panelRight: {
          id: BesignerPanelViewFlag.PANEL_RIGHT,
          size: 375,
          toggled: true,
        },
        panelBottom: {
          id: BesignerPanelViewFlag.PANEL_BOTTOM,
          toggled: false,
        },
      },
      canvas: {
        hovered: {},
        selected: {},
      },
      dnd: {
        active: null,
        over: null,
      },
    })

    this.__store__ = {
      canvas: new BehaviorSubject(state.canvas),
      // .pipe(throttleTime(20, undefined, {leading: false, trailing: true})),
      dnd: new BehaviorSubject(state.dnd),
      flags: new BehaviorSubject(state.flags),
      panels: new BehaviorSubject(state.panels),
    }
    this.setupInternal()
  }
  private setupInternal() {}

  public toJSON() {
    return {
      ...super.toJSON(),
    }
  }

  private isDeepEqual<T>(prev: unknown, now: T): prev is T {
    return isEqual(prev, now)
  }

  public getStore<K extends keyof BesignerContext>(
    payload: BesignerGetStorePayload<K>,
  ): BehaviorSubject<BesignerContext[K]> {
    const { store } = payload
    return this.__store__?.[store]
  }

  public setFlag(payload: BesignerSetFlagPayload): this {
    const { flag, value } = payload || {}
    const prev = this.__store__?.flags?.getValue()
    const prevValue = prev?.[flag]
    const nowValue = value(prevValue, prev)
    const now = { ...prev, [flag]: nowValue }
    !this.isDeepEqual(prevValue, nowValue) && this.__store__?.flags?.next(now)
    return this
  }
  public setFlags(payload: BesignerSetFlagsPayload): this {
    const { flags } = payload || {}
    const prev = this.__store__?.flags?.getValue()
    const now = flags(prev)
    !this.isDeepEqual(prev, now) && this.__store__?.flags?.next(now)
    return this
  }
  public setPanel(payload: BesignerSetPanelPayload): this {
    const { panel, value } = payload || {}
    const prev = cloneDeep(this.__store__?.panels?.getValue())
    const prevPanel = prev?.[panel]
    const nowPanel = value(prevPanel, prev)
    const now = { ...prev, [panel]: nowPanel }
    !this.isDeepEqual(prevPanel, nowPanel) && this.__store__?.panels?.next(now)
    return this
  }
  public setPanels(payload: BesignerSetPanelsPayload): this {
    const { panels } = payload || {}
    const prev = this.__store__?.panels?.getValue()
    const now = panels(prev)
    !this.isDeepEqual(prev, now) && this.__store__?.panels?.next(now)
    return this
  }
  public togglePanel(payload: BesignerTogglePanelPayload): this {
    const { panel } = payload || {}
    const prev = this.__store__?.panels?.getValue()
    const prevPanel = prev?.[panel]
    const now = {
      ...prev,
      [panel]: { ...prevPanel, toggled: !prevPanel?.toggled },
    }
    !this.isDeepEqual(prev, now) && this.__store__?.panels?.next(now)
    return this
  }
  public openPanel(payload: BesignerOpenPanelPayload): this {
    const { panel } = payload || {}
    const prev = this.__store__?.panels?.getValue()
    const prevPanel = prev?.[panel]
    const now = { ...prev, [panel]: { ...prevPanel, toggled: true } }
    !prevPanel?.toggled && this.__store__?.panels?.next(now)
    return this
  }
  public closePanel(payload: BesignerClosePanelPayload): this {
    const { panel } = payload || {}
    const prev = this.__store__?.panels?.getValue()
    const prevPanel = prev?.[panel]
    const now = { ...prev, [panel]: { ...prevPanel, toggled: false } }
    prevPanel?.toggled && this.__store__?.panels?.next(now)
    return this
  }
  public setDndItem(payload: BesignerSetDndItemPayload): this {
    const { item, value } = payload || {}
    const prev = this.__store__?.dnd?.getValue()
    const prevItem = prev?.[item]
    const nowItem = value(prevItem, prev)
    const now = { ...prev, [item]: nowItem }
    !this.isDeepEqual(prevItem, nowItem) && this.__store__?.dnd?.next(now)
    return this
  }
  public setDnd(payload: BesignerSetDndPayload): this {
    const { dnd } = payload || {}
    const prev = this.__store__?.dnd?.getValue()
    const now = dnd(prev)
    !this.isDeepEqual(prev, now) && this.__store__?.dnd?.next(now)
    return this
  }
  public setCanvasItem(payload: BesignerSetCanvasItemPayload): this {
    const { item, value } = payload || {}
    const prev = this.__store__?.canvas?.getValue()
    const prevItem = prev?.[item]
    const nowItem = value(prevItem, prev)
    const now = { ...prev, [item]: nowItem }
    !this.isDeepEqual(prevItem, nowItem) && this.__store__?.canvas?.next(now)
    return this
  }
  public setCanvas(payload: BesignerSetCanvasPayload): this {
    const { canvas } = payload || {}
    const prev = this.__store__?.canvas?.getValue()
    const now = canvas(prev)
    !this.isDeepEqual(prev, now) && this.__store__?.canvas?.next(now)
    return this
  }
  public setCanvasSelected(payload: BesignerSetCanvasSelectedPayload): this {
    const { selected } = payload || {}
    const prev = this.__store__?.canvas?.getValue()
    const now = { ...prev, selected: selected(prev?.selected, prev) }
    !this.isDeepEqual(prev?.selected, now?.selected) &&
      this.__store__?.canvas?.next(now)
    return this
  }
  public setCanvasHovered(payload: BesignerSetCanvasHoveredPayload): this {
    const { hovered } = payload || {}
    const prev = this.__store__?.canvas?.getValue()
    const now = { ...prev, hovered: hovered(prev?.hovered, prev) }
    !this.isDeepEqual(prev?.hovered, now?.hovered) &&
      this.__store__?.canvas?.next(now)
    return this
  }
}

export default BesignerInterfaceController
