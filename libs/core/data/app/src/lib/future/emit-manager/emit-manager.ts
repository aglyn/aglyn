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

import { Timestamp } from '@aglyn/shared-util-timestamp'
import { EventEmitter2 } from 'eventemitter2'
import { logger } from '../log-manager/index'
import { emitter } from './index'

export function lifecycleEvent(
  callbackFn: () => void,
  options: {
    startEvent: AglynEvent
    startPayload: any[]
    endEvent: AglynEvent
    endPayload: any[]
    onCatch?: (e: unknown) => void
  },
): void {
  const { startEvent, startPayload, endEvent, endPayload, onCatch } = options
  logger.debug(Timestamp.now().toJSON(), startEvent, startPayload)
  emitter.emit(startEvent, Timestamp.now().toJSON(), ...startPayload)
  try {
    callbackFn()
  } catch (e) {
    logger.error(Timestamp.now().toJSON(), startEvent, startPayload, e)
    onCatch && onCatch(e)
  } finally {
    logger.debug(Timestamp.now().toJSON(), startEvent, startPayload)
    emitter.emit(endEvent, Timestamp.now().toJSON(), ...endPayload)
  }
}

export enum AglynEvent {
  APP_INITIALIZING = 'lifecycle.app.initializing',
  APP_INITIALIZED = 'lifecycle.app.initialized',
  APP_ACTIVATING = 'lifecycle.app.activating',
  APP_ACTIVATED = 'lifecycle.app.activated',
  APP_DEACTIVATING = 'lifecycle.app.deactivating',
  APP_DEACTIVATED = 'lifecycle.app.deactivated',
  APP_DESTROYING = 'lifecycle.app.destroying',
  APP_DESTROYED = 'lifecycle.app.destroyed',

  COMPONENT_REGISTERING = 'lifecycle.components.component.registering',
  COMPONENT_REGISTERED = 'lifecycle.components.component.registered',
  COMPONENT_UNREGISTERING = 'lifecycle.components.component.unregistering',
  COMPONENT_UNREGISTERED = 'lifecycle.components.component.unregistered',
  COMPONENT_BUNDLE_REGISTERING = 'lifecycle.components.bundle.registering',
  COMPONENT_BUNDLE_REGISTERED = 'lifecycle.components.bundle.registered',
  COMPONENT_BUNDLE_UNREGISTERING = 'lifecycle.components.bundle.unregistering',
  COMPONENT_BUNDLE_UNREGISTERED = 'lifecycle.components.bundle.unregistered',
  COMPONENT_PRESET_REGISTERING = 'lifecycle.components.preset.registering',
  COMPONENT_PRESET_REGISTERED = 'lifecycle.components.preset.registered',
  COMPONENT_PRESET_UNREGISTERING = 'lifecycle.components.preset.unregistering',
  COMPONENT_PRESET_UNREGISTERED = 'lifecycle.components.preset.unregistered',

  REGISTER_COMPONENT = 'action.components.component.register',
}

export class EmitManager extends EventEmitter2 {}

const singleton = new EmitManager()
export default singleton
