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

import {type KeyValueMap} from '@aglyn/shared-data-types'
import {
  type Domain as EffectorDomain,
  type Effect as EffectorEffect,
  type Event as EffectorEvent,
  type Store as EffectorStore,
} from 'effector'
import {
  type ContextsCreateEffectPayload,
  type ContextsCreateEventPayload,
  type ContextsCreateStorePayload,
  type ContextsDeleteStorePayload,
  type ContextsGetStoreApiPayload,
  type ContextsGetStorePayload,
  type ContextsSetStorePayload,
} from '../constants/emitter'
import {
  type AglynModuleModelOptions,
  type AglynModuleModelT,
  type IAglynModuleModel,
} from './aglyn-module.types'
import {type IAglynAppController} from './aglyn-app.types'


export type ContextStoreUid = string
export type ContextDomain = EffectorDomain
export type ContextStore<State> = EffectorStore<State>
export type ContextEvent<Payload = any> = EffectorEvent<Payload>
export type ContextEffect<Params = any, Done = any, Fail = Error> = EffectorEffect<Params, Done, Fail>
export type ContextStoreOptions<T> = {
  name?: string
  sid?: string
  updateFilter?: (update: T, current: T) => boolean
  serialize?: 'ignore'
}

export interface AglynContextsControllerOptions extends AglynModuleModelOptions {
  defaultStores: KeyValueMap<ContextStoreUid, {defaultState: any, options?: ContextStoreOptions<any>}>
}

export interface IAglynContextsController extends IAglynModuleModel<AglynContextsControllerOptions> {
  readonly domain: ContextDomain

  getStore<T>(payload: ContextsGetStorePayload): ContextStore<T>
  getStoreApi<T, K extends keyof T = keyof T>(payload: ContextsGetStoreApiPayload): T
  setStore<T>(payload: ContextsSetStorePayload<T>): this
  createStore<T>(payload: ContextsCreateStorePayload<T>): ContextStore<T>
  deleteStore(payload: ContextsDeleteStorePayload): this
  createEvent(payload?: ContextsCreateEventPayload): ContextEvent
  createEffect(payload?: ContextsCreateEffectPayload): ContextEffect
}

export interface AglynContextsControllerT extends AglynModuleModelT<AglynContextsControllerOptions> {
  new(app: IAglynAppController, options: AglynContextsControllerOptions): IAglynContextsController
}
