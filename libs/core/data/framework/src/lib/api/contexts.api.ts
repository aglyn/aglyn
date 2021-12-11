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

import { _INTERNAL_CONTEXTS_ } from '../constants/_internal'
import {
  ContextsCreateEffectPayload,
  ContextsCreateEventPayload,
  ContextsCreateStorePayload,
  ContextsGetStoreApiPayload,
  ContextsGetStorePayload,
  ContextsSetStorePayload,
} from '../constants/emitter'
import { AglynAppController } from '../controllers/aglyn-app.controller'
import type { AglynContextsController } from '../controllers/aglyn-contexts.controller'
import { ContextEffect, ContextEvent, ContextStore } from '../controllers/aglyn-contexts.controller'
import { _validateAppArg } from './app.api'


export function _getContextsController(app: AglynAppController): AglynContextsController {
  _validateAppArg(app)
  return _INTERNAL_CONTEXTS_.get(app.getName())
}


export function createContextStore<T>(
  app: AglynAppController,
  payload: ContextsCreateStorePayload<T>,
): ContextStore<T> {
  const contextsController = _getContextsController(app)
  return contextsController.createStore(payload)
}

export function createContextEvent(
  app: AglynAppController,
  payload?: ContextsCreateEventPayload,
): ContextEvent {
  const contextsController = _getContextsController(app)
  return contextsController.createEvent(payload)
}

export function createContextEffect(
  app: AglynAppController,
  payload: ContextsCreateEffectPayload,
): ContextEffect {
  const contextsController = _getContextsController(app)
  return contextsController.createEffect(payload)
}

export function setContextStore<T>(
  app: AglynAppController,
  payload: ContextsSetStorePayload<T>,
): AglynContextsController {
  const contextsController = _getContextsController(app)
  return contextsController.setStore(payload)
}

export function getContextStore<T>(
  app: AglynAppController,
  payload: ContextsGetStorePayload,
): ContextStore<T> {
  const contextsController = _getContextsController(app)
  return contextsController.getStore(payload)
}

export function getContextStoreApi<T, K extends keyof T = keyof T>(
  app: AglynAppController,
  payload: ContextsGetStoreApiPayload,
): T {
  const contextsController = _getContextsController(app)
  return contextsController.getStoreApi(payload)
}

export function deleteContextStore(
  app: AglynAppController,
  payload: ContextsGetStorePayload,
): AglynContextsController {
  const contextsController = _getContextsController(app)
  return contextsController.deleteStore(payload)
}
