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

import type {
  ExtensionDestroyPayload,
  ExtensionHandleLoaderPayload,
  ExtensionInitializePayload,
  ExtensionLoadPayload,
  ExtensionRegisterPayload,
  ExtensionUnloadPayload,
} from '../constants/emitter'
import type {EXTENSION_TYPE, MODULE_TYPE} from '../constants/symbol'
import type {AglynExtensionT, IAglynExtension} from '../models/aglyn-extension.types'
import type {
  AglynModuleModelOptions,
  AglynModuleModelT,
  IAglynModuleModel,
} from '../models/aglyn-module.types'
import type {AglynTypeFields} from '../types'
import type {IAglynAppController} from './aglyn-app.types'


export type AglynExtensionTypeFields = AglynTypeFields<typeof MODULE_TYPE, typeof EXTENSION_TYPE>
export type AglynExtensionLoader = () => Promise<AglynExtensionT>

export interface AglynExtensionsControllerOptions extends AglynModuleModelOptions {
  initialExtensions?: ExtensionHandleLoaderPayload[]
}

export interface IAglynExtensionsController extends IAglynModuleModel<AglynExtensionsControllerOptions> {
  handleLoader(payload: ExtensionHandleLoaderPayload): IAglynExtension
  registerExtension(payload: ExtensionRegisterPayload): void
  initializeExtension(payload: ExtensionInitializePayload): void
  loadExtension(payload: ExtensionLoadPayload): void
  unloadExtension(payload: ExtensionUnloadPayload): void
  destroyExtension(payload: ExtensionDestroyPayload): void
  getExtensionByName(name: string): IAglynExtension
  getAllExtensions(): IAglynExtension[]
  unloadAllExtensions(): void
  destroyAllExtensions(): void
}

export interface AglynExtensionsControllerT extends AglynModuleModelT<AglynExtensionsControllerOptions> {
  new(
    app: IAglynAppController,
    options: AglynExtensionsControllerOptions,
  ): IAglynExtensionsController
}
