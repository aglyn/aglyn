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

import { _INTERNAL_COMMANDS_ } from '../constants/_internal'
import {
  CommandRegisterListenerPayload,
  CommandRemoveResolverPayload,
  CommandsSetResolverPayload,
  CommandTriggerPayload,
  CommandUnregisterListenerPayload,
} from '../constants/emitter'
import { AglynAppController } from '../controllers/aglyn-app.controller'
import { AglynCommandsController } from '../controllers/aglyn-commands.controller'
import { _validateAppArg } from './app.api'


export function _getCommandController(app: AglynAppController): AglynCommandsController {
  _validateAppArg(app)
  return _INTERNAL_COMMANDS_.get(app.getName())
}


export function setCommandResolver(
  app: AglynAppController,
  data: CommandsSetResolverPayload,
): void {
  const commandController = _getCommandController(app)
  commandController.setResolver(data)
}

export function removeCommandResolver(
  app: AglynAppController,
  data: CommandRemoveResolverPayload,
): void {
  const commandController = _getCommandController(app)
  commandController.removeResolver(data)
}

export function registerCommandListener(
  app: AglynAppController,
  data: CommandRegisterListenerPayload,
): void {
  const commandController = _getCommandController(app)
  commandController.registerListener(data)
}

export function unregisterCommandListener(
  app: AglynAppController,
  data: CommandUnregisterListenerPayload,
): void {
  const commandController = _getCommandController(app)
  commandController.unregisterListener(data)
}

export function triggerCommand(
  app: AglynAppController,
  data: CommandTriggerPayload,
): void {
  const commandController = _getCommandController(app)
  commandController.trigger(data)
}
