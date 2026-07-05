/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import { _INTERNAL_BESIGNERS_ } from '../constants/_internal'
import {
  type BesignerAppOptions,
  DEFAULT_APP_UUN,
  type IBesignerAppController,
} from '../definitions/besigner-app.types'
import type { IBesignerInterfaceController } from '../definitions/besigner-interface.types'
import { BesignerInterfaceController } from './besigner-interface.controller'

const TAG = 'BesignerApp'
const NS = 'com.aglyn.besigner.data.controller.app'

export class BesignerAppController implements IBesignerAppController {
  public readonly appName: string
  public deleted = false
  public interfaceController: IBesignerInterfaceController = null

  public static get [Symbol.toStringTag](): string {
    return TAG
  }
  public static get namespace(): string {
    return NS
  }

  public get interface(): IBesignerInterfaceController {
    return this.interfaceController
  }

  constructor(public readonly options: BesignerAppOptions) {
    this.appName = options?.appName || DEFAULT_APP_UUN
    _INTERNAL_BESIGNERS_.set(
      this.appName,
      (this.interfaceController = new BesignerInterfaceController(this, {
        logLevel: options?.logLevel,
        ...options?.modulesOptions?.interface,
      })),
    )
  }

  public getName(): string {
    return this.appName
  }
  public getBesignerController(): IBesignerInterfaceController {
    return this.interfaceController
  }
  public onDestroy(): void {
    _INTERNAL_BESIGNERS_.delete(this.appName)
  }
  public setDeleted(value: boolean): void {
    this.deleted = value
  }
}
export default BesignerAppController
