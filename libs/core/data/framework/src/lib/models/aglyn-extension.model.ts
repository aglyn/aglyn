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

import { OrNull } from '@aglyn/shared-data-types'
import { getStaticField } from '@aglyn/shared-util-tools'
import { AglynLifecycleFlag } from '../constants/enums'
import { AglynErrorEventFlag } from '../constants/error'
import { EXTENSION_TYPE, MODULE_TYPE, TYPE_KIND, TYPE_OF } from '../constants/symbol'
import type { AglynAppController } from '../controllers/aglyn-app.controller'
import type { ExtensionUUN } from '../controllers/aglyn-components.controller'
import type { AglynExtensionTypeFields } from '../controllers/aglyn-extension.controller'
import type { AglynLoadableObserver } from '../types'
import type { AglynBaseModelOptions } from './aglyn-base.model'
import { AglynModuleModel } from './aglyn-module.model'


const TAG = 'AglynExtension'

export interface AglynExtensionOptions extends AglynBaseModelOptions {
  autoload?: boolean
  app: AglynAppController
}

export interface AglynExtension<T = any, O extends AglynExtensionOptions = AglynExtensionOptions>
  extends AglynModuleModel<O>,
    AglynExtensionTypeFields,
    AglynLoadableObserver<AglynAppController, AglynAppController> {
  getExtensionName(): string
  getContext(): T
  setContext(value: T): this
}

export abstract class AglynExtension<T = any, O extends AglynExtensionOptions = AglynExtensionOptions> extends AglynModuleModel<O> {

  public static readonly [Symbol.toStringTag]: string = TAG

  public static readonly [TYPE_OF]: number | symbol = MODULE_TYPE
  public static readonly [TYPE_KIND]: number | symbol = EXTENSION_TYPE

  public static readonly extensionName: string = null

  protected context?: T = null
  #lifecycle?: OrNull<AglynLifecycleFlag> = AglynLifecycleFlag.UNREGISTERED

  public get [TYPE_OF](): number | symbol {
    return getStaticField(TYPE_OF, this)
  }
  public get [TYPE_KIND](): number | symbol {
    return getStaticField(TYPE_KIND, this)
  }

  public get extensionName() {
    return getStaticField('extensionName', this)
  }
  public get lifecycle(): OrNull<AglynLifecycleFlag> {
    return this.#lifecycle
  }
  public set lifecycle(value: AglynLifecycleFlag) {
    this.#lifecycle = value
  }

  protected constructor(options: O) {
    super(options)
  }

  public toString = (): string => {
    return `${TAG}(${this.extensionName})`
  }
  public toJSON = () => {
    return {
      ...super.toJSON(),
      extensionName: this.extensionName,
      [TYPE_OF]: getStaticField(TYPE_OF, this),
      [TYPE_KIND]: getStaticField(TYPE_KIND, this),
    }
  }

  public aglynOnInit(app: AglynAppController): void {
    super.aglynOnInit(app)
  }
  public aglynOnLoad(app: AglynAppController): void {
    throw this.getErrorFactory().create(AglynErrorEventFlag.EXTENSION_MISSING_MEMBER_METHOD, {
      extensionName: this.extensionName, memberMethod: 'aglynOnLoad',
    })
  }
  public aglynOnUnload(app: AglynAppController): void {
    throw this.getErrorFactory().create(AglynErrorEventFlag.EXTENSION_MISSING_MEMBER_METHOD, {
      extensionName: this.extensionName, memberMethod: 'aglynOnUnload',
    })
  }
  public aglynOnDestroy(app: AglynAppController): void {
    super.aglynOnDestroy(app)
  }

  public getExtensionName = (): ExtensionUUN => {
    return getStaticField('extensionName', this)
  }
  public static getExtensionName = (): ExtensionUUN => {
    return getStaticField('extensionName', this)
  }
  public getContext = (): T => {
    return this.context
  }
  public setContext = (value: T): this => {
    this.context = value
    return this
  }
}

export type AglynExtensionT = typeof AglynExtension
export default AglynExtension
