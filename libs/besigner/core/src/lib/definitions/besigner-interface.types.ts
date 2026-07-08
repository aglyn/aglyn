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

import type { HostViewType } from '@aglyn/aglyn'
import type { IBesignerAppController } from './besigner-app.types'
import type { HostThemeScheme } from '@aglyn/shared-data-types'
// eslint-disable-next-line @nx/enforce-module-boundaries
import type { LogLevelString } from '@aglyn/shared-util-logger'
import type { BehaviorSubject } from 'rxjs'
import type {
  BesignerDeviceFlag,
  BesignerPanelTabFlag,
  BesignerPanelViewFlag,
  InteractionModeFlag,
} from '../constants/besigner'
import type {
  BesignerSetFlagPayload,
  BesignerSetFlagsPayload,
  BesignerSetPanelPayload,
  BesignerSetPanelsPayload,
} from './emitter.types'

export type BesignerContext = {
  flags: {
    debug: boolean
    logLevel: LogLevelString
    interactMode: InteractionModeFlag
    activeView?: BesignerPanelViewFlag
    devicePreview?: BesignerDeviceFlag
    /** Color scheme the canvas previews the host theme in; console UI is unaffected. */
    canvasScheme?: HostThemeScheme
    /** What kind of host view the canvas is editing (screen or shared layout). */
    viewType?: HostViewType
    /**
     * WYSIWYG bindings (AGL-97): when not false, the canvas resolves
     * variable/function binding tokens live; toggle off for raw tokens.
     */
    resolveBindings?: boolean
  }
  panels: {
    panelLeft?: BesignerPanelItem
    panelRight?: BesignerPanelItem
    panelBottom?: BesignerPanelItem
  }
}
export type BesignerFlagsState = BesignerContext['flags']
export type BesignerFlagKey = keyof BesignerFlagsState
export type BesignerFlagValue<K extends BesignerFlagKey = BesignerFlagKey> =
  BesignerFlagsState[K]
export type BesignerPanelsState = BesignerContext['panels']
export type BesignerPanelKey = keyof BesignerPanelsState
export type BesignerPanelValue<K extends BesignerPanelKey = BesignerPanelKey> =
  BesignerPanelsState[K]
export type BesignerPanelItem = {
  id?: BesignerPanelViewFlag
  size?: number | string
  toggled?: boolean
  tab?: BesignerPanelTabFlag
}

export interface BesignerInterfaceControllerOptions {
  logLevel?: LogLevelString
  defaults?: Partial<BesignerContext>
}

export interface IBesignerInterfaceController {
  readonly __store__: {
    [K in keyof BesignerContext]: BehaviorSubject<BesignerContext[K]>
  }
  readonly flags: this['__store__']['flags']
  readonly panels: this['__store__']['panels']

  setFlag(payload: BesignerSetFlagPayload): this
  setFlags(payload: BesignerSetFlagsPayload): this
  setPanel(payload: BesignerSetPanelPayload): this
  setPanels(payload: BesignerSetPanelsPayload): this
}

export interface BesignerInterfaceControllerT {
  new (
    app: IBesignerAppController,
    options: BesignerInterfaceControllerOptions,
  ): IBesignerInterfaceController
}
