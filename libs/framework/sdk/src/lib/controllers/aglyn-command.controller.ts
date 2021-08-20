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
  AglynApp,
  AglynAppEventFlag,
  AglynCommandController,
  AglynCommander, AglynEmitter, AglynExtensionMap, AglynLogger,
  AglynModuleTriggerFlag,
  AglynModuleTriggerParams,
} from '@aglyn/framework/sdk'
import { Mitt } from '@aglyn/shared/util/helpers'


const TAG = 'AglynCommandController'

export class AglynAppCommandController implements AglynCommandController {

  protected app: AglynApp
  protected appEvent: AglynEmitter
  protected appLogger: AglynLogger
  protected commander: AglynCommander = Mitt()

  constructor(props: {
    app: AglynApp
  }) {
    const {app} = props
    this.app = app
    this.appEvent = app.event
    this.appLogger = app.log
  }

  registerAction = (
    data: AglynModuleTriggerParams[AglynModuleTriggerFlag.COMMAND_ACTION_REGISTER],
  ): void => {
    const {handler} = data
    const commandId = handler?.$id
    this.commander.on(commandId, handler)
    this.appLogger.debug(AglynAppEventFlag.REGISTERED_COMMAND, {commandId})
    this.appEvent.emit(AglynAppEventFlag.REGISTERED_COMMAND, {commandId})
  }
  unregisterAction = (
    data: AglynModuleTriggerParams[AglynModuleTriggerFlag.COMMAND_ACTION_UNREGISTER],
  ): void => {
    const {handler} = data
    const commandId = handler?.$id
    this.commander.off(commandId, handler)
    this.appLogger.debug(AglynAppEventFlag.UNREGISTERED_COMMAND, {commandId})
    this.appEvent.emit(AglynAppEventFlag.UNREGISTERED_COMMAND, {commandId})
  }
  executeCommand = (
    data: AglynModuleTriggerParams[AglynModuleTriggerFlag.COMMAND_TRIGGER],
  ): void => {
    const {commandId} = data
    this.commander.emit(commandId, {app: this.app})
    this.appLogger.debug(AglynAppEventFlag.TRIGGERED_COMMAND, {commandId})
    this.appEvent.emit(AglynAppEventFlag.TRIGGERED_COMMAND, {commandId})
  }
  get [Symbol.toStringTag as any]() {
    return `${TAG}`
  }
  toString = () => {
    return `${TAG}(app: '${this.app.getName()}')`
  }

  toJSON = () => {
    return {
      commands: [...this.commander.all.values()],
    }
  }
  onInit = () => {
    this.appEvent.on(AglynModuleTriggerFlag.COMMAND_ACTION_REGISTER, this.registerAction)
    this.appEvent.on(AglynModuleTriggerFlag.COMMAND_ACTION_UNREGISTER, this.unregisterAction)
    this.appEvent.on(AglynModuleTriggerFlag.COMMAND_TRIGGER, this.executeCommand)
  }
  onDestroy = () => {
    this.appEvent.off(AglynModuleTriggerFlag.COMMAND_ACTION_REGISTER, this.registerAction)
    this.appEvent.off(AglynModuleTriggerFlag.COMMAND_ACTION_UNREGISTER, this.unregisterAction)
    this.appEvent.off(AglynModuleTriggerFlag.COMMAND_TRIGGER, this.executeCommand)
  }
}
