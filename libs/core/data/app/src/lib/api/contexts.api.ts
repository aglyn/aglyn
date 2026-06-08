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

import {
  _INTERNAL_CONTEXTS_,
  type ContextEffect,
  type ContextEvent,
  type ContextsCreateEffectPayload,
  type ContextsCreateEventPayload,
  type ContextsCreateStorePayload,
  type ContextsGetStoreApiPayload,
  type ContextsGetStorePayload,
  type ContextsSetStorePayload,
  type ContextStore,
  type IAglynAppController,
  type IAglynContextsController,
} from '@aglyn/core-data-foundation'
import { _validateAppArg } from './app.api'

export function _getContextsController(
  app: IAglynAppController,
): IAglynContextsController {
  _validateAppArg(app)
  return _INTERNAL_CONTEXTS_.get(app.getName())
}

export function createContextStore<T>(
  app: IAglynAppController,
  payload: ContextsCreateStorePayload<T>,
): ContextStore<T> {
  const contextsController = _getContextsController(app)
  return contextsController.createStore(payload)
}

export function createContextEvent(
  app: IAglynAppController,
  payload?: ContextsCreateEventPayload,
): ContextEvent {
  const contextsController = _getContextsController(app)
  return contextsController.createEvent(payload)
}

export function createContextEffect(
  app: IAglynAppController,
  payload: ContextsCreateEffectPayload,
): ContextEffect {
  const contextsController = _getContextsController(app)
  return contextsController.createEffect(payload)
}

export function setContextStore<T>(
  app: IAglynAppController,
  payload: ContextsSetStorePayload<T>,
): IAglynContextsController {
  const contextsController = _getContextsController(app)
  return contextsController.setStore(payload)
}

export function getContextStore<T>(
  app: IAglynAppController,
  payload: ContextsGetStorePayload,
): ContextStore<T> {
  const contextsController = _getContextsController(app)
  return contextsController.getStore(payload)
}

export function getContextStoreApi<T, K extends keyof T = keyof T>(
  app: IAglynAppController,
  payload: ContextsGetStoreApiPayload,
): T {
  const contextsController = _getContextsController(app)
  return contextsController.getStoreApi(payload)
}

export function deleteContextStore(
  app: IAglynAppController,
  payload: ContextsGetStorePayload,
): IAglynContextsController {
  const contextsController = _getContextsController(app)
  return contextsController.deleteStore(payload)
}
