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
  AglynAppEventFlag,
  AglynModuleActionFlag,
  AglynModuleActionPayload,
} from '../constants/emitter'
import { AglynCommandFlag } from '../constants/enums'
import { COMMAND_TYPE, MODULE_TYPE } from '../constants/symbol'
import type { AglynAppController } from '../controllers/aglyn-app.controller'
import { AglynBaseModel } from '../models/aglyn-base.model'
import { AglynTypeFields, AglynUniqueId, PayloadData } from '../types'


const TAG = 'AglynCommandController'

export type AglynCommandTypeFields = AglynTypeFields<typeof MODULE_TYPE, typeof COMMAND_TYPE>

export type AglynCommander = Emitter<AglynCommandParams>
export type AglynCommandParams = {
  [P in string | '*' | keyof AglynCommandFlag]: PayloadData<Dictionary>
}

export interface AglynCommandResolver extends AglynUniqueId, AglynCommandTypeFields {
  (data: Dictionary): any
}

export interface AglynCommandHandler extends AglynUniqueId, AglynCommandTypeFields {
  (data: { data: Dictionary, resolved: Dictionary }): void
}

export interface AglynCommandController extends AglynBaseModel {
  setResolver(data: AglynModuleActionPayload[AglynModuleActionFlag.COMMAND_ACTION_REGISTER_RESOLVER]): void
  onResolve(data: AglynModuleActionPayload[AglynModuleActionFlag.COMMAND_ACTION_REGISTER_LISTENER]): void
  executeCommand(data: AglynModuleActionPayload[AglynModuleActionFlag.COMMAND_TRIGGER]): void
  unregisterListener(data: AglynModuleActionPayload[AglynModuleActionFlag.COMMAND_ACTION_UNREGISTER_LISTENER]): void
  unregisterResolver(data: AglynModuleActionPayload[AglynModuleActionFlag.COMMAND_ACTION_UNREGISTER_RESOLVER]): void
}

export class AglynCommandController extends AglynBaseModel {

  public static readonly [Symbol.toStringTag]: string = TAG

  protected app: AglynAppController
  #commander: AglynCommander = Mitt()
  #resolvers: Dictionary<AglynCommandResolver> = {}

  constructor(props: { app: AglynAppController }) {
    super()
    const {app} = props
    this.app = app
    this.#setup()
  }
  #setup() {
    this.setErrorFactory(this.app.getErrorFactory())
    this.setEmitter(this.app.getEmitter())
    this.setLogger(this.app.getLogger())
  }

  public aglynOnInit = (): void => {
    this.listeners.forEach(([flag, method]) => this.app.getEmitter().on(flag, method))
  }
  public aglynOnDestroy = (): void => {
    this.listeners.forEach(([flag, method]) => this.app.getEmitter().off(flag, method))
  }

  public toString = (): string => {
    return `${TAG}(app: '${this.app.getName()}')`
  }
  public toJSON = () => {
    return {
      ...super.toJSON(),
      commands: [...this.#commander.all.values()],
    }
  }

  public getCommander = (): AglynCommander => {
    return this.#commander
  }
  public setResolver = (
    data: AglynModuleActionPayload[AglynModuleActionFlag.COMMAND_ACTION_REGISTER_RESOLVER],
  ): void => {
    const {handler} = data
    const commandId = handler?.$id
    this.#resolvers[commandId] = handler
    this.getLogger().debug(AglynAppEventFlag.REGISTERED_COMMAND_RESOLVER, {commandId})
    this.getEmitter().emit(AglynAppEventFlag.REGISTERED_COMMAND_RESOLVER, {commandId})
  }
  public onResolve = (
    data: AglynModuleActionPayload[AglynModuleActionFlag.COMMAND_ACTION_REGISTER_LISTENER],
  ): void => {
    const {handler} = data
    const commandId = handler?.$id
    this.#commander.on(commandId, handler)
    this.getLogger().debug(AglynAppEventFlag.REGISTERED_COMMAND_LISTENER, {commandId})
    this.getEmitter().emit(AglynAppEventFlag.REGISTERED_COMMAND_LISTENER, {commandId})
  }
  public executeCommand = (
    data: AglynModuleActionPayload[AglynModuleActionFlag.COMMAND_TRIGGER],
  ): void => {
    const {commandId} = data
    const resolver = this.#resolvers[commandId]
    if (_isFnT(resolver)) {
      const resolved = resolver.call(undefined, data)
      this.getLogger().debug(AglynAppEventFlag.TRIGGERED_COMMAND_RESOLVER, {commandId})
      this.getEmitter().emit(AglynAppEventFlag.TRIGGERED_COMMAND_RESOLVER, {commandId})

      this.#commander.emit(`listener:${commandId}`, {data, resolved})
      this.getLogger().debug(AglynAppEventFlag.TRIGGERED_COMMAND_LISTENER, {commandId})
      this.getEmitter().emit(AglynAppEventFlag.TRIGGERED_COMMAND_LISTENER, {commandId})
    }
  }
  public unregisterListener = (
    data: AglynModuleActionPayload[AglynModuleActionFlag.COMMAND_ACTION_UNREGISTER_LISTENER],
  ): void => {
    const {handler} = data
    const commandId = handler?.$id
    this.#commander.off(commandId, handler)
    this.getLogger().debug(AglynAppEventFlag.UNREGISTERED_COMMAND_LISTENER, {commandId})
    this.getEmitter().emit(AglynAppEventFlag.UNREGISTERED_COMMAND_LISTENER, {commandId})
  }
  public unregisterResolver = (
    data: AglynModuleActionPayload[AglynModuleActionFlag.COMMAND_ACTION_UNREGISTER_RESOLVER],
  ): void => {
    const {handler} = data
    const commandId = handler?.$id
    delete this.#resolvers[commandId]
    this.getLogger().debug(AglynAppEventFlag.UNREGISTERED_COMMAND_RESOLVER, {commandId})
    this.getEmitter().emit(AglynAppEventFlag.UNREGISTERED_COMMAND_RESOLVER, {commandId})
  }


  private listeners: [AglynModuleActionFlag, (...args: any[]) => unknown][] = [
    [AglynModuleActionFlag.COMMAND_ACTION_REGISTER_RESOLVER, this.setResolver],
    [AglynModuleActionFlag.COMMAND_ACTION_REGISTER_LISTENER, this.onResolve],
    [AglynModuleActionFlag.COMMAND_ACTION_UNREGISTER_RESOLVER, this.unregisterResolver],
    [AglynModuleActionFlag.COMMAND_ACTION_UNREGISTER_LISTENER, this.unregisterListener],
    [AglynModuleActionFlag.COMMAND_TRIGGER, this.executeCommand],
  ]
}

export default AglynCommandController
