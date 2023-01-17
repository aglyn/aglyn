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

import EventEmitter2, { type ConstructorOptions } from 'eventemitter2'

export enum AglynEvent {
  APP_INITIALIZING = 'lifecycle.app.initializing',
  APP_INITIALIZED = 'lifecycle.app.initialized',
  APP_ACTIVATING = 'lifecycle.app.activating',
  APP_ACTIVATED = 'lifecycle.app.activated',
  APP_DEACTIVATING = 'lifecycle.app.deactivating',
  APP_DEACTIVATED = 'lifecycle.app.deactivated',
  APP_DESTROYING = 'lifecycle.app.destroying',
  APP_DESTROYED = 'lifecycle.app.destroyed',

  COMPONENT_REGISTER = 'action.components.register',
  COMPONENT_REGISTERING = 'lifecycle.components.registering',
  COMPONENT_REGISTERED = 'lifecycle.components.registered',

  COMPONENT_UNREGISTER = 'action.components.unregister',
  COMPONENT_UNREGISTERING = 'lifecycle.components.unregistering',
  COMPONENT_UNREGISTERED = 'lifecycle.components.unregistered',

  PRESET_REGISTER = 'action.presets.register',
  PRESET_REGISTERING = 'lifecycle.presets.registering',
  PRESET_REGISTERED = 'lifecycle.presets.registered',

  PRESET_UNREGISTER = 'action.presets.unregister',
  PRESET_UNREGISTERING = 'lifecycle.presets.unregistering',
  PRESET_UNREGISTERED = 'lifecycle.presets.unregistered',

  PLUGIN_REGISTER = 'action.plugins.register',
  PLUGIN_UNREGISTERING = 'lifecycle.plugins.unregistering',
  PLUGIN_UNREGISTERED = 'lifecycle.plugins.unregistered',

  PLUGIN_UNREGISTER = 'action.plugins.unregister',
  PLUGIN_REGISTERING = 'lifecycle.plugins.registering',
  PLUGIN_REGISTERED = 'lifecycle.plugins.registered',

  NODE_CLEAR_ITEMS = 'action.nodes.clearItems',
  NODE_SET_ITEMS = 'action.nodes.setItems',
  NODE_SET = 'action.nodes.set',
  NODE_DELETE = 'action.nodes.delete',
  NODE_DUPLICATE = 'action.nodes.duplicate',
  NODE_REPARENT = 'action.nodes.reparent',

  ERROR_GENERAL = 'error.general',
}

export class EmitManager extends EventEmitter2 {
  constructor(options?: ConstructorOptions) {
    super(options)
  }
}

export default EmitManager
