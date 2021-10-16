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

import { _commandControllers } from '../constants/_internal'
import { AglynModuleActionFlag, AglynModuleActionPayload } from '../constants/emitter'
import { AglynAppController } from '../controllers/aglyn-app.controller'
import { AglynCommandController } from '../controllers/aglyn-command.controller'
import { validateAppArg } from './app.api'


export function _getCommandController(app: AglynAppController): AglynCommandController {
  validateAppArg(app)
  return _commandControllers.get(app.getName())
}
export function registerCommand(
  app: AglynAppController,
  data: AglynModuleActionPayload[AglynModuleActionFlag.COMMAND_ACTION_REGISTER],
): void {
  const commandController = _getCommandController(app)
  commandController.registerAction(data)
}
export function unregisterAction(
  app: AglynAppController,
  data: AglynModuleActionPayload[AglynModuleActionFlag.COMMAND_ACTION_UNREGISTER],
): void {
  const commandController = _getCommandController(app)
  commandController.unregisterAction(data)
}
export function triggerCommand(
  app: AglynAppController,
  data: AglynModuleActionPayload[AglynModuleActionFlag.COMMAND_TRIGGER],
): void {
  const commandController = _getCommandController(app)
  commandController.executeCommand(data)
}
