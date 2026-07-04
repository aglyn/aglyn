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

import { AglynAppController } from '@aglyn/aglyn'
import type { IAglynModuleModel } from '@aglyn/aglyn'
import { _INTERNAL_BESIGNERS_ } from '../constants/_internal'
import type {
  BesignerAppOptions,
  IBesignerAppController,
} from '../definitions/besigner-app.types'
import type { IBesignerInterfaceController } from '../definitions/besigner-interface.types'
import { BesignerInterfaceController } from './besigner-interface.controller'

const TAG = 'BesignerApp'
const NS = 'com.aglyn.besigner.data.controller.app'

export class BesignerAppController
  extends AglynAppController<BesignerAppOptions>
  implements IBesignerAppController
{
  interfaceController: IBesignerInterfaceController = null

  public static get [Symbol.toStringTag](): string {
    return TAG
  }
  public static get namespace(): string {
    return NS
  }
  public get interface(): IBesignerInterfaceController {
    return this.interfaceController
  }
  protected get modules(): IAglynModuleModel[] {
    const modules = super.modules,
      extModule = modules.pop()
    return [...modules, this.interfaceController, extModule]
  }

  constructor(options: BesignerAppOptions) {
    super(options)
  }

  public setupExtensions(): this {
    super.setupExtensions()
    _INTERNAL_BESIGNERS_.set(
      this.appName,
      (this.interfaceController = new BesignerInterfaceController(this, {
        ...this.options.modulesOptions?.interface,
      })),
    )
    return this
  }

  public getBesignerController(): IBesignerInterfaceController {
    return this.interfaceController
  }
}

export default BesignerAppController
