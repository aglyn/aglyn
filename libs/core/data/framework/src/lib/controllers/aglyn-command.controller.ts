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

import { Mitt } from '@aglyn/shared-util-vendor'
import {
  AglynAppEventFlag,
  AglynModuleActionFlag,
  AglynModuleActionPayload,
} from '../constants/emitter'
import { COMMAND_TYPE, MODULE_TYPE } from '../constants/symbol'
import type { AglynAppController } from '../controllers/aglyn-app.controller'
import { AglynBaseModel } from '../models/aglyn-base.model'
import {
  AglynCommander,
  AglynCommandParams,
  AglynRegisters,
  AglynTypeFields,
  AglynUniqueId,
} from '../types'


const TAG = 'AglynCommandController'

export type AglynCommandTypeFields = AglynTypeFields<typeof MODULE_TYPE, typeof COMMAND_TYPE>

export interface AglynCommandHandler extends AglynUniqueId, AglynCommandTypeFields {
  (data: AglynCommandParams['*']): void
}

export interface AglynCommandController extends AglynBaseModel {
  executeCommand(data: AglynModuleActionPayload[AglynModuleActionFlag.COMMAND_TRIGGER]): void
  resolveCommand(data: AglynModuleActionPayload[AglynModuleActionFlag.COMMAND_ACTION_REGISTER]): void
  unregisterAction(data: AglynModuleActionPayload[AglynModuleActionFlag.COMMAND_ACTION_UNREGISTER]): void
}

export class AglynCommandController extends AglynBaseModel {

  public static readonly [Symbol.toStringTag]: string = TAG

  protected app: AglynAppController
  #commander: AglynCommander = Mitt()

  constructor(props: { app: AglynAppController }) {
    super()
    const {app} = props
    this.app = app
    this.#initialize()
  }
  #initialize() {
    this.setErrorFactory(this.app.getErrorFactory())
    this.setEmitter(this.app.getEmitter())
    this.setLogger(this.app.getLogger())
  }

  public onInit = (): void => {
    this.listeners.forEach(([flag, method]) => this.app.getEmitter().on(flag, method))
  }
  public onDestroy = (): void => {
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
  public resolveCommand = (
    data: AglynModuleActionPayload[AglynModuleActionFlag.COMMAND_ACTION_REGISTER],
  ): void => {
    const {handler} = data
    const commandId = handler?.$id
    this.#commander.on(commandId, handler)
    this.getLogger().debug(AglynAppEventFlag.REGISTERED_COMMAND, {commandId})
    this.getEmitter().emit(AglynAppEventFlag.REGISTERED_COMMAND, {commandId})
  }
  public unregisterAction = (
    data: AglynModuleActionPayload[AglynModuleActionFlag.COMMAND_ACTION_UNREGISTER],
  ): void => {
    const {handler} = data
    const commandId = handler?.$id
    this.#commander.off(commandId, handler)
    this.getLogger().debug(AglynAppEventFlag.UNREGISTERED_COMMAND, {commandId})
    this.getEmitter().emit(AglynAppEventFlag.UNREGISTERED_COMMAND, {commandId})
  }
  public executeCommand = (
    data: AglynModuleActionPayload[AglynModuleActionFlag.COMMAND_TRIGGER],
  ): void => {
    const {commandId} = data
    this.#commander.emit(commandId, {app: this.app})
    this.getLogger().debug(AglynAppEventFlag.TRIGGERED_COMMAND, {commandId})
    this.getEmitter().emit(AglynAppEventFlag.TRIGGERED_COMMAND, {commandId})
  }


  private listeners: [AglynModuleActionFlag, (...args: any[]) => unknown][] = [
    [AglynModuleActionFlag.COMMAND_ACTION_REGISTER, this.resolveCommand],
    [AglynModuleActionFlag.COMMAND_ACTION_UNREGISTER, this.unregisterAction],
    [AglynModuleActionFlag.COMMAND_TRIGGER, this.executeCommand],
  ]
}

export default AglynCommandController
