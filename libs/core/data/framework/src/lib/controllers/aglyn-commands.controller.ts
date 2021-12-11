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

import type { Dictionary } from '@aglyn/shared-data-types'
import { EmitterFn } from '@aglyn/shared-util-emitter'
import { _isFnT } from '@aglyn/shared-util-guards'
import {
  AglynAppEffectFlag,
  AglynAppEventFlag,
  CommandRegisterListenerPayload,
  CommandRemoveResolverPayload,
  CommandsSetResolverPayload,
  CommandTriggerPayload,
  CommandUnregisterListenerPayload,
} from '../constants/emitter'
import type { COMMAND_LISTENER_TYPE, COMMAND_RESOLVER_TYPE, MODULE_TYPE } from '../constants/symbol'
import {
  AglynModuleEffectListener,
  AglynModuleModel,
  AglynModuleModelOptions,
} from '../models/aglyn-module.model'
import type { AglynTypeFields, CommandUId } from '../types'
import { AglynAppController } from './aglyn-app.controller'


export type AglynCommandResolverTypeFields = AglynTypeFields<typeof MODULE_TYPE, typeof COMMAND_RESOLVER_TYPE>
export type AglynCommandListenerTypeFields = AglynTypeFields<typeof MODULE_TYPE, typeof COMMAND_LISTENER_TYPE>

export type TriggerListenerPayload<T, U> = { payload: T, response: U }
export type AglynCommander = EmitterFn<Record<CommandUId, TriggerListenerPayload<any, any>>>


export interface AglynCommandResolver extends AglynCommandResolverTypeFields {
  commandId: CommandUId
  (data: Dictionary): any
}

export interface AglynCommandListener extends AglynCommandListenerTypeFields {
  commandId: CommandUId
  (data: TriggerListenerPayload<any, any>): void
}

export interface AglynCommandsControllerOptions extends AglynModuleModelOptions {
  handlers?: CommandsSetResolverPayload
}

export interface AglynCommandsController extends AglynModuleModel<AglynCommandsControllerOptions> {
  setResolver(data: CommandsSetResolverPayload): void
  registerListener(data: CommandRegisterListenerPayload): void
  removeResolver(data: CommandRemoveResolverPayload): void
  unregisterListener(data: CommandUnregisterListenerPayload): void
  trigger(data: CommandTriggerPayload): void
}

const TAG = 'AglynCommands'
const MODULE_NAME = 'commands'

export class AglynCommandsController extends AglynModuleModel<AglynCommandsControllerOptions> {

  public static readonly [Symbol.toStringTag]: string = TAG
  public static readonly namespace: string = `aglyn:${MODULE_NAME}`
  public static readonly moduleName: string = MODULE_NAME

  #commander: AglynCommander = EmitterFn()
  #resolvers: Map<CommandUId, AglynCommandResolver> = new Map()

  public get commander(): AglynCommander {
    return this.#commander
  }
  public get resolvers(): Map<CommandUId, AglynCommandResolver> {
    return this.#resolvers
  }

  constructor(app: AglynAppController, options: AglynCommandsControllerOptions) {
    super(app, options)
  }

  public toJSON() {
    return {
      ...super.toJSON(),
      commands: [...this.#commander.all.values()],
    }
  }

  public setResolver = (payload: CommandsSetResolverPayload): void => {
    const {resolver, commandId: cId} = payload
    const commandId = resolver?.commandId || cId
    if (_isFnT(resolver) && commandId) {
      this.#resolvers.set(commandId, resolver)
      this.getLogger().debug(AglynAppEventFlag.COMMAND_RESOLVER_SET, {commandId})
      this.getEmitter().emit(AglynAppEventFlag.COMMAND_RESOLVER_SET, {commandId})
    }
    else {
      // TODO: throw errorFactory error
    }
  }
  public registerListener = (payload: CommandRegisterListenerPayload): void => {
    const {listener, commandId: cId} = payload
    const commandId = listener?.commandId || cId
    if (commandId && _isFnT(listener)) {
      this.#commander.on(commandId, listener)
      this.getLogger().debug(AglynAppEventFlag.COMMAND_LISTENER_REGISTERED, {commandId})
      this.getEmitter().emit(AglynAppEventFlag.COMMAND_LISTENER_REGISTERED, {commandId})
    }
    else {
      // TODO: throw errorFactory error
    }
  }
  public unregisterListener = (payload: CommandUnregisterListenerPayload): void => {
    const {listener, commandId: cId} = payload
    const commandId = listener?.commandId || cId
    if (commandId) {
      this.#commander.off(commandId, listener)
      this.getLogger().debug(AglynAppEventFlag.COMMAND_LISTENER_UNREGISTERED, {commandId})
      this.getEmitter().emit(AglynAppEventFlag.COMMAND_LISTENER_UNREGISTERED, {commandId})
    }
    else {
      // TODO: throw errorFactory error
    }
  }
  public removeResolver = (payload: CommandRemoveResolverPayload): void => {
    const {commandId} = payload
    if (commandId) {
      this.#resolvers.delete(commandId)
      this.getLogger().debug(AglynAppEventFlag.COMMAND_RESOLVER_REMOVED, {commandId})
      this.getEmitter().emit(AglynAppEventFlag.COMMAND_RESOLVER_REMOVED, {commandId})
    }
    else {
      // TODO: throw errorFactory error
    }
  }
  public trigger = (payload: CommandTriggerPayload): void => {
    const {commandId} = payload
    const resolver = this.#resolvers.get(commandId)
    if (_isFnT(resolver)) {
      this.getLogger().debug(AglynAppEventFlag.COMMAND_RESOLVER_TRIGGERING, {commandId})
      this.getEmitter().emit(AglynAppEventFlag.COMMAND_RESOLVER_TRIGGERING, {commandId})
      const response = resolver(payload)
      this.getLogger().debug(AglynAppEventFlag.COMMAND_RESOLVER_TRIGGERED, {commandId})
      this.getEmitter().emit(AglynAppEventFlag.COMMAND_RESOLVER_TRIGGERED, {commandId})

      this.getLogger().debug(AglynAppEventFlag.COMMAND_LISTENERS_TRIGGERING, {commandId})
      this.getEmitter().emit(AglynAppEventFlag.COMMAND_LISTENERS_TRIGGERING, {commandId})
      this.#commander.emit(commandId, {payload, response})
      this.getLogger().debug(AglynAppEventFlag.COMMAND_LISTENERS_TRIGGERED, {commandId})
      this.getEmitter().emit(AglynAppEventFlag.COMMAND_LISTENERS_TRIGGERED, {commandId})
    }
    else {
      // TODO: throw errorFactory error
    }
  }


  protected listeners: AglynModuleEffectListener<any>[] = [
    [AglynAppEffectFlag.COMMANDS_RESOLVER_SET, this.setResolver],
    [AglynAppEffectFlag.COMMANDS_LISTENER_REGISTER, this.registerListener],
    [AglynAppEffectFlag.COMMANDS_RESOLVER_REMOVE, this.removeResolver],
    [AglynAppEffectFlag.COMMANDS_LISTENER_UNREGISTER, this.unregisterListener],
    [AglynAppEffectFlag.COMMANDS_TRIGGER, this.trigger],
  ]
}

export type AglynCommandsControllerT = typeof AglynCommandsController
export default AglynCommandsController
