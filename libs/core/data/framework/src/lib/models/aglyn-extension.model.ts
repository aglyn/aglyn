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

import { LifecycleFlag, LoadableObserver, OrNull } from '@aglyn/shared-data-types'
import { getStaticField } from '@aglyn/shared-util-tools'
import { EXTENSION_TYPE, MODULE_TYPE, TYPE_KIND, TYPE_OF } from '../constants/symbol'
import type { AglynAppController } from '../controllers/aglyn-app.controller'
import { AglynExtensionTypeFields } from '../controllers/aglyn-extension.controller'
import { AglynBaseModel } from './aglyn-base.model'


const TAG = 'AglynExtension'

export type AglynExtensionOptions = {
  autoload?: boolean
}

export interface AglynExtension<T = any>
  extends AglynBaseModel,
    LoadableObserver,
    AglynExtensionTypeFields {
  getName(): string
  getOptions(): AglynExtensionOptions
  getContext(): T
  setContext(value: T): this
  onInit(app: AglynAppController): void
  onDestroy(app: AglynAppController): void
}

export abstract class AglynExtension<T = any> extends AglynBaseModel {
  public static readonly [Symbol.toStringTag]: string = TAG
  public static readonly [TYPE_OF]: number | symbol = MODULE_TYPE
  public static readonly [TYPE_KIND]: number | symbol = EXTENSION_TYPE
  public static readonly $id: string = null
  readonly #options: AglynExtensionOptions = null
  protected app: AglynAppController
  protected context?: T = null
  #lifecycle?: OrNull<LifecycleFlag> = null
  public get $id() {
    return getStaticField('$id', this)
  }
  public get [TYPE_OF]() {
    return getStaticField(TYPE_OF, this)
  }
  public get [TYPE_KIND]() {
    return getStaticField(TYPE_KIND, this)
  }
  public get lifecycle(): OrNull<LifecycleFlag> {
    return this.#lifecycle
  }
  public set lifecycle(value: LifecycleFlag) {
    this.#lifecycle = value
  }

  protected constructor(app: AglynAppController, options: AglynExtensionOptions) {
    super()
    this.#options = {...options}
    this.app = app
    this.#initialize()
  }
  #initialize() {
    this.setErrorFactory(this.app.getErrorFactory())
    this.setEmitter(this.app.getEmitter())
    this.setLogger(this.app.getLogger())
  }
  public getName = (): string => {
    return this.$id
  }
  public static getName = (): string => {
    return getStaticField('$id', this)
  }
  public getOptions = (): AglynExtensionOptions => {
    return this.#options
  }
  public getContext = (): T => {
    return this.context
  }
  public setContext = (value: T): this => {
    this.context = value
    return this
  }
  public toString = (): string => {
    return `${TAG}(name: '${this.$id}')`
  }
  public toJSON = () => {
    return {
      ...super.toJSON(),
      name: this.$id,
      [TYPE_OF]: getStaticField(TYPE_OF, this),
      [TYPE_KIND]: getStaticField(TYPE_KIND, this),
    }
  }
  public onInit(app: AglynAppController): void {
    throw new Error('You must implement `onInit`')
  }
  public onDestroy(app: AglynAppController): void {
    throw new Error('You must implement `onDestroy`')
  }
}

export type AglynExtensionT = typeof AglynExtension
export default AglynExtension
