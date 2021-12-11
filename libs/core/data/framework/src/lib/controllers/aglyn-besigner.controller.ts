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

import type { LogLevelString } from '@aglyn/shared-util-logger'
import { copy } from '@aglyn/shared-util-tools'
import { objectDeepMerge } from '@aglyn/shared-util-vendor'
import { createApi } from 'effector'
import { persist } from 'effector-storage/local'
import {
  BesignerPanelTabFlag,
  BesignerPanelViewFlag,
  DndDragSourceTypeFlag,
  DndDropLinealTypeFlag,
  InteractionModeFlag,
} from '../constants/besigner'
import type {
  BesignerClosePanelPayload,
  BesignerFlagInteractModePayload,
  BesignerGetStorePayload,
  BesignerOpenPanelPayload,
  BesignerSetCanvasHoveredPayload,
  BesignerSetCanvasSelectedPayload,
  BesignerSetPanelPayload,
} from '../constants/emitter'
import type { AglynAppController } from '../controllers/aglyn-app.controller'
import type { ContextDomain } from '../controllers/aglyn-contexts.controller'
import type {
  AglynModuleEffectListener,
  AglynModuleModelOptions,
} from '../models/aglyn-module.model'
import { AglynModuleModel } from '../models/aglyn-module.model'
import type { BundleUId, ComponentId, ElementId, TemplateId } from '../types'
import type { ContextStore } from './aglyn-contexts.controller'


export interface CommActionData {
  $id?: ElementId
  // componentId?: ComponentId
  // bundleId?: BundleUId
  // position?: ClientRectObject
}

export interface BesignerFlagState {
  debug?: boolean
  logLevel?: LogLevelString
  interactMode?: InteractionModeFlag
  activeView?: BesignerPanelViewFlag
}

export interface BesignerCanvasSelectedElement extends CommActionData {
  hierarchy?: ElementId[]
}

export interface BesignerCanvasHoveredElement extends CommActionData {
  hierarchy?: ElementId[]
}

export interface BesignerCanvasState {
  selected?: BesignerCanvasSelectedElement
  hovered?: BesignerCanvasHoveredElement
}

export interface BesignerPanelItem {
  id?: BesignerPanelViewFlag
  size?: number | string
  toggled?: boolean
  tab?: BesignerPanelTabFlag
}

export interface BesignerPanelsState {
  panelLeft?: BesignerPanelItem
  panelRight?: BesignerPanelItem
  panelBottom?: BesignerPanelItem
}

export interface BesignerDndState {
  disallowed?: boolean
  dragging?: boolean
  dragActivity?: {
    type?: DndDragSourceTypeFlag
    $id?: ElementId | TemplateId
    componentId?: ComponentId
    bundleUId?: BundleUId
  }
  dropActivity?: {
    type?: DndDropLinealTypeFlag
    item?: {
      $id?: ElementId
      componentId?: ComponentId
      bundleUId?: BundleUId
    }
    parent?: {
      $id?: ElementId
      componentId?: ComponentId
      bundleUId?: BundleUId
    }
  }
}

export interface BesignerContextStores {
  flags: BesignerFlagState
  canvas: BesignerCanvasState
  panels: BesignerPanelsState
  dnd: BesignerDndState
}

type BesignerNestedStores<K extends keyof BesignerContextStores = keyof BesignerContextStores> = {
  [P in K]: ContextStore<BesignerContextStores[P]>
}

const DEFAULT_CONTEXT: Partial<BesignerContextStores> = {
  flags: {
    debug: true,
    logLevel: 'info',
    interactMode: InteractionModeFlag.SELECT,
  },
  panels: {
    panelLeft: {
      id: BesignerPanelViewFlag.PANEL_LEFT,
      size: 290,
      toggled: false,
    },
    panelRight: {
      id: BesignerPanelViewFlag.PANEL_RIGHT,
      size: 375,
      toggled: false,
    },
    panelBottom: {
      id: BesignerPanelViewFlag.PANEL_BOTTOM,
      toggled: false,
    },
  },
  canvas: {},
  dnd: {},
}


export interface AglynBesignerControllerOptions extends AglynModuleModelOptions {
  defaults?: Partial<BesignerContextStores>
}

interface BesignerContext {
  _domain: ContextDomain
  _store: ContextStore<BesignerContextStores>
  stores: BesignerNestedStores
  events: any
}

export interface AglynBesignerController extends AglynModuleModel<AglynBesignerControllerOptions> {
}

const TAG = 'AglynBesigner'
const MODULE_NAME = 'besigner'

export class AglynBesignerController extends AglynModuleModel<AglynBesignerControllerOptions> {

  public static readonly [Symbol.toStringTag]: string = TAG
  public static readonly namespace: string = `aglyn:${MODULE_NAME}`
  public static readonly moduleName: string = MODULE_NAME

