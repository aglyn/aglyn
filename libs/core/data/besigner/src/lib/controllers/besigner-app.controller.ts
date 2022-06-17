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

import { AglynAppController, type IAglynModuleModel } from '@aglyn/core-data-framework'
import { _INTERNAL_BESIGNERS_ } from '../constants/_internal'
import { AglynBesignerController } from './aglyn-besigner.controller'
import type { IAglynBesignerController } from './aglyn-besigner.types'
import type { BesignerAppOptions, IBesignerAppController } from './besigner-app.types'

const TAG = 'BesignerApp'
const NS = 'com.aglyn.core.data.besigner.controller.app'

export class BesignerAppController
  extends AglynAppController<BesignerAppOptions>
  implements IBesignerAppController
{
  public static get [Symbol.toStringTag](): string {
    return TAG
  }
  public static get namespace(): string {
    return NS
  }

  #besignerController: IAglynBesignerController = null

  public get besigner(): IAglynBesignerController {
    return this.#besignerController
  }

  protected get modules(): IAglynModuleModel[] {
    const modules = super.modules,
      extModule = modules.pop()
    return [...modules, this.#besignerController, extModule]
  }

  constructor(options: BesignerAppOptions) {
    super(options)
  }

  public setupExtensions(): this {
    super.setupExtensions()
    _INTERNAL_BESIGNERS_.set(
      this.appName,
      (this.#besignerController = new AglynBesignerController(this, {
        ...this.options.modulesOptions?.besigner,
      }))
    )
    return this
  }

  public getBesignerController(): IAglynBesignerController {
    return this.#besignerController
  }
}

export default BesignerAppController
