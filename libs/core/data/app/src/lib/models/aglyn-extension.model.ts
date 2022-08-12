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

import {
  AGLYN_OF,
  AglynErrorEventFlag,
  type AglynExtensionOptions,
  AglynLifecycleFlag,
  EXTENSION_TYPE,
  type ExtensionUUN,
  type IAglynAppController,
  type IAglynExtension,
  nextLifecycleIsValid,
} from '@aglyn/core-data-foundation'
import { getStaticField } from '@aglyn/shared-util-tools'
import { AglynModuleModel } from './aglyn-module.model'

const TAG = 'AglynExtension'
const NS = 'com.aglyn.core.data.model.extension'

export abstract class AglynExtension<
    T = any,
    O extends AglynExtensionOptions = AglynExtensionOptions,
  >
  extends AglynModuleModel<O>
  implements IAglynExtension<T, O>
{
  public static get [Symbol.toStringTag](): string {
    return TAG
  }
  public static get [AGLYN_OF](): number | symbol {
    return EXTENSION_TYPE
  }
  public static get namespace(): string {
    return `${NS}::${this.extensionName}`
  }
  public static get extensionName(): string {
    return 'unknown'
  }

  #context?: T = null
  #lifecycle?: AglynLifecycleFlag[] = [AglynLifecycleFlag.UNREGISTERED]

  public get extensionName(): string {
    return getStaticField('extensionName', this)
  }
  public get context(): T {
    return this.#context
  }
  public get lifecycleHistory(): AglynLifecycleFlag[] {
    return [...this.#lifecycle]
  }

  public get lifecycle(): AglynLifecycleFlag {
    return this.#lifecycle.at(-1)
  }
  public set lifecycle(lifecycleFlag: AglynLifecycleFlag) {
    if (!nextLifecycleIsValid(this.lifecycle, lifecycleFlag)) {
      throw this.getErrorFactory().create(
        AglynErrorEventFlag.MODULE_INVALID_LIFECYCLE,
        {
          now: lifecycleFlag,
          prev: this.lifecycle,
        },
      )
    }
    this.#lifecycle.push(lifecycleFlag)
  }

  protected constructor(app: IAglynAppController, options: O) {
    super(app, options)
  }

  public toString(): string {
    return `${super.toString()}(${this.extensionName})`
  }

  public toJSON() {
    return {
      ...super.toJSON(),
      extensionName: this.extensionName,
    }
  }

  public onInitialize(): this {
    super.onInitialize()
    return this
  }
  public onActivate(): this {
    super.onActivate()
    return this
  }
  public onDeactivate(): this {
    super.onDeactivate()
    return this
  }
  public onDestroy(): this {
    super.onDestroy()
    return this
  }
  public getExtensionName(): ExtensionUUN {
    return getStaticField('extensionName', this)
  }
  public static getExtensionName(): ExtensionUUN {
    return getStaticField('extensionName', this)
  }
  public getContext(): T {
    return this.#context
  }
  public setContext(value: T): this {
    this.#context = value
    return this
  }
}

export default AglynExtension