  #context: BesignerContext = {
    _domain: null,
    _store: null,
    events: null,
    stores: null,
  }

  public get _domain(): ContextDomain {return this.#context._domain}
  public get _store(): ContextStore<BesignerContextStores> {return this.#context._store}
  public get stores(): BesignerNestedStores {return this.#context.stores}
  public get events(): any {return this.#context.events}

  public get flags(): ContextStore<BesignerFlagState> {return this.#context.stores.flags}
  public get canvas(): ContextStore<BesignerCanvasState> {return this.#context.stores.canvas}
  public get panels(): ContextStore<BesignerPanelsState> {return this.#context.stores.panels}
  public get dnd(): ContextStore<BesignerDndState> {return this.#context.stores.dnd}

  constructor(app: AglynAppController, options: AglynBesignerControllerOptions) {
    super(app, options)
    this.#setup()
  }
  #setup() {
    this.#context._domain = this.app.contexts.domain.domain(this.moduleName)

    console.log('objectDeepMerge(copy(DEFAULT_CONTEXT), {...this.options.defaults})', objectDeepMerge(copy(DEFAULT_CONTEXT), {...this.options.defaults}))

    this.#context._store = this.#context._domain.createStore<BesignerContextStores>(
      objectDeepMerge(copy(DEFAULT_CONTEXT), {...this.options.defaults}),
      {name: `${this.namespace}:store`}
    )
    persist({store: this.#context._store})

    this.#context.stores = {
      flags: this.#context._store.map((state) => state.flags),
      canvas: this.#context._store.map((state) => state.canvas),
      panels: this.#context._store.map((state) => state.panels),
      dnd: this.#context._store.map((state) => state.dnd),
    }

    this.#context.events = createApi(this.#context._store, {

      setFlag: (store, payload: BesignerFlagInteractModePayload) => {
        const {flag, value} = payload
        return {
          ...store,
          flags: {
            ...store.flags,
            [flag]: value,
          },
        }
      },

      setPanels: <K extends keyof BesignerSetPanelPayload>(store, payload: BesignerSetPanelPayload) => {
        const {panelLeft, panelBottom, panelRight} = payload
        return {
          ...store,
          panels: {
            ...store.panels,
            panelLeft: {
              ...store.panels.panelLeft,
              ...panelLeft,
            },
            panelBottom: {
              ...store.panels.panelBottom,
              ...panelBottom,
            },
            panelRight: {
              ...store.panels.panelRight,
              ...panelRight,
            },
          },
        }
      },

      openPanel: (store, payload: BesignerOpenPanelPayload) => {
        const {panel} = payload
        return {
          ...store,
          panels: {
            ...store.panels,
            [panel]: {
              ...store.panels[panel],
              toggled: true,
            },
          },
        }
      },

      closePanel: (store, payload: BesignerOpenPanelPayload) => {
        const {panel} = payload
        return {
          ...store,
          panels: {
            ...store.panels,
            [panel]: {
              ...store.panels[panel],
              toggled: false,
            },
          },
        }
      },

      setCanvasSelected: (store, payload: BesignerSetCanvasSelectedPayload) => {
        const {selected} = payload || {}
        return {
          ...store,
          canvas: {
            ...store.canvas,
            selected: selected,
          },
        }
      },

      setCanvasHovered: (store, payload: BesignerSetCanvasHoveredPayload) => {
        const {hovered} = payload || {}
        return {
          ...store,
          canvas: {
            ...store.canvas,
            hovered: hovered,
          },
        }
      },

    })
  }

  public toJSON() {
    return {
      ...super.toJSON(),
    }
  }


  public getStore<K extends keyof BesignerContextStores>(
    payload: BesignerGetStorePayload<K>,
  ): ContextStore<BesignerContextStores[K]> {
    const {store} = payload
    return this.#context.stores[store]
  }

  public setFlag(payload: BesignerFlagInteractModePayload) {
    return this.#context.events.setFlag(payload)
  }

  public setPanels(payload: BesignerSetPanelPayload) {
    return this.#context.events.setPanels(payload)
  }
  public openPanel(payload: BesignerOpenPanelPayload) {
    return this.#context.events.setPanels(payload)
  }
  public closePanel(payload: BesignerClosePanelPayload) {
    return this.#context.events.setPanels(payload)
  }
  public setCanvasSelected(payload: BesignerSetCanvasSelectedPayload) {
    return this.#context.events.setCanvasSelected(payload)
  }
  public setCanvasHovered(payload: BesignerSetCanvasHoveredPayload) {
    return this.#context.events.setCanvasHovered(payload)
  }


  protected listeners: AglynModuleEffectListener<any>[] = [
    // [AglynAppEffectFlag.COMMANDS_RESOLVER_SET, this.setResolver],
    // [AglynAppEffectFlag.COMMANDS_LISTENER_REGISTER, this.registerListener],
    // [AglynAppEffectFlag.COMMANDS_RESOLVER_REMOVE, this.removeResolver],
    // [AglynAppEffectFlag.COMMANDS_LISTENER_UNREGISTER, this.unregisterListener],
    // [AglynAppEffectFlag.COMMANDS_TRIGGER, this.trigger],
  ]
}

export type AglynBesignerControllerT = typeof AglynBesignerController
export default AglynBesignerController
