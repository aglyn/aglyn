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


export * from './types'

//     ___    ____  ____
//    /   |  / __ \/  _/
//   / /| | / /_/ // /
//  / ___ |/ _____/ /
// /_/  |_/_/   /___/
// 👇

export * from './api/app.api'
export * from './api/commands.api'
export * from './api/components.api'
export * from './api/contexts.api'
export * from './api/extensions.api'
export * from './api/logger.api'


//    __________  _   ________________    _   _____________
//   / ____/ __ \/ | / / ___/_  __/   |  / | / /_  __/ ___/
//  / /   / / / /  |/ /\__ \ / / / /| | /  |/ / / /  \__ \
// / /___/ /_/ / /|  /___/ // / / ___ |/ /|  / / /  ___/ /
// \____/\____/_/ |_//____//_/ /_/  |_/_/ |_/ /_/  /____/
// 👇

export * from './constants/emitter'
export * from './constants/enums'
export * from './constants/error'
export * from './constants/logger'
export * from './constants/platform'
export * from './constants/symbol'
export * from './constants/version'

// 👇 ENUMS
export { AglynCommandFlag } from './controllers/aglyn-commands.controller'
export { LinealDirectiveFlag } from './controllers/aglyn-components.controller'


//    __  ______________   _____
//   / / / /_  __/  _/ /  / ___/
//  / / / / / /  / // /   \__ \
// / /_/ / / / _/ // /______/ /
// \____/ /_/ /___/_____/____/
// 👇

export * from './util/aglyn-is'
export * from './util/create-aglyn-component-element'
export * from './util/create-component-element-data'
export * from './util/create-component-element-id'
export * from './util/create-components-bundle'


//     __  _______  ____  ________   _____
//    /  |/  / __ \/ __ \/ ____/ /  / ___/
//   / /|_/ / / / / / / / __/ / /   \__ \
//  / /  / / /_/ / /_/ / /___/ /______/ /
// /_/  /_/\____/_____/_____/_____/____/
// 👇

export {
  AglynBaseModelOptions,
  AglynBaseModel,
} from './models/aglyn-base.model'
export {
  AglynModuleModelOptions,
  AglynModuleEffectListener,
  AglynModuleModelT,
  AglynModuleModel,
} from './models/aglyn-module.model'
export {
  AglynExtensionOptions,
  AglynExtensionT,
  AglynExtension,
} from './models/aglyn-extension.model'


//    __________  _   ____________  ____  __    __    __________ _____
//   / ____/ __ \/ | / /_  __/ __ \/ __ \/ /   / /   / ____/ __ / ___/
//  / /   / / / /  |/ / / / / /_/ / / / / /   / /   / __/ / /_/ \__ \
// / /___/ /_/ / /|  / / / / _, _/ /_/ / /___/ /___/ /___/ _, ____/ /
// \____/\____/_/ |_/ /_/ /_/ |_|\____/_____/_____/_____/_/ |_/____/
// 👇 TYPES ONLY

export type {
  AglynAppOptions,
  AglynEffectOptions,
  AglynAppControllerT,
  AglynAppController,
} from './controllers/aglyn-app.controller'
export type {
  AglynExtensionTypeFields,
  AglynExtensionLoader,
  AglynExtensionsControllerT,
  AglynExtensionsController,
} from './controllers/aglyn-extensions.controller'
export type {
  ContextStore,
  ContextDomain,
  ContextEvent,
  ContextEffect,
  ContextStoreOptions,
  AglynContextsControllerT,
  AglynContextsController,
} from './controllers/aglyn-contexts.controller'
export type {
  AglynCommandResolver,
  AglynCommandListener,
  AglynCommandResolverTypeFields,
  AglynCommandListenerTypeFields,
  AglynCommandParams,
  AglynCommandsControllerT,
  AglynCommandsController,
} from './controllers/aglyn-commands.controller'
export type {
  AglynComponentsBundle,
  AglynComponentSchema,
  BundleUId,
  ComponentId,
  AglynComponentsTypeFields,
  AglynComponentElement,
  AglynComponentElementTemplateData,
  ComponentsRegistryEntry,
  ComponentsRegistryKeys,
  ComponentsRegistryValues,
  AglynComponentClassElement,
  AglynComponentElementData,
  AglynComponentElementType,
  AglynComponentFunctionElement,
  AglynComponentIntrinsicElement,
  LinealOrder,
  TemplateSubElementData,
  AglynComponentsControllerT,
  AglynComponentsController,
} from './controllers/aglyn-components.controller'
