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

import {type Dictionary} from '@aglyn/shared-data-types'
import {type EmitterFn} from '@aglyn/shared-util-emitter'
import {
  type CommandsRegisterListenerPayload,
  type CommandsRemoveResolverPayload,
  type CommandsSetResolverPayload,
  type CommandsTriggerPayload,
  type CommandsUnregisterListenerPayload,
} from '../constants/emitter'
import {TYPE_KIND, TYPE_OF} from '../constants/symbol'
import {
  type AglynModuleModelOptions,
  type AglynModuleModelT,
  type IAglynModuleModel,
} from '../models/aglyn-module.types'
import {type IAglynAppController} from './aglyn-app.types'


export type CommandUId = string
export type TriggerListenerPayload<T, U> = {payload: T, response: U}
export type AglynCommander = EmitterFn<Record<CommandUId, TriggerListenerPayload<any, any>>>

export interface AglynCommandResolver {
  readonly [TYPE_OF]?: number | symbol
  readonly [TYPE_KIND]?: number | symbol
  commandId: CommandUId
  (data: Dictionary): any
}

export interface AglynCommandListener {
  readonly [TYPE_OF]?: number | symbol
  readonly [TYPE_KIND]?: number | symbol
  commandId: CommandUId
  (data: TriggerListenerPayload<any, any>): void
}

export interface AglynCommandsControllerOptions extends AglynModuleModelOptions {
  handlers?: CommandsSetResolverPayload
}

export interface IAglynCommandsController extends IAglynModuleModel<AglynCommandsControllerOptions> {
  readonly commander: AglynCommander
  readonly resolvers: Map<CommandUId, AglynCommandResolver>

  setResolver(data: CommandsSetResolverPayload): void
  registerListener(data: CommandsRegisterListenerPayload): void
  removeResolver(data: CommandsRemoveResolverPayload): void
  unregisterListener(data: CommandsUnregisterListenerPayload): void
  trigger(data: CommandsTriggerPayload): void
}

export interface AglynCommandsControllerT extends AglynModuleModelT<AglynCommandsControllerOptions> {
  new(app: IAglynAppController, options: AglynCommandsControllerOptions): IAglynCommandsController
}
