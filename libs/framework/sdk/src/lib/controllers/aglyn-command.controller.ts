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

import {
  AglynAppEventFlag,
  AglynAppInstance,
  AglynCommandControllerInstance,
  AglynCommander,
  AglynModuleTriggerFlag,
  AglynModuleTriggerParams,
} from '@aglyn/framework/sdk'
import { Mitt } from '@aglyn/shared/util/helpers'
import { AglynBaseModel } from '../models/aglyn-base.model'


const TAG = 'AglynCommandController'

export class AglynCommandController extends AglynBaseModel implements AglynCommandControllerInstance {

  public static readonly [Symbol.toStringTag]: string = TAG
  protected app: AglynAppInstance
  #commander: AglynCommander = Mitt()

  constructor(props: { app: AglynAppInstance }) {
    super()
    const {app} = props
    this.app = app
    this.initialize()
  }
  private initialize = () => {
    this.setErrorFactory(this.app.getErrorFactory())
    this.setEmitter(this.app.getEmitter())
    this.setLogger(this.app.getLogger())
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
  public onInit = (): void => {
    this.getEmitter().on(AglynModuleTriggerFlag.COMMAND_ACTION_REGISTER, this.registerAction)
    this.getEmitter().on(AglynModuleTriggerFlag.COMMAND_ACTION_UNREGISTER, this.unregisterAction)
    this.getEmitter().on(AglynModuleTriggerFlag.COMMAND_TRIGGER, this.executeCommand)
  }
  public onDestroy = (): void => {
    this.getEmitter().off(AglynModuleTriggerFlag.COMMAND_ACTION_REGISTER, this.registerAction)
    this.getEmitter().off(AglynModuleTriggerFlag.COMMAND_ACTION_UNREGISTER, this.unregisterAction)
    this.getEmitter().off(AglynModuleTriggerFlag.COMMAND_TRIGGER, this.executeCommand)
  }
  public getCommander = (): AglynCommander => {
    return this.#commander
  }
  public registerAction = (
    data: AglynModuleTriggerParams[AglynModuleTriggerFlag.COMMAND_ACTION_REGISTER],
  ): void => {
    const {handler} = data
    const commandId = handler?.$id
    this.#commander.on(commandId, handler)
    this.getLogger().debug(AglynAppEventFlag.REGISTERED_COMMAND, {commandId})
    this.getEmitter().emit(AglynAppEventFlag.REGISTERED_COMMAND, {commandId})
  }
  public unregisterAction = (
    data: AglynModuleTriggerParams[AglynModuleTriggerFlag.COMMAND_ACTION_UNREGISTER],
  ): void => {
    const {handler} = data
    const commandId = handler?.$id
    this.#commander.off(commandId, handler)
    this.getLogger().debug(AglynAppEventFlag.UNREGISTERED_COMMAND, {commandId})
    this.getEmitter().emit(AglynAppEventFlag.UNREGISTERED_COMMAND, {commandId})
  }
  public executeCommand = (
    data: AglynModuleTriggerParams[AglynModuleTriggerFlag.COMMAND_TRIGGER],
  ): void => {
    const {commandId} = data
    this.#commander.emit(commandId, {app: this.app})
    this.getLogger().debug(AglynAppEventFlag.TRIGGERED_COMMAND, {commandId})
    this.getEmitter().emit(AglynAppEventFlag.TRIGGERED_COMMAND, {commandId})
  }
}
