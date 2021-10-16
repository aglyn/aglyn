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
import type { AglynAppController } from '../controllers/aglyn-app.controller'
import type { AglynComponentsController } from '../controllers/aglyn-components.controller'
import type { AglynExtensionController } from '../controllers/aglyn-extension.controller'
import type { AglynCommandController } from '../controllers/aglyn-command.controller'

export const _apps: Map<string, AglynAppController> = new Map()
export const _extensionControllers: Map<string, AglynExtensionController> = new Map()
export const _commandControllers: Map<string, AglynCommandController> = new Map()
export const _componentsControllers: Map<string, AglynComponentsController> = new Map()
