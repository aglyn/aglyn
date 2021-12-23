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

import {EmitterFn} from '@aglyn/shared-util-emitter'
import {_isFnT} from '@aglyn/shared-util-guards'
import type {
  CommandRegisterListenerPayload,
  CommandRemoveResolverPayload,
  CommandsSetResolverPayload,
  CommandTriggerPayload,
  CommandUnregisterListenerPayload,
} from '../constants/emitter'
import {AglynAppEffectFlag, AglynAppEventFlag} from '../constants/emitter'
import AglynModuleModel from '../models/aglyn-module.model'
import type {AglynModuleEffectListener} from '../models/aglyn-module.types'
import type {CommandUId} from '../types'
import type {IAglynAppController} from './aglyn-app.types'
import type {
  AglynCommander,
  AglynCommandResolver,
  AglynCommandsControllerOptions,
  IAglynCommandsController,
} from './aglyn-commands.types'


const TAG = 'AglynCommands'
const MODULE_NAME = 'commands'

export class AglynCommandsController extends AglynModuleModel<AglynCommandsControllerOptions> implements IAglynCommandsController {

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

  constructor(app: IAglynAppController, options: AglynCommandsControllerOptions) {
    super(app, options)
  }

  public toJSON() {
    return {
      ...super.toJSON(),
      commands: [...this.#commander.all.values()],
    }
  }

  public setResolver(payload: CommandsSetResolverPayload): void {
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
  public registerListener(payload: CommandRegisterListenerPayload): void {
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
  public unregisterListener(payload: CommandUnregisterListenerPayload): void {
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
  public removeResolver(payload: CommandRemoveResolverPayload): void {
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
  public trigger(payload: CommandTriggerPayload): void {
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

export default AglynCommandsController
