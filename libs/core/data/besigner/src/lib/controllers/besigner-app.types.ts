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

import type {
  AglynAppControllerT,
  AglynAppOptions,
  IAglynAppController,
} from '@aglyn/core-data-framework'
import type {
  AglynBesignerControllerOptions,
  IAglynBesignerController,
} from './aglyn-besigner.types'


export interface BesignerAppOptions extends AglynAppOptions {
  modulesOptions?: AglynAppOptions['modulesOptions'] & {
    besigner?: AglynBesignerControllerOptions
  }
}

export interface IBesignerAppController extends IAglynAppController<BesignerAppOptions> {
  readonly besigner?: IAglynBesignerController

  getBesignerController(): IAglynBesignerController
}

export interface BesignerAppControllerT extends AglynAppControllerT<BesignerAppOptions> {
  new (options: BesignerAppOptions): IBesignerAppController
}
