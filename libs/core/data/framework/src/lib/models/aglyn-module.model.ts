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
import { AglynAppEffectFlag, AglynModuleEffectPayload } from '../constants/emitter'
import { MODULE_TYPE, TYPE_KIND, TYPE_OF } from '../constants/symbol'
import type { AglynAppController } from '../controllers/aglyn-app.controller'
import type { AglynLifecycleObserver, AglynTypeFields } from '../types'
import { AglynBaseModel, AglynBaseModelOptions } from './aglyn-base.model'


export type AglynModuleTypeFields = AglynTypeFields<typeof MODULE_TYPE, number | symbol>
export type AglynModuleEffectListener<Effect extends AglynAppEffectFlag> = [
  Effect, (args: AglynModuleEffectPayload[Effect]) => unknown
]

export interface AglynModuleModelOptions extends AglynBaseModelOptions {

}

export interface AglynModuleModel<O extends AglynModuleModelOptions = AglynModuleModelOptions>
  extends AglynBaseModel<O>,
    AglynModuleTypeFields,
    AglynLifecycleObserver<AglynAppController> {
}

const TAG = 'AglynModule'
const MODULE_NAME = 'module'

export abstract class AglynModuleModel<O extends AglynModuleModelOptions = AglynModuleModelOptions> extends AglynBaseModel<O> {

  public static readonly [Symbol.toStringTag]: string = TAG
  public static readonly [TYPE_OF]: number | symbol = MODULE_TYPE
  public static readonly [TYPE_KIND]: number | symbol = undefined
  public static readonly moduleName: string = MODULE_NAME
  public static readonly namespace: string = MODULE_NAME

  public get [TYPE_OF](): number | symbol {
    return getStaticField(TYPE_OF, this)
  }
  public get [TYPE_KIND](): number | symbol {
    return getStaticField(TYPE_KIND, this)
  }
  public get moduleName(): string {
    return getStaticField('moduleName', this)
  }

  protected constructor(protected app: AglynAppController, options: O) {
    super(options)
    this.#setup()
  }
  #setup() {

  }

  public toString(): string {
    return `${super.toString()}['${this.app.getName()}']`
  }
  public toJSON() {
    return {
      ...super.toJSON(),
      [TYPE_OF]: this[TYPE_OF],
      [TYPE_KIND]: this[TYPE_KIND],
      moduleName: this.moduleName,
    }
  }

  public aglynOnInit(app?: AglynAppController): void {
    this.listeners.forEach(([flag, method]) => this.app.getEmitter().on(flag, method))
  }
  public aglynOnDestroy(app?: AglynAppController): void {
    this.listeners.forEach(([flag, method]) => this.app.getEmitter().off(flag, method))
  }

  protected listeners: AglynModuleEffectListener<any>[] = []
}

export type AglynModuleModelT = typeof AglynModuleModel
export default AglynModuleModel
