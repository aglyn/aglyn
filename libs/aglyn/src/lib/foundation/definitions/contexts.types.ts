/**
 * @license
 * Copyright 2023 Aglyn LLC
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
  Domain as EffectorDomain,
  Effect as EffectorEffect,
  Event as EffectorEvent,
  Store as EffectorStore,
} from 'effector'
import type {
  ContextsCreateEffectPayload,
  ContextsCreateEventPayload,
  ContextsCreateStorePayload,
  ContextsDeleteStorePayload,
  ContextsGetStoreApiPayload,
  ContextsGetStorePayload,
  ContextsSetStorePayload,
} from '../constants/emitter'
import type { IAglynAppController } from './app.types'
import type {
  AglynModuleModelOptions,
  AglynModuleModelT,
  IAglynModuleModel,
} from './module.types'

export type ContextStoreUid = string
export type ContextDomain = EffectorDomain
export type ContextStore<State> = EffectorStore<State>
export type ContextEvent<Payload = any> = EffectorEvent<Payload>
export type ContextEffect<
  Params = any,
  Done = any,
  Fail = Error,
> = EffectorEffect<Params, Done, Fail>
export type ContextStoreOptions<T> = {
  name?: string
  sid?: string
  updateFilter?: (update: T, current: T) => boolean
  serialize?: 'ignore'
}

export interface AglynContextsControllerOptions
  extends AglynModuleModelOptions {
  defaultStores: KeyValueMap<
    ContextStoreUid,
    { defaultState: any; options?: ContextStoreOptions<any> }
  >
}

export interface IAglynContextsController
  extends IAglynModuleModel<AglynContextsControllerOptions> {
  readonly domain: ContextDomain

  getStore<T>(payload: ContextsGetStorePayload): ContextStore<T>
  getStoreApi<T, K extends keyof T = keyof T>(
    payload: ContextsGetStoreApiPayload,
  ): T
  setStore<T>(payload: ContextsSetStorePayload<T>): this
  createStore<T>(payload: ContextsCreateStorePayload<T>): ContextStore<T>
  deleteStore(payload: ContextsDeleteStorePayload): this
  createEvent(payload?: ContextsCreateEventPayload): ContextEvent
  createEffect(payload?: ContextsCreateEffectPayload): ContextEffect
}

export interface AglynContextsControllerT
  extends AglynModuleModelT<AglynContextsControllerOptions> {
  new (
    app: IAglynAppController,
    options: AglynContextsControllerOptions,
  ): IAglynContextsController
}
