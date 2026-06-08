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
  AglynContextsControllerOptions,
  AglynModuleEffectListener,
  ContextDomain,
  ContextEffect,
  ContextEvent,
  ContextStore,
  ContextStoreUid,
  IAglynAppController,
  IAglynContextsController,
} from '@aglyn/core-data-foundation'
import {
  AglynEventTriggerFlag,
  type ContextsCreateEffectPayload,
  type ContextsCreateEventPayload,
  type ContextsCreateStorePayload,
  type ContextsDeleteStorePayload,
  type ContextsGetStoreApiPayload,
  type ContextsGetStorePayload,
  type ContextsSetStorePayload,
} from '@aglyn/core-data-foundation'
import { _hasOwnProperty, _isObj } from '@aglyn/shared-util-tools'
import { getProperty } from '@aglyn/shared-util-tools'
import { createDomain as createEffectorDomain } from 'effector'
import { AglynModuleModel } from '../models/aglyn-module.model'

const TAG = 'AglynContexts'
const NS = 'com.aglyn.core.data.controller.contexts'

export class AglynContextsController
  extends AglynModuleModel<AglynContextsControllerOptions>
  implements IAglynContextsController
{
  public static get [Symbol.toStringTag](): string {
    return TAG
  }
  public static get namespace(): string {
    return NS
  }

  #domain: ContextDomain = null
  #stores: Map<ContextStoreUid, ContextStore<any>> = new Map()

  public get domain(): ContextDomain {
    return this.#domain
  }

  protected get listeners(): AglynModuleEffectListener<any>[] {
    return [
      [AglynEventTriggerFlag.CONTEXTS_CREATE_STORE, this.createStore],
      [AglynEventTriggerFlag.CONTEXTS_CREATE_EVENT, this.createEvent],
      [AglynEventTriggerFlag.CONTEXTS_CREATE_EFFECT, this.createEffect],
      [AglynEventTriggerFlag.CONTEXTS_GET_STORE, this.getStore],
      [AglynEventTriggerFlag.CONTEXTS_SET_STORE, this.setStore],
      [AglynEventTriggerFlag.CONTEXTS_DELETE_STORE, this.deleteStore],
    ]
  }

  constructor(
    app: IAglynAppController,
    options: AglynContextsControllerOptions,
  ) {
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
        if (_hasOwnProperty(storeId, defaultStores)) {
          const { options, defaultState } =
            getProperty(defaultStores, storeId) || {}
          const store = this.createStore({ defaultState, options })
          this.setStore({ storeId, store })
        }
      }
    }
  }

  public toJSON() {
    return {
      ...super.toJSON(),
      contexts: this.#stores.entries() as any,
    }
  }

  public createEvent(payload?: ContextsCreateEventPayload): ContextEvent {
    const { options } = { ...payload }
    return this.#domain.createEvent(...(options ?? ([] as any)))
  }
  public createEffect(payload?: ContextsCreateEffectPayload): ContextEffect {
    const { options } = { ...payload }
    return this.#domain.createEffect(...(options ?? ([] as any)))
  }
  public createStore<T>(
    payload: ContextsCreateStorePayload<T>,
  ): ContextStore<T> {
    const { options, defaultState } = { ...payload }
    return this.#domain.createStore(defaultState, options)
  }
  public getStore<T>(payload: ContextsGetStorePayload): ContextStore<T> {
    const { storeId } = { ...payload }
    return this.#stores.get(storeId)
  }
  public getStoreApi<T, K extends keyof T = keyof T>(
    payload: ContextsGetStoreApiPayload,
  ): T {
    const { storeId } = { ...payload }
    return this.#stores.get(storeId) as unknown as T
  }
  public setStore<T>(payload: ContextsSetStorePayload<T>): this {
    const { storeId, store } = { ...payload }
    if (storeId && store) {
      this.#stores.set(storeId, store)
    } else {
      // TODO: throw errorFactory error
      throw new Error(`Invalid storeId: ${storeId}`)
    }
    return this
  }
  public deleteStore(payload: ContextsDeleteStorePayload): this {
    const { storeId } = { ...payload }
    this.#stores.delete(storeId)
    return this
  }
}

export default AglynContextsController
