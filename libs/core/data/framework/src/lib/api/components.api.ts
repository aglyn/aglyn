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

import { AnyProps, OrUndef } from '@aglyn/shared-data-types'
import { _INTERNAL_COMPONENTS_ } from '../constants/_internal'
import {
  ComponentGetPayload,
  ComponentRegisterPayload,
  ComponentsBundleGetPayload,
  ComponentsBundleRegisterPayload,
  ComponentsBundleUnregisterPayload,
  ComponentSchemaGetPayload,
  ComponentUnregisterPayload,
} from '../constants/emitter'
import { AglynAppController } from '../controllers/aglyn-app.controller'
import type {
  IAglynComponent,
  AglynComponentElementTemplateData,
  AglynComponentsBundle,
  AglynComponentSchema,
  AglynComponentsController,
  ComponentsRegistryEntry,
  ComponentsRegistryKeys,
  ComponentsRegistryValues,
} from '../controllers/aglyn-components.controller'
import { _validateAppArg } from './app.api'


export function _getComponentsController(app: AglynAppController): AglynComponentsController {
  _validateAppArg(app)
  return _INTERNAL_COMPONENTS_.get(app.getName())
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

export function getAllComponentsTemplateValues(
  app: AglynAppController,
): AglynComponentElementTemplateData[] {
  return _getComponentsController(app)?.getAllComponentsTemplateValues()
}

export function getComponent<P extends AnyProps>(
  app: AglynAppController,
  payload: ComponentGetPayload,
): OrUndef<IAglynComponent<P>> {
  return _getComponentsController(app)?.getComponent(payload)
}

export function getComponentSchema(
  app: AglynAppController,
  payload: ComponentSchemaGetPayload,
): OrUndef<AglynComponentSchema> {
  return _getComponentsController(app)?.getComponentSchema(payload)
}

export function getBundle(
  app: AglynAppController,
  payload: ComponentsBundleGetPayload,
): OrUndef<AglynComponentsBundle> {
  return _getComponentsController(app)?.getBundle(payload)
}

export function registerComponent(
  app: AglynAppController,
  payload: ComponentRegisterPayload,
): void {
  _getComponentsController(app)?.registerComponent(payload)
}

export function registerBundle(
  app: AglynAppController,
  payload: ComponentsBundleRegisterPayload,
): void {
  _getComponentsController(app)?.registerBundle(payload)
}

export function unregisterComponent(
  app: AglynAppController,
  payload: ComponentUnregisterPayload,
): void {
  _getComponentsController(app)?.unregisterComponent(payload)
}

export function unregisterBundle(
  app: AglynAppController,
  payload: ComponentsBundleUnregisterPayload,
): void {
  _getComponentsController(app)?.unregisterBundle(payload)
}
