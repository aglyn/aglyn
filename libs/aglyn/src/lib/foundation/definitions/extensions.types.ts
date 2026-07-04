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

import type {
  ExtensionDestroyPayload,
  ExtensionHandleLoaderPayload,
  ExtensionInitializePayload,
  ExtensionLoadPayload,
  ExtensionRegisterPayload,
  ExtensionUnloadPayload,
} from '../constants/emitter'
import type { IAglynAppController } from './app.types'
import type { AglynExtensionT, IAglynExtension } from './extension.types'
import type {
  AglynModuleModelOptions,
  AglynModuleModelT,
  IAglynModuleModel,
} from './module.types'

export type ExtensionUUN = string
export type AglynExtensionLoader = () => Promise<AglynExtensionT>
export type AglynExtensionMap = Map<ExtensionUUN, IAglynExtension>

export interface AglynExtensionsControllerOptions
  extends AglynModuleModelOptions {
  defaults: {
    extensions?: ExtensionHandleLoaderPayload[]
  }
}

export interface IAglynExtensionsController
  extends IAglynModuleModel<AglynExtensionsControllerOptions> {
  readonly extensions: Readonly<IAglynExtension[]>

  handleLoader(payload: ExtensionHandleLoaderPayload): IAglynExtension
  registerExtension(payload: ExtensionRegisterPayload): this
  initializeExtension(payload: ExtensionInitializePayload): this
  activateExtension(payload: ExtensionLoadPayload): this
  deactivateExtension(payload: ExtensionUnloadPayload): this
  destroyExtension(payload: ExtensionDestroyPayload): this
  getExtensionByName(name: string): IAglynExtension
  getAllExtensions(): Readonly<IAglynExtension[]>
  deactivateAllExtensions(): this
  destroyAllExtensions(): this
}

export interface AglynExtensionsControllerT
  extends AglynModuleModelT<AglynExtensionsControllerOptions> {
  new (
    app: IAglynAppController,
    options: AglynExtensionsControllerOptions,
  ): IAglynExtensionsController
}
