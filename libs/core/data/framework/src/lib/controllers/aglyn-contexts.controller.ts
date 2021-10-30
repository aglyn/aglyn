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

import { Dictionary, KeyValueMap } from '@aglyn/shared-data-types'
import { _hasProperty, _isArr, _isArrEmpty, _isObj } from '@aglyn/shared-util-guards'
import { arrayAddAtIndex, getProperty } from '@aglyn/shared-util-tools'
import {
  createApi,
  createDomain as createEffectorDomain,
  createEffect as createEffectorEffect,
  createEvent as createEffectorEvent,
  Domain as EffectorDomain,
  Event as EffectorEvent,
  Store as EffectorStore,
} from 'effector'
import {
  AglynAppEffectFlag,
  ContextsCreateEffectPayload,
  ContextsCreateEventPayload,
  ContextsCreateStorePayload,
  ContextsDeleteStorePayload,
  ContextsGetStoreApiPayload,
  ContextsGetStorePayload,
  ContextsSetStorePayload,
} from '../constants/emitter'
import {
  AglynModuleEffectListener,
  AglynModuleModel,
  AglynModuleModelOptions,
} from '../models/aglyn-module.model'
import { ContextStoreUid, ElementId } from '../types'
import denormalizeComponentElementData from '../util/denormalize-component-element-data'
import { normalizeComponentElementData } from '../util/normalize-component-element-data'
import {
  AglynComponentElementData,
  AglynComponentElementDataNormalizedMap,
} from './aglyn-components.controller'


export interface ContextDomain extends EffectorDomain {

}

export interface ContextStore<T> extends EffectorStore<T> {

}

export type ContextEvent = ReturnType<typeof createEffectorEvent>
export type ContextEffect = ReturnType<typeof createEffectorEffect>

export type ContextStoreOptions<T> = {
  name?: string
  sid?: string
  updateFilter?: (update: T, current: T) => boolean
  serialize?: 'ignore'
}

export type ElementsDataStore = {
  past: AglynComponentElementDataNormalizedMap[]
  present: AglynComponentElementDataNormalizedMap
  future: AglynComponentElementDataNormalizedMap[]
}

export interface ElementsDataStoreApi {
  addElement: EffectorEvent<AddElementPayload>
  updateElements: EffectorEvent<UpdateElementsPayload>
  undo: EffectorEvent<any>
  redo: EffectorEvent<any>
}

export type AddElementPayload = {
  parentId: ElementId,
  position: number,
  element: AglynComponentElementData
}
export type UpdateElementsPayload = AglynComponentElementDataNormalizedMap

export interface AglynContextsController extends AglynModuleModel<AglynContextsControllerOptions> {
  getStore<T>(payload: ContextsGetStorePayload): ContextStore<T>
  getStoreApi<T, K extends keyof T = keyof T>(payload: ContextsGetStoreApiPayload): T
  setStore<T>(payload: ContextsSetStorePayload<T>): this
  createStore<T>(payload: ContextsCreateStorePayload<T>): ContextStore<T>
  deleteStore(payload: ContextsDeleteStorePayload): this
  createEvent(payload?: ContextsCreateEventPayload): ContextEvent
  createEffect(payload?: ContextsCreateEffectPayload): ContextEffect
}

export interface AglynContextsControllerOptions extends AglynModuleModelOptions {
  defaultStores: KeyValueMap<ContextStoreUid, { defaultState: any, options?: ContextStoreOptions<any> }>
  defaultElements: AglynComponentElementData[]
}

const TAG = 'AglynContexts'
const MODULE_NAME = 'contexts'

export class AglynContextsController extends AglynModuleModel<AglynContextsControllerOptions> {

  public static readonly [Symbol.toStringTag]: string = TAG
  public static readonly moduleName: string = MODULE_NAME
  public static readonly childNs: string = MODULE_NAME

  #domain: ContextDomain = null
  #stores: Map<ContextStoreUid, ContextStore<any>> = new Map()

