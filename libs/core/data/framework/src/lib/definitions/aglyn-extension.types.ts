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

import type {AglynLifecycleFlag} from '../constants/lifecycle'
import type {IAglynAppController} from './aglyn-app.types'
import type {ExtensionUUN} from './aglyn-extensions.types'
import type {
  AglynModuleModelOptions,
  AglynModuleModelT,
  IAglynModuleModel,
} from './aglyn-module.types'


export interface AglynExtensionOptions extends AglynModuleModelOptions {
  autoload?: boolean
}

export interface IAglynExtension<T = any, O extends AglynExtensionOptions = AglynExtensionOptions>
  extends IAglynModuleModel<O> {

  readonly extensionName: ExtensionUUN
  readonly lifecycleHistory: AglynLifecycleFlag[]
  lifecycle: AglynLifecycleFlag
  getExtensionName(): ExtensionUUN
  getContext(): T
  setContext(value: T): this
}

export interface AglynExtensionT<T = any, O extends AglynExtensionOptions = AglynExtensionOptions>
  extends AglynModuleModelT<O> {

  readonly extensionName: ExtensionUUN
  new(app: IAglynAppController, options: O): IAglynExtension<T, O>
  getExtensionName(): ExtensionUUN
}
