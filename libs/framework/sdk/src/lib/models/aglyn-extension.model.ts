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

import { AglynExtension, AglynExtensionConfig, AglynSymbol } from '@aglyn/framework/sdk'
import { LifecycleFlag } from '@aglyn/shared/util/types'


export abstract class AglynExtensionModel implements AglynExtension {

  protected static __$ID__: string = null
  static #__TAG__ = 'AglynExtension'
  #lifecycle?: LifecycleFlag = null
  context?: any = null
  protected getContext() { return this.context }
  protected setContext(value) { this.context = value }
  public get lifecycle() { return this.#lifecycle }
  public set lifecycle(value) {
    if (value in LifecycleFlag) {
      this.#lifecycle = value
    }
  }
  public readonly config: AglynExtensionConfig = {autoload: true}
  public get $id() { return AglynExtensionModel.__$ID__ }
  public get [AglynSymbol.TypeOf]() { return AglynSymbol.MODULE_TYPE }
  public get [AglynSymbol.TypeKind]() { return AglynSymbol.EXTENSION_TYPE }
  public get [Symbol.toStringTag]() { return `${AglynExtensionModel.#__TAG__}` }
  protected constructor() {

  }
  public toString() {
    const pfx = AglynExtensionModel.#__TAG__
    const extensionId = AglynExtensionModel.__$ID__ ?? 'NONE'
    return `${pfx}(id: '${extensionId}')`
  }
  public toJSON() {
    return {
      [AglynSymbol.TypeOf]: AglynExtensionModel[AglynSymbol.TypeOf],
      [AglynSymbol.TypeKind]: AglynExtensionModel[AglynSymbol.TypeKind],
      $id: AglynExtensionModel.__$ID__,
    }
  }

}
