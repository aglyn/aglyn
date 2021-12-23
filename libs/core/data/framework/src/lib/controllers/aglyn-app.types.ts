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

import type {AglynAppEffectFlag} from '../constants/emitter'
import type {
  AglynBaseModelOptions,
  AglynBaseModelT,
  IAglynBaseModel,
} from '../models/aglyn-base.types'
import type {AppUUN, Payload} from '../types'

import type {AglynBesignerControllerOptions, IAglynBesignerController} from './aglyn-besigner.types'
import type {AglynCanvasControllerOptions, IAglynCanvasController} from './aglyn-canvas.types'
import type {IAglynCommandsController} from './aglyn-commands.types'
import type {
  AglynComponentsControllerOptions,
  IAglynComponentsController,
} from './aglyn-components.types'
import type {
  AglynContextsControllerOptions,
  IAglynContextsController,
} from './aglyn-contexts.types'
import type {
  AglynExtensionsControllerOptions,
  IAglynExtensionsController,
} from './aglyn-extensions.types'


export interface AglynEffectOptions<T, U = unknown> extends Payload<U> {
  type: T
}

export interface AglynAppOptions extends AglynBaseModelOptions {
  appName?: AppUUN
  modulesOptions?: {
    contexts?: AglynContextsControllerOptions
    extensions?: AglynExtensionsControllerOptions
    commands?: AglynExtensionsControllerOptions
    components?: AglynComponentsControllerOptions
    canvas?: AglynCanvasControllerOptions
    besigner?: AglynBesignerControllerOptions
  }
}

export interface IAglynAppController extends IAglynBaseModel<AglynAppOptions> {
  readonly extensions: IAglynExtensionsController
  readonly contexts: IAglynContextsController
  readonly commands: IAglynCommandsController
  readonly components: IAglynComponentsController
  readonly canvas: IAglynCanvasController
  readonly besigner: IAglynBesignerController
  readonly deleted: boolean

  getName(): string
  isDeleted(): boolean
  setDeleted(value: boolean): this
  getExtensionsController(): IAglynExtensionsController
  getCanvasController(): IAglynCanvasController
  getContextsController(): IAglynContextsController
  getCommandsController(): IAglynCommandsController
  getComponentsController(): IAglynComponentsController
  effect(data: AglynEffectOptions<AglynAppEffectFlag>): this
}

export interface AglynAppControllerT extends AglynBaseModelT<AglynAppOptions> {
  new(options: AglynAppOptions): IAglynAppController
}
