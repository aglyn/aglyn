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

import {type Dictionary} from '@aglyn/shared-data-types'
import {type EmitterFn} from '@aglyn/shared-util-emitter'
import {
  type CommandsRegisterListenerPayload,
  type CommandsRemoveResolverPayload,
  type CommandsSetResolverPayload,
  type CommandsTriggerPayload,
  type CommandsUnregisterListenerPayload,
} from '../constants/emitter'
import {type OF_KIND, type OF_TYPE} from '../constants/symbol'
import {
  type AglynModuleModelOptions,
  type AglynModuleModelT,
  type IAglynModuleModel,
} from './aglyn-module.types'
import {type IAglynAppController} from './aglyn-app.types'


export type CommandUId = string
export type TriggerListenerPayload<T, U> = {payload: T, response: U}
export type AglynCommander = EmitterFn<Record<CommandUId, TriggerListenerPayload<any, any>>>

export interface AglynCommandResolver {
  readonly [OF_TYPE]?: number | symbol
  readonly [OF_KIND]?: number | symbol
  commandId: CommandUId
  (data: Dictionary): any
}

export interface AglynCommandListener {
  readonly [OF_TYPE]?: number | symbol
  readonly [OF_KIND]?: number | symbol
  commandId: CommandUId
  (data: TriggerListenerPayload<any, any>): void
}

export interface AglynCommandsControllerOptions extends AglynModuleModelOptions {
  handlers?: CommandsSetResolverPayload
}

export interface IAglynCommandsController extends IAglynModuleModel<AglynCommandsControllerOptions> {
  readonly commander: AglynCommander
  readonly resolvers: Map<CommandUId, AglynCommandResolver>

  setResolver(data: CommandsSetResolverPayload): this
  registerListener(data: CommandsRegisterListenerPayload): this
  removeResolver(data: CommandsRemoveResolverPayload): this
  unregisterListener(data: CommandsUnregisterListenerPayload): this
  trigger(data: CommandsTriggerPayload): this
}

export interface AglynCommandsControllerT extends AglynModuleModelT<AglynCommandsControllerOptions> {
  new(app: IAglynAppController, options: AglynCommandsControllerOptions): IAglynCommandsController
}
