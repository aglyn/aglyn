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

import type {OrUndef} from '@aglyn/shared-data-types'
import {_INTERNAL_COMPONENTS_} from '../constants/_internal'
import type {
  ComponentGetPayload,
  ComponentRegisterPayload,
  ComponentsBundleGetPayload,
  ComponentsBundleRegisterPayload,
  ComponentsBundleUnregisterPayload,
  ComponentSchemaGetPayload,
  ComponentUnregisterPayload,
} from '../constants/emitter'
import type {IAglynAppController} from '../controllers/aglyn-app.types'
import type {
  AglynComponentElementTemplate,
  AglynComponentsBundle,
  AglynComponentSchema,
  ComponentsRegistryEntry,
  ComponentsRegistryKeys,
  ComponentsRegistryValues,
  IAglynComponent,
  IAglynComponentsController,
} from '../controllers/aglyn-components.types'
import {_validateAppArg} from './app.api'


export function _getComponentsController(app: IAglynAppController): IAglynComponentsController {
  _validateAppArg(app)
  return _INTERNAL_COMPONENTS_.get(app.getName())
}


export function getAllComponents(app: IAglynAppController): ComponentsRegistryEntry[] {
  return _getComponentsController(app)?.getAllComponents()
}

export function getAllComponentsValues(app: IAglynAppController): ComponentsRegistryValues {
  return _getComponentsController(app)?.getAllComponentsValues()
}

export function getAllComponentsKeys(app: IAglynAppController): ComponentsRegistryKeys {
  return _getComponentsController(app)?.getAllComponentsKeys()
}

export function getAllComponentsTemplateValues(
  app: IAglynAppController,
): AglynComponentElementTemplate[] {
  return _getComponentsController(app)?.getAllComponentsTemplateValues()
}

export function getComponent(
  app: IAglynAppController,
  payload: ComponentGetPayload,
): OrUndef<IAglynComponent> {
  return _getComponentsController(app)?.getComponent(payload)
}

export function getComponentSchema(
  app: IAglynAppController,
  payload: ComponentSchemaGetPayload,
): OrUndef<AglynComponentSchema> {
  return _getComponentsController(app)?.getComponentSchema(payload)
}

export function getBundle(
  app: IAglynAppController,
  payload: ComponentsBundleGetPayload,
): OrUndef<AglynComponentsBundle> {
  return _getComponentsController(app)?.getBundle(payload)
}

export function registerComponent(
  app: IAglynAppController,
  payload: ComponentRegisterPayload,
): void {
  _getComponentsController(app)?.registerComponent(payload)
}

export function registerBundle(
  app: IAglynAppController,
  payload: ComponentsBundleRegisterPayload,
): void {
  _getComponentsController(app)?.registerBundle(payload)
}

export function unregisterComponent(
  app: IAglynAppController,
  payload: ComponentUnregisterPayload,
): void {
  _getComponentsController(app)?.unregisterComponent(payload)
}

export function unregisterBundle(
  app: IAglynAppController,
  payload: ComponentsBundleUnregisterPayload,
): void {
  _getComponentsController(app)?.unregisterBundle(payload)
}
