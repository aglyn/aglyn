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

import { Dictionary } from '@aglyn/shared-data-types'
import { _isFnT } from '@aglyn/shared-util-guards'
import { Mitt } from '@aglyn/shared-util-vendor'
import { Emitter } from 'mitt'
import {
  AglynAppEffectFlag,
  AglynAppEventFlag,
  CommandRegisterListener,
  CommandRegisterResolver,
  CommandTriggerPayload,
  CommandUnregisterListener,
  CommandUnregisterResolver,
} from '../constants/emitter'
import { COMMAND_LISTENER_TYPE, COMMAND_RESOLVER_TYPE, MODULE_TYPE } from '../constants/symbol'
import { AglynModuleEffectListener, AglynModuleModel } from '../models/aglyn-module.model'
import { AglynTypeFields, PayloadData } from '../types'
import { CommandUId } from './aglyn-components.controller'


export type AglynCommandResolverTypeFields = AglynTypeFields<typeof MODULE_TYPE, typeof COMMAND_RESOLVER_TYPE>
export type AglynCommandListenerTypeFields = AglynTypeFields<typeof MODULE_TYPE, typeof COMMAND_LISTENER_TYPE>

export type AglynCommander = Emitter<AglynCommandParams>

export enum AglynCommandFlag {
  ANY = '*',
}

export type AglynCommandParams = {
  [P in CommandUId | '*' | keyof AglynCommandFlag]: PayloadData<Dictionary>
}

export interface AglynCommandResolver extends AglynCommandResolverTypeFields {
  commandId: CommandUId
  (data: Dictionary): any
}

export interface AglynCommandListener extends AglynCommandListenerTypeFields {
  commandId: CommandUId
  (data: { request: Dictionary, response: Dictionary }): void
}

export interface AglynCommandsController extends AglynModuleModel {
  setResolver(data: CommandRegisterResolver): void
  registerListener(data: CommandRegisterListener): void
  removeResolver(data: CommandUnregisterResolver): void
  unregisterListener(data: CommandUnregisterListener): void
  trigger(data: CommandTriggerPayload): void
}

const TAG = 'AglynCommands'

export class AglynCommandsController extends AglynModuleModel {

  public static readonly [Symbol.toStringTag]: string = TAG

  public readonly moduleName: string = TAG

  #commander: AglynCommander = Mitt()
  #resolvers: Map<CommandUId, AglynCommandResolver> = new Map()

  public get commander(): AglynCommander {
    return this.#commander
  }
  public get resolvers(): Map<CommandUId, AglynCommandResolver> {
    return this.#resolvers
  }

  constructor(options) {super(options)}

  public toString(): string {
    return `${TAG}(app: '${this.app.getName()}')`
  }
  public toJSON() {
    return {
      ...super.toJSON(),
      commands: [...this.#commander.all.values()],
    }
  }

  public setResolver = (
    data: CommandRegisterResolver,
  ): void => {
    const {resolver, commandId: cId} = data
    const commandId = resolver?.commandId || cId
    if (_isFnT(resolver) && commandId) {
      this.#resolvers.set(commandId, resolver)
      this.getLogger().debug(AglynAppEventFlag.COMMAND_REGISTERED_RESOLVER, {commandId})
      this.getEmitter().emit(AglynAppEventFlag.COMMAND_REGISTERED_RESOLVER, {commandId})
    }
    else {
      // TODO: throw errorFactory error
    }
  }
  public registerListener = (
    data: CommandRegisterListener,
  ): void => {
    const {listener, commandId: cId} = data
    const commandId = listener?.commandId || cId
    if (commandId && _isFnT(listener)) {
      this.#commander.on(commandId, listener)
      this.getLogger().debug(AglynAppEventFlag.COMMAND_REGISTERED_LISTENER, {commandId})
      this.getEmitter().emit(AglynAppEventFlag.COMMAND_REGISTERED_LISTENER, {commandId})
    }
    else {
      // TODO: throw errorFactory error
    }
  }
  public unregisterListener = (
    data: CommandUnregisterListener,
  ): void => {
    const {listener, commandId: cId} = data
    const commandId = listener?.commandId || cId
    if (commandId) {
      this.#commander.off(commandId, listener)
      this.getLogger().debug(AglynAppEventFlag.COMMAND_UNREGISTERED_LISTENER, {commandId})
      this.getEmitter().emit(AglynAppEventFlag.COMMAND_UNREGISTERED_LISTENER, {commandId})
    }
    else {
      // TODO: throw errorFactory error
    }
  }
  public removeResolver = (
    data: CommandUnregisterResolver,
  ): void => {
    const {commandId} = data
    if (commandId) {
      this.#resolvers.delete(commandId)
      this.getLogger().debug(AglynAppEventFlag.COMMAND_UNREGISTERED_RESOLVER, {commandId})
      this.getEmitter().emit(AglynAppEventFlag.COMMAND_UNREGISTERED_RESOLVER, {commandId})
    }
    else {
      // TODO: throw errorFactory error
    }
  }
  public trigger = (
    data: CommandTriggerPayload,
  ): void => {
    const {commandId} = data
    const resolver = this.#resolvers.get(commandId)
    if (_isFnT(resolver)) {
      const resolved = resolver(data)
      this.getLogger().debug(AglynAppEventFlag.COMMAND_TRIGGERED_RESOLVER, {commandId})
      this.getEmitter().emit(AglynAppEventFlag.COMMAND_TRIGGERED_RESOLVER, {commandId})

      this.#commander.emit(commandId, {data, resolved})
      this.getLogger().debug(AglynAppEventFlag.COMMAND_TRIGGERED_LISTENER, {commandId})
      this.getEmitter().emit(AglynAppEventFlag.COMMAND_TRIGGERED_LISTENER, {commandId})
    }
    else {
      // TODO: throw errorFactory error
    }
  }


  protected listeners: AglynModuleEffectListener<any>[] = [
    [AglynAppEffectFlag.COMMAND_ACTION_REGISTER_RESOLVER, this.setResolver],
    [AglynAppEffectFlag.COMMAND_ACTION_REGISTER_LISTENER, this.registerListener],
    [AglynAppEffectFlag.COMMAND_ACTION_UNREGISTER_RESOLVER, this.removeResolver],
    [AglynAppEffectFlag.COMMAND_ACTION_UNREGISTER_LISTENER, this.unregisterListener],
    [AglynAppEffectFlag.COMMAND_TRIGGER, this.trigger],
  ]
}

export type AglynCommandsControllerT = typeof AglynCommandsController
export default AglynCommandsController
