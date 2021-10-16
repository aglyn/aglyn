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

import { OrUndef } from '@aglyn/shared-data-types'
import { _componentsControllers } from '../constants/_internal'
import {
  GetBundlePayload,
  GetComponentPayload,
  GetComponentSchemaPayload,
  RegisterBundlePayload,
  RegisterComponentPayload,
  UnregisterBundlePayload,
  UnregisterComponentPayload,
} from '../constants/emitter'
import { AglynAppController } from '../controllers/aglyn-app.controller'
import type {
  AglynComponentElementTemplateData,
  AglynComponentsController,
  ComponentsRegistryEntry,
  ComponentsRegistryKeys,
  ComponentsRegistryValues,
  IAglynComponentElement,
  IAglynComponentsBundle,
  IAglynComponentSchema,
} from '../controllers/aglyn-components.controller'
import { validateAppArg } from './app.api'


export function _getComponentsController(app: AglynAppController): AglynComponentsController {
  validateAppArg(app)
  return _componentsControllers.get(app.getName())
}


export function getAllComponents(app: AglynAppController): ComponentsRegistryEntry[] {
  return _getComponentsController(app)?.getAllComponents()
}

export function getAllComponentsValues(app: AglynAppController): ComponentsRegistryValues {
  return _getComponentsController(app)?.getAllComponentsValues()
}

export function getAllComponentsKeys(app: AglynAppController): ComponentsRegistryKeys {
  return _getComponentsController(app)?.getAllComponentsKeys()
}

export function getTemplateBlocks(app: AglynAppController): AglynComponentElementTemplateData[] {
  return _getComponentsController(app)?.getTemplateBlocks()
}

export function getComponent<P>(
  app: AglynAppController,
  payload: GetComponentPayload,
): OrUndef<IAglynComponentElement<P>> {
  return _getComponentsController(app)?.getComponent(payload)
}

export function getComponentSchema(
  app: AglynAppController,
  payload: GetComponentSchemaPayload,
): OrUndef<IAglynComponentSchema> {
  return _getComponentsController(app)?.getComponentSchema(payload)
}

export function getBundle(
  app: AglynAppController,
  payload: GetBundlePayload,
): OrUndef<IAglynComponentsBundle> {
  return _getComponentsController(app)?.getBundle(payload)
}

export function registerComponent(app: AglynAppController, payload: RegisterComponentPayload): void {
  _getComponentsController(app)?.registerComponent(payload)
}

export function registerBundle(app: AglynAppController, payload: RegisterBundlePayload): void {
  _getComponentsController(app)?.registerBundle(payload)
}

export function unregisterComponent(app: AglynAppController, payload: UnregisterComponentPayload): void {
  _getComponentsController(app)?.unregisterComponent(payload)
}

export function unregisterBundle(app: AglynAppController, payload: UnregisterBundlePayload): void {
  _getComponentsController(app)?.unregisterBundle(payload)
}
