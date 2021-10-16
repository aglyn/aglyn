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

export * from './api'

export * from './constants/emitter'
export * from './constants/enums'
export * from './constants/error'
export * from './constants/logger'
export * from './constants/platform'
export * from './constants/symbol'
export * from './constants/version'

export * from './util/aglyn-is'
export * from './util/create-components-bundle'
export * from './util/create-element-component'

export * from './types'

export * from './models/aglyn-base.model'
export {
  AglynExtensionOptions,
  AglynExtensionT,
  AglynExtension,
} from './models/aglyn-extension.model'

export type {
  AglynAppOptions,
  AglynEffectOptions,
  AglynAppController,
} from './controllers/aglyn-app.controller'
export type {
  AglynExtensionTypeFields,
  AglynExtensionLoader,
  AglynExtensionController,
} from './controllers/aglyn-extension.controller'

export type {
  AglynCommandTypeFields,
  AglynCommandController,
  AglynCommandHandler,
} from './controllers/aglyn-command.controller'
export type {
  IAglynComponentsBundle,
  IAglynComponentSchema,
  BundleId,
  ComponentId,
  AglynComponentsTypeFields,
  IAglynComponentElement,
  AglynComponentElementTemplateData,
  ComponentsRegistryEntry,
  ComponentsRegistryKeys,
  ComponentsRegistryValues,
  AglynComponentClassElement,
  AglynComponentElementData,
  AglynComponentElementType,
  AglynComponentFunctionElement,
  AglynComponentIntrinsicElement,
  HierarchyRestriction,
  TemplateSubElementData,
  AglynComponentsController,
} from './controllers/aglyn-components.controller'
