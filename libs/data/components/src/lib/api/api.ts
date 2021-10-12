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

import {
  _getExtensionController,
  AglynExtension,
  getExtension,
  IAglynApp,
  validateAppArg,
} from '@aglyn/data-framework'
import { OrUndef } from '@aglyn/shared-data-types'

import {
  AglynComponentElementTemplateData,
  ComponentsRegistryEntry,
  ComponentsRegistryKeys,
  ComponentsRegistryValues,
  GetBundlePayload,
  GetComponentPayload,
  GetComponentSchemaPayload,
  IAglynComponentElement,
  IAglynComponentsBundle,
  IAglynComponentSchema,
  IAglynComponentsExtension,
  RegisterBundlePayload,
  RegisterComponentPayload,
  UnregisterBundlePayload,
  UnregisterComponentPayload,
} from '../aglyn-components.types'


export function _getComponentsExtension(app: IAglynApp): IAglynComponentsExtension {
  validateAppArg(app)
  return getExtension<IAglynComponentsExtension>(app, {name: AglynExtension.COMPONENTS})
}

export function getAllComponents(app: IAglynApp): ComponentsRegistryEntry[] {
  return _getComponentsExtension(app)?.getAllComponents()
}

export function getAllComponentsValues(app: IAglynApp): ComponentsRegistryValues {
  return _getComponentsExtension(app)?.getAllComponentsValues()
}

export function getAllComponentsKeys(app: IAglynApp): ComponentsRegistryKeys {
  return _getComponentsExtension(app)?.getAllComponentsKeys()
}

export function getTemplateBlocks(app: IAglynApp): AglynComponentElementTemplateData[] {
  return _getComponentsExtension(app)?.getTemplateBlocks()
}

export function getComponent<P>(
  app: IAglynApp,
  payload: GetComponentPayload,
): OrUndef<IAglynComponentElement<P>> {
  return _getComponentsExtension(app)?.getComponent(payload)
}

export function getComponentSchema(
  app: IAglynApp,
  payload: GetComponentSchemaPayload,
): OrUndef<IAglynComponentSchema> {
  return _getComponentsExtension(app)?.getComponentSchema(payload)
}

export function getBundle(
  app: IAglynApp,
  payload: GetBundlePayload,
): OrUndef<IAglynComponentsBundle> {
  return _getComponentsExtension(app)?.getBundle(payload)
}

export function registerComponent(
  app: IAglynApp,
  payload: RegisterComponentPayload,
): void {
  console.log('register component', _getExtensionController(app))
  _getComponentsExtension(app)?.registerComponent(payload)
}

export function registerBundle(
  app: IAglynApp,
  payload: RegisterBundlePayload,
): void {
  _getComponentsExtension(app)?.registerBundle(payload)
}

export function unregisterComponent(
  app: IAglynApp,
  payload: UnregisterComponentPayload,
): void {
  _getComponentsExtension(app)?.unregisterComponent(payload)
}

export function unregisterBundle(
  app: IAglynApp,
  payload: UnregisterBundlePayload,
): void {
  _getComponentsExtension(app)?.unregisterBundle(payload)
}
