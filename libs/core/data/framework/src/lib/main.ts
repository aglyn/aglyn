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
export * from './api/besigner.api'
export * from './api/canvas.api'
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

export * from './constants/_internal'
export * from './constants/canvas'
export * from './constants/components'
export * from './constants/besigner'
export * from './constants/emitter'
export * from './constants/error'
export * from './constants/lifecycle'
export * from './constants/logger'
export * from './constants/platform'
export * from './constants/symbol'
export * from './constants/version'


//    __  ______________   _____
//   / / / /_  __/  _/ /  / ___/
//  / / / / / /  / // /   \__ \
// / /_/ / / / _/ // /______/ /
// \____/ /_/ /___/_____/____/
// 👇

export * from './util/aglyn-is'
export * from './util/build-component-props-form-schema'
export * from './util/confirm-valid-lineal-relationship'
export * from './util/create-component-element-data'
export * from './util/create-component-element-data-copy'
export * from './util/create-component-element-id'
export * from './util/create-components-bundle'
export * from './util/delete-component-element'
export * from './util/denormalize-component-element-data'
export * from './util/get-component-element-hierarchy'
export * from './util/handle-state-modification-history-change'
export * from './util/handle-state-modification-history-redo'
export * from './util/handle-state-modification-history-undo'
export * from './util/is-root-element-id'
export * from './util/normalize-component-element-data'


//     __  _______  ____  ________   _____
//    /  |/  / __ \/ __ \/ ____/ /  / ___/
//   / /|_/ / / / / / / / __/ / /   \__ \
//  / /  / / /_/ / /_/ / /___/ /______/ /
// /_/  /_/\____/_____/_____/_____/____/
// 👇

export * from './models/aglyn-base.model'
export * from './models/aglyn-module.model'
export * from './models/aglyn-extension.model'


//    __________  _   ____________  ____  __    __    __________ _____
//   / ____/ __ \/ | / /_  __/ __ \/ __ \/ /   / /   / ____/ __ / ___/
//  / /   / / / /  |/ / / / / /_/ / / / / /   / /   / __/ / /_/ \__ \
// / /___/ /_/ / /|  / / / / _, _/ /_/ / /___/ /___/ /___/ _, ____/ /
// \____/\____/_/ |_/ /_/ /_/ |_|\____/_____/_____/_____/_/ |_/____/
// 👇 TYPES ONLY

export type {
  AglynAppController,
  AglynAppControllerT,
  AglynAppOptions,
  AglynEffectOptions,
} from './controllers/aglyn-app.controller'
export type {
  AglynExtensionLoader,
  AglynExtensionTypeFields,
  AglynExtensionsController,
  AglynExtensionsControllerT,
} from './controllers/aglyn-extensions.controller'
export type {
  AglynContextsController,
  AglynContextsControllerOptions,
  AglynContextsControllerT,
  ContextDomain,
  ContextEffect,
  ContextEvent,
  ContextStore,
  ContextStoreOptions,
} from './controllers/aglyn-contexts.controller'
export type {
  AglynCommandListener,
  AglynCommandListenerTypeFields,
  AglynCommandResolver,
  AglynCommandResolverTypeFields,
  AglynCommandsController,
  AglynCommandsControllerOptions,
  AglynCommandsControllerT,
} from './controllers/aglyn-commands.controller'
export type {
  AglynComponentBesignerFlags,
  AglynComponentClassElement,
  IAglynComponent,
  AglynComponentElementData,
  AglynComponentElementDataDenormalized,
  AglynComponentElementDataNormalized,
  AglynComponentElementTemplateData,
  AglynComponentElementType,
  AglynComponentFunctionElement,
  AglynComponentIntrinsicElement,
  AglynComponentMetadata,
  AglynComponentPropsFormSchema,
  AglynComponentRenderFlags,
  AglynComponentSchema,
  AglynComponentsBundle,
  AglynComponentsController,
  AglynComponentsControllerOptions,
  AglynComponentsControllerT,
  AglynComponentsTypeFields,
  ComponentsLinealOrder,
  ComponentsRegistryContext,
  ComponentsRegistryEntry,
  ComponentsRegistryKeys,
  ComponentsRegistryValues,
  InstanceBundles,
  InstanceComponents,
  InstanceSchemas,
  InstanceTemplates,
  LinealDefinition,
  TemplateSubElementData,
} from './controllers/aglyn-components.controller'
export type {
  AglynCanvasController,
  AglynCanvasControllerOptions,
  AglynCanvasControllerT,
  ElementsDataStore,
  ElementsDataStoreApi,
} from './controllers/aglyn-canvas.controller'
export type {
  AglynBesignerController,
  AglynBesignerControllerOptions,
  AglynBesignerControllerT,
  BesignerCanvasHoveredElement,
  BesignerCanvasSelectedElement,
  BesignerCanvasState,
  BesignerContextStores,
  BesignerDndState,
  BesignerFlagState,
  BesignerPanelsState,
  CommActionData,
} from './controllers/aglyn-besigner.controller'
