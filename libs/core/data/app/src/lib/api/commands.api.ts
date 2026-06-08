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

import type {
  CommandsRegisterListenerPayload,
  CommandsRemoveResolverPayload,
  CommandsSetResolverPayload,
  CommandsTriggerPayload,
  CommandsUnregisterListenerPayload,
  IAglynAppController,
  IAglynCommandsController,
} from '@aglyn/core-data-foundation'
import { _INTERNAL_COMMANDS_ } from '@aglyn/core-data-foundation'
import { _validateAppArg } from './app.api'

export function _getCommandController(
  app: IAglynAppController,
): IAglynCommandsController {
  _validateAppArg(app)
  return _INTERNAL_COMMANDS_.get(app.getName())
}

export function setCommandResolver(
  app: IAglynAppController,
  data: CommandsSetResolverPayload,
): void {
  const commandController = _getCommandController(app)
  commandController.setResolver(data)
}

export function removeCommandResolver(
  app: IAglynAppController,
  data: CommandsRemoveResolverPayload,
): void {
  const commandController = _getCommandController(app)
  commandController.removeResolver(data)
}

export function registerCommandListener(
  app: IAglynAppController,
  data: CommandsRegisterListenerPayload,
): void {
  const commandController = _getCommandController(app)
  commandController.registerListener(data)
}

export function unregisterCommandListener(
  app: IAglynAppController,
  data: CommandsUnregisterListenerPayload,
): void {
  const commandController = _getCommandController(app)
  commandController.unregisterListener(data)
}

export function triggerCommand(
  app: IAglynAppController,
  data: CommandsTriggerPayload,
): void {
  const commandController = _getCommandController(app)
  commandController.trigger(data)
}
