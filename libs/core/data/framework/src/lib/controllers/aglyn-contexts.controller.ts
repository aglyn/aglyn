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

import {_hasProperty, _isObj} from '@aglyn/shared-util-guards'
import {getProperty} from '@aglyn/shared-util-tools'
import {createDomain as createEffectorDomain} from 'effector'
import type {
  ContextsCreateEffectPayload,
  ContextsCreateEventPayload,
  ContextsCreateStorePayload,
  ContextsDeleteStorePayload,
  ContextsGetStoreApiPayload,
  ContextsGetStorePayload,
  ContextsSetStorePayload,
} from '../constants/emitter'
import {AglynAppEffectFlag} from '../constants/emitter'
import AglynModuleModel from '../models/aglyn-module.model'
import type {AglynModuleEffectListener} from '../models/aglyn-module.types'
import type {ContextStoreUid} from '../types'
import type {IAglynAppController} from './aglyn-app.types'
import type {
  AglynContextsControllerOptions,
  ContextDomain,
  ContextEffect,
  ContextEvent,
  ContextStore,
  IAglynContextsController,
} from './aglyn-contexts.types'


const TAG = 'AglynContexts'
const MODULE_NAME = 'contexts'

export class AglynContextsController extends AglynModuleModel<AglynContextsControllerOptions> implements IAglynContextsController {

  public static readonly [Symbol.toStringTag]: string = TAG
  public static readonly namespace: string = `aglyn:${MODULE_NAME}`
  public static readonly moduleName: string = MODULE_NAME

  #domain: ContextDomain = null
  #stores: Map<ContextStoreUid, ContextStore<any>> = new Map()

  public get domain(): ContextDomain {
    return this.#domain
  }

  constructor(app: IAglynAppController, options: AglynContextsControllerOptions) {
    super(app, options)
    this.#setup()
  }
  #setup() {
    this.#domain = createEffectorDomain(this.app.getName())
    this.#setupDefaultStores()
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

  public createEvent(payload?: ContextsCreateEventPayload): ContextEvent {
    const {options} = {...payload}
    return this.#domain.createEvent(...(options ?? [] as any))
  }
  public createEffect(payload?: ContextsCreateEffectPayload): ContextEffect {
    const {options} = {...payload}
    return this.#domain.createEffect(...(options ?? [] as any))
  }
  public createStore<T>(payload: ContextsCreateStorePayload<T>): ContextStore<T> {
    const {options, defaultState} = {...payload}
    return this.#domain.createStore(defaultState, options)
  }
  public getStore<T>(payload: ContextsGetStorePayload): ContextStore<T> {
    const {storeId} = {...payload}
    return this.#stores.get(storeId)
  }
  public getStoreApi<T, K extends keyof T = keyof T>(payload: ContextsGetStoreApiPayload): T {
    const {storeId} = {...payload}
    return this.#stores.get(storeId) as unknown as T
  }
  public setStore<T>(payload: ContextsSetStorePayload<T>): this {
    const {storeId, store} = {...payload}
    if (storeId && store) {
      this.#stores.set(storeId, store)
    }
    else {
      // TODO: throw errorFactory error
    }
    return this
  }
  public deleteStore(payload: ContextsDeleteStorePayload): this {
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

export default AglynContextsController