  constructor(options) {
    super(options)
    this.#setup()
  }
  #setup() {
    this.#domain = createEffectorDomain(this.app.getName())
    this.#setupInternalStores()
    this.#setupDefaultStores()
  }
  #setupInternalStores(): void {
    const normalizedElementsStore = this.createStore({
        defaultState: {
          past: [] as AglynComponentElementDataNormalizedMap[],
          present: normalizeComponentElementData(this.options.defaultElements || [], '__root__'),
          future: [] as AglynComponentElementDataNormalizedMap[],
        } as ElementsDataStore,
        options: {sid: 'elements'},
      },
    )

    const elementHelpers = createApi(normalizedElementsStore, {
      undo: (state, _) => {
        const past = state.past
        const present = state.present
        const future = state.future

        if (_isArr(past) && !_isArrEmpty(past)) {
          future.unshift(present)
          return {
            past: past,
            present: past.shift(),
            future: future,
          }
        }
      },
      redo: (state, _) => {
        const past = state.past
        const present = state.present
        const future = state.future

        if (_isArr(future) && !_isArrEmpty(future)) {
          past.push(present)
          return {
            past: past,
            present: future.shift(),
            future: future,
          }
        }
      },
      addElement: (state, payload: AddElementPayload) => {
        state.past.push(state.present)

        const {element, parentId, position} = payload
        const newData = normalizeComponentElementData(element, parentId)
        const present = {
          ...state.present,
          ...newData,
          [parentId]: {
            ...state.present[parentId],
            elements: arrayAddAtIndex(
              position,
              state.present[parentId].elements || [],
              newData[parentId]?.elements || [],
              {copy: true},
            ).items,
          },
        }

        return {past: state.past, present, future: []}
      },
      // updateElement: (state, _) => {
      //
      // },
      updateElements: (state, payload: AglynComponentElementDataNormalizedMap) => {
        state.past.push(state.present)
        return {past: state.past, present: payload, future: []}
      },
    })

    const denormalizedElementsStore = normalizedElementsStore.map((elements) => {
      return denormalizeComponentElementData(elements.present, '__root__')
    })

    this.setStore({store: normalizedElementsStore, storeId: 'elements'})
    this.setStore({store: elementHelpers, storeId: 'elements:api'})
    this.setStore({store: denormalizedElementsStore, storeId: 'elements:denormalized'})
  }
  #setupDefaultStores(): void {
    const defaultStores = this.options.defaultStores
    if (defaultStores && _isObj(defaultStores)) {
      for (const storeId in defaultStores) {
        if (_hasProperty(storeId, defaultStores)) {
          const {options, defaultState} = getProperty(defaultStores, storeId) || {}
          const store = this.createStore({defaultState, options})
          this.setStore({storeId, store})
        }
      }
    }
  }

  public toJSON() {
    return {
      ...super.toJSON(),
      ...this.#stores,
    }
  }

  public createEvent = (payload?: ContextsCreateEventPayload): ContextEvent => {
    const {options} = {...payload}
    return this.#domain.createEvent(...(options ?? [] as any))
  }
  public createEffect = (payload?: ContextsCreateEffectPayload): ContextEffect => {
    const {options} = {...payload}
    return this.#domain.createEffect(...(options ?? [] as any))
  }
  public createStore = <T>(payload: ContextsCreateStorePayload<T>): ContextStore<T> => {
    const {options, defaultState} = {...payload}
    return this.#domain.createStore(defaultState, options)
  }
  public getStore = <T>(payload: ContextsGetStorePayload): ContextStore<T> => {
    const {storeId} = {...payload}
    return this.#stores.get(storeId)
  }
  public getStoreApi = <T, K extends keyof T = keyof T>(payload: ContextsGetStoreApiPayload): T => {
    const {storeId} = {...payload}
    return this.#stores.get(storeId) as unknown as T
  }
  public setStore = <T>(payload: ContextsSetStorePayload<T>): this => {
    const {storeId, store} = {...payload}
    if (storeId && store) {
      this.#stores.set(storeId, store)
    }
    else {
      // TODO: throw errorFactory error
    }
    return this
  }
  public deleteStore = (payload: ContextsDeleteStorePayload): this => {
    const {storeId} = {...payload}
    this.#stores.delete(storeId)
    return this
  }

  protected listeners: AglynModuleEffectListener<any>[] = [
    [AglynAppEffectFlag.CONTEXTS_CREATE_STORE, this.createStore],
    [AglynAppEffectFlag.CONTEXTS_CREATE_EVENT, this.createEvent],
    [AglynAppEffectFlag.CONTEXTS_CREATE_EFFECT, this.createEffect],
    [AglynAppEffectFlag.CONTEXTS_GET_STORE, this.getStore],
    [AglynAppEffectFlag.CONTEXTS_SET_STORE, this.setStore],
    [AglynAppEffectFlag.CONTEXTS_DELETE_STORE, this.deleteStore],
  ]
}

export type AglynContextsControllerT = typeof AglynContextsController
export default AglynContextsController
