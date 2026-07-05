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
  BesignerSetFlagPayload,
  BesignerSetFlagsPayload,
  BesignerSetPanelPayload,
  BesignerSetPanelsPayload,
} from '../definitions/emitter.types'
import type { IBesignerAppController } from '../definitions/besigner-app.types'
import type {
  BesignerContext,
  BesignerInterfaceControllerOptions,
  IBesignerInterfaceController,
} from '../definitions/besigner-interface.types'

const TAG = 'BesignerInterface'
const NS = 'com.aglyn.besigner.data.controller.interface'

export class BesignerInterfaceController
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
  public get flags(): this['__store__']['flags'] {
    return this.__store__?.flags
  }
  public get panels(): this['__store__']['panels'] {
    return this.__store__?.panels
  }

  constructor(
    protected readonly app: IBesignerAppController,
    protected readonly options: BesignerInterfaceControllerOptions,
  ) {
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
    })

    this.__store__ = {
      flags: new BehaviorSubject(state.flags),
      panels: new BehaviorSubject(state.panels),
    }
    this.setupInternal()
  }
  private setupInternal() {}

  public toJSON() {
    return { tag: TAG, namespace: NS, appName: this.app?.getName?.() }
  }

  private isDeepEqual<T>(prev: unknown, now: T): prev is T {
    return isEqual(prev, now)
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
}

export default BesignerInterfaceController
