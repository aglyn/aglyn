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

import { Logger, LogLevelString } from '@aglyn/shared-util-logger'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { EventEmitter2 } from 'eventemitter2'
import { namespace } from '../constants'

export class LogManager extends Logger {}
export function setLogLevel(logLevel: LogLevelString) {
  logger.setLogLevel(logLevel)
}

export const logger = new Logger(namespace)

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

  BUNDLE_REGISTER = 'action.bundles.register',
  BUNDLE_UNREGISTERING = 'lifecycle.bundles.unregistering',
  BUNDLE_UNREGISTERED = 'lifecycle.bundles.unregistered',

  BUNDLE_UNREGISTER = 'action.bundles.unregister',
  BUNDLE_REGISTERING = 'lifecycle.bundles.registering',
  BUNDLE_REGISTERED = 'lifecycle.bundles.registered',

  NODE_CLEAR_ITEMS = 'action.nodes.clearItems',
  NODE_SET_ITEMS = 'action.nodes.setItems',
  NODE_SET = 'action.nodes.set',
  NODE_DELETE = 'action.nodes.delete',
  NODE_DUPLICATE = 'action.nodes.duplicate',
  NODE_REPARENT = 'action.nodes.reparent',

  ERROR_GENERAL = 'error.general',
}

export class EmitManager extends EventEmitter2 {}

export const emitter = new EmitManager()

emitter.prependListener(['error', '**'], (...payload) => {
  logger.error(Timestamp.now().toJSON(), ...payload)
})

export function lifecycleEvent(
  callbackFn: () => void,
  options: {
    beforeEvent: AglynEvent
    beforePayload: any[]
    afterEvent: AglynEvent
    afterPayload: any[]
    onCatch?: (e: unknown) => void
  },
): void {
  const { beforeEvent, beforePayload, afterEvent, afterPayload, onCatch } =
    options
  try {
    logger.debug(Timestamp.now().toJSON(), beforeEvent, beforePayload)
    emitter.emit(beforeEvent, Timestamp.now().toJSON(), ...beforePayload)
    callbackFn()
    logger.debug(Timestamp.now().toJSON(), afterEvent, afterPayload)
    emitter.emit(afterEvent, Timestamp.now().toJSON(), ...afterPayload)
  } catch (e) {
    emitter.emit(AglynEvent.ERROR_GENERAL, {
      message:
        e?.message || `An error has occurred before event ${beforeEvent}`,
    })
    onCatch && onCatch(e)
  }
}
