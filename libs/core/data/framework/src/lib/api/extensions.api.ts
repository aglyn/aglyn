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

import { _extensionControllers } from '../constants/_internal'
import { AglynModuleActionFlag, AglynModuleActionPayload } from '../constants/emitter'
import { AglynAppController } from '../controllers/aglyn-app.controller'
import { AglynExtensionController } from '../controllers/aglyn-extension.controller'
import { AglynExtension } from '../models/aglyn-extension.model'
import { validateAppArg } from './app.api'


export function _getExtensionController(app: AglynAppController): AglynExtensionController {
  validateAppArg(app)
  return _extensionControllers.get(app.getName())
}
export function getExtension<T extends AglynExtension>(app: AglynAppController, data: { name: string }): T {
  const {name} = data
  const extensionController = _getExtensionController(app)
  return extensionController.getExtensionByName(name) as T
}
export function getExtensions(app: AglynAppController): AglynExtension[] {
  const extensionController = _getExtensionController(app)
  return extensionController.getAllExtensions()
}
export function registerExtension(
  app: AglynAppController,
  data: AglynModuleActionPayload[AglynModuleActionFlag.EXTENSION_REGISTER],
): void {
  const extensionController = _getExtensionController(app)
  extensionController.registerExtension(data)
}
export function unregisterExtension(
  app: AglynAppController,
  data: AglynModuleActionPayload[AglynModuleActionFlag.EXTENSION_UNREGISTER],
): void {
  const extensionController = _getExtensionController(app)
  extensionController.unregisterExtension(data)
}
export function loadExtension(
  app: AglynAppController,
  data: AglynModuleActionPayload[AglynModuleActionFlag.EXTENSION_LOAD],
) {
  const extensionController = _getExtensionController(app)
  extensionController.loadExtension(data)
}
export function unloadExtension(
  app: AglynAppController,
  data: AglynModuleActionPayload[AglynModuleActionFlag.EXTENSION_UNLOAD],
) {
  const extensionController = _getExtensionController(app)
  extensionController.loadExtension(data)
}
