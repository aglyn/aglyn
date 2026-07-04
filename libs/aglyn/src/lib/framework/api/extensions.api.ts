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

import {
  _INTERNAL_EXTENSIONS_,
  AglynEventTriggerFlag,
  type AglynEventTriggerPayload,
  type IAglynAppController,
  type IAglynExtension,
  type IAglynExtensionsController,
} from '../../foundation'
import { _validateAppArg } from './app.api'

export function _getExtensionController(
  app: IAglynAppController,
): IAglynExtensionsController {
  _validateAppArg(app)
  return _INTERNAL_EXTENSIONS_.get(app.getName())
}

export function getExtension<T extends IAglynExtension>(
  app: IAglynAppController,
  data: { name: string },
): T {
  const { name } = data
  const extensionController = _getExtensionController(app)
  return extensionController.getExtensionByName(name) as T
}
export function getExtensions(app: IAglynAppController): ReadonlyArray<IAglynExtension> {
  const extensionController = _getExtensionController(app)
  return extensionController.getAllExtensions()
}
export function registerExtension(
  app: IAglynAppController,
  data: AglynEventTriggerPayload[AglynEventTriggerFlag.EXTENSION_REGISTER],
): void {
  const extensionController = _getExtensionController(app)
  extensionController.registerExtension(data)
}
export function unregisterExtension(
  app: IAglynAppController,
  data: AglynEventTriggerPayload[AglynEventTriggerFlag.EXTENSION_DESTROY],
): void {
  const extensionController = _getExtensionController(app)
  extensionController.destroyExtension(data)
}
export function loadExtension(
  app: IAglynAppController,
  data: AglynEventTriggerPayload[AglynEventTriggerFlag.EXTENSION_ACTIVATE],
) {
  const extensionController = _getExtensionController(app)
  extensionController.activateExtension(data)
}
export function unloadExtension(
  app: IAglynAppController,
  data: AglynEventTriggerPayload[AglynEventTriggerFlag.EXTENSION_DEACTIVATE],
) {
  const extensionController = _getExtensionController(app)
  extensionController.activateExtension(data)
}
