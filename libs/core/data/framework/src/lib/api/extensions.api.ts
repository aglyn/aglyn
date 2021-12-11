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

import { _INTERNAL_EXTENSIONS_ } from '../constants/_internal'
import { AglynAppEffectFlag, AglynModuleEffectPayload } from '../constants/emitter'
import { AglynAppController } from '../controllers/aglyn-app.controller'
import { AglynExtensionsController } from '../controllers/aglyn-extensions.controller'
import { AglynExtension } from '../models/aglyn-extension.model'
import { _validateAppArg } from './app.api'


export function _getExtensionController(app: AglynAppController): AglynExtensionsController {
  _validateAppArg(app)
  return _INTERNAL_EXTENSIONS_.get(app.getName())
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
  data: AglynModuleEffectPayload[AglynAppEffectFlag.EXTENSION_REGISTER],
): void {
  const extensionController = _getExtensionController(app)
  extensionController.registerExtension(data)
}
export function unregisterExtension(
  app: AglynAppController,
  data: AglynModuleEffectPayload[AglynAppEffectFlag.EXTENSION_DESTROY],
): void {
  const extensionController = _getExtensionController(app)
  extensionController.destroyExtension(data)
}
export function loadExtension(
  app: AglynAppController,
  data: AglynModuleEffectPayload[AglynAppEffectFlag.EXTENSION_LOAD],
) {
  const extensionController = _getExtensionController(app)
  extensionController.loadExtension(data)
}
export function unloadExtension(
  app: AglynAppController,
  data: AglynModuleEffectPayload[AglynAppEffectFlag.EXTENSION_UNLOAD],
) {
  const extensionController = _getExtensionController(app)
  extensionController.loadExtension(data)
}
