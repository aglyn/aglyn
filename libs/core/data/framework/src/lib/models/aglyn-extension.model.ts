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

import { getStaticField } from '@aglyn/shared-util-tools'
import { AglynErrorEventFlag } from '../constants/error'
import { AglynLifecycleFlag, nextLifecycleIsValid } from '../constants/lifecycle'
import { EXTENSION_TYPE, TYPE_KIND } from '../constants/symbol'
import type { AglynAppController } from '../controllers/aglyn-app.controller'
import type { AglynLoadableObserver, ExtensionUUN } from '../types'
import { AglynModuleModel, AglynModuleModelOptions } from './aglyn-module.model'


export interface AglynExtensionOptions extends AglynModuleModelOptions {
  autoload?: boolean
}

export interface AglynExtension<T = any, O extends AglynExtensionOptions = AglynExtensionOptions>
  extends AglynModuleModel<O>,
    AglynLoadableObserver<AglynAppController, AglynAppController> {
  getExtensionName(): string
  getContext(): T
  setContext(value: T): this
}

const TAG = 'AglynExtension'
const MODULE_NAME = 'extensions.model'

export abstract class AglynExtension<T = any, O extends AglynExtensionOptions = AglynExtensionOptions> extends AglynModuleModel<O> {

  public static readonly [Symbol.toStringTag]: string = TAG
  public static readonly [TYPE_KIND]: number | symbol = EXTENSION_TYPE
  public static readonly extensionName: string = 'unknown'
  public static get namespace(): string {return `${MODULE_NAME}::${this.extensionName}`}
  public static get moduleName(): string {return `${MODULE_NAME}::${this.extensionName}`}

  protected context?: T = null
  #lifecycle?: AglynLifecycleFlag[] = [AglynLifecycleFlag.UNREGISTERED]

  public get extensionName() {
    return getStaticField('extensionName', this)
  }
  public get lifecycleHistory(): AglynLifecycleFlag[] {
    return [...this.#lifecycle]
  }
  public get lifecycle(): AglynLifecycleFlag {
    return this.#lifecycle.slice(-1)[0]
  }
  public set lifecycle(value: AglynLifecycleFlag) {
    if (!nextLifecycleIsValid(this.lifecycle, value)) {
      // TODO: throw errorFactory error
      throw new Error(`Inappropriate lifecycle '${value}' following '${this.lifecycle}'`)
    }
    this.#lifecycle.push(value)
  }

  protected constructor(app: AglynAppController, options: O) {
    super(app, options)
  }

  public toString = (): string => {
    return `${super.toString()}[${this.extensionName}]`
  }
  public toJSON = () => {
    return {
      ...super.toJSON(),

      extensionName: this.extensionName,
    }
  }

  public aglynOnInit(app: AglynAppController): void {
    super.aglynOnInit(app)
  }
  public aglynOnLoad(app: AglynAppController): void {
    throw this.getErrorFactory().create(AglynErrorEventFlag.MODULE_MISSING_MEMBER, {
      extensionName: this.extensionName, memberMethod: 'aglynOnLoad',
    })
  }
  public aglynOnUnload(app: AglynAppController): void {
    throw this.getErrorFactory().create(AglynErrorEventFlag.MODULE_MISSING_MEMBER, {
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
