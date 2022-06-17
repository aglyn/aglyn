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

import { getStaticField } from '@aglyn/shared-util-tools'
import { MODULE_TYPE, OF_KIND, OF_TYPE } from '../constants/symbol'
import type { IAglynAppController } from '../definitions/aglyn-app.types'
import type { AglynDependency } from '../definitions/aglyn-depends.types'
import type {
  AglynModuleEffectListener,
  AglynModuleModelOptions,
  IAglynModuleModel,
} from '../definitions/aglyn-module.types'
import { AglynBaseModel } from './aglyn-base.model'

const TAG = 'AglynModule'
const NS = 'com.aglyn.core.data.framework.model.module'

export abstract class AglynModuleModel<O extends AglynModuleModelOptions = AglynModuleModelOptions>
  extends AglynBaseModel<O>
  implements IAglynModuleModel<O>, AglynDependency
{
  public static get [Symbol.toStringTag](): string {
    return TAG
  }
  public static get [OF_TYPE](): number | symbol {
    return MODULE_TYPE
  }
  public static get [OF_KIND](): number | symbol {
    return undefined
  }
  public static get namespace(): string {
    return NS
  }

  public get [OF_TYPE](): number | symbol {
    return getStaticField(OF_TYPE, this)
  }
  public get [OF_KIND](): number | symbol {
    return getStaticField(OF_KIND, this)
  }

  protected get listeners(): AglynModuleEffectListener<any>[] {
    return []
  }

  protected constructor(protected app: IAglynAppController, options: O) {
    super(options)
  }

  public load(...args): void {
    this.__initialize__()
    this.__activate__()
    this.setupListeners()
  }
  public destroy(...args): void {
    this.breakdownListeners()
    this.__deactivate__()
    this.__destroy__()
  }

  public setupListeners(): this {
    this.listeners.forEach(([flag, method]) => this.app.getEmitter().on(flag, method))
    return this
  }
  public breakdownListeners(): this {
    this.listeners.forEach(([flag, method]) => this.app.getEmitter().off(flag, method))
    return this
  }

  public onInitialize(): this {
    super.onInitialize()
    return this
  }

  public onDestroy(): this {
    super.onInitialize()
    return this
  }

  public toString(): string {
    return `[${super.toString()} ${this.app.getName()}]`
  }
  public toJSON() {
    return {
      ...super.toJSON(),
    }
  }
}

export default AglynModuleModel
