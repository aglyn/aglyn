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


import { AGLYN_LOGGER } from './logger'
import {
  AglynAppInstance,
  AglynAppOptions,
  AglynCommandControllerInstance,
  AglynExtensionControllerInstance,
  AglynExtensionInstance,
} from './types'
import { DEFAULT_ENTRY_NAME } from './constants'
import { _apps, _commandControllers, _extensionControllers, _modules } from './_internal'
import { LogCallback, Logger, LogLevelString, LogOptions } from '@aglyn/shared/feature/logger'
import { _isCtor, _isFnT, _isNull, _isStrEmpty } from '@aglyn/shared/util/guards'
import { trim } from '@aglyn/shared/util/tools'
import {
  AGLYN_EMITTER,
  AglynAppEventFlag,
  AglynModuleEventFlag,
  AglynModuleEventPayload,
} from './emitter'
import { MutableShallow } from '@aglyn/shared/util/types'
import { isAppModule, isExtension } from './util/aglyn-is'
import { AglynAppController } from './controllers/aglyn-app.controller'
import { AGLYN_ERROR, AglynErrorEventFlag } from './error'


export function initializeApp(appOptions: AglynAppOptions = {}): AglynAppInstance {
  const options = {...appOptions}
  const {name: _name = DEFAULT_ENTRY_NAME} = options
  const name = trim(_name)
  if (_isStrEmpty(name)) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.BAD_APP_NAME, {appName: name})
  }
  if (_apps.has(name)) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.DUPLICATE_APP, {appName: name})
  }
  const app: AglynAppInstance = new AglynAppController(options)
  _apps.set(name, app)
  app.onInit?.()

  _modules.extensions.forEach(m => {
    const module = m?.()
    if (!module) {
      throw AGLYN_ERROR.create(AglynErrorEventFlag.NO_MODULE, undefined)
    }
    if (!isAppModule(module) || !isExtension(module) || !_isCtor(module)) {
      throw AGLYN_ERROR.create(
        AglynErrorEventFlag.INVALID_MODULE_ARG, {
          moduleName: module?.getName?.() ?? module?.['name'] ?? 'unknown',
          appName: app.getName() ?? DEFAULT_ENTRY_NAME,
        },
      )
    }
    app.effect({
      type: AglynModuleEventFlag.EXTENSION_REGISTER,
      payload: {extension: new module(app)},
    })
  })

  return app
}

export function getApps(): AglynAppInstance[] {
  return [..._apps.values()]
}

export function getApp(name: string = DEFAULT_ENTRY_NAME): AglynAppInstance {
  const app = _apps.get(name)
  if (!app) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.NO_APP, {appName: name})
  }
  return _apps.get(name)
}

export function deleteApp(app: AglynAppInstance): void {
  _validateAppArg(app)
  const name = app.getName()
  AGLYN_LOGGER.debug(AglynAppEventFlag.BEFORE_DELETE_APP, {app})
  AGLYN_EMITTER.emit(AglynAppEventFlag.BEFORE_DELETE_APP, {app})
  app.onDestroy?.()
  _apps.delete(name)
  ;(app as MutableShallow<AglynAppInstance>)['deleted'] = true
  AGLYN_LOGGER.debug(AglynAppEventFlag.APP_DELETED, {appName: name})
  AGLYN_EMITTER.emit(AglynAppEventFlag.APP_DELETED, {appName: name})
}

export function _validateAppArg(app: AglynAppInstance): void {
  if (!(app as AglynAppInstance)) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.INVALID_APP_ARG, {appName: app?.getName?.()})
  }
  if (app['deleted']) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.APP_DELETED, {appName: app?.getName?.()})
  }
}

export function _getExtensionController(app: AglynAppInstance): AglynExtensionControllerInstance {
  _validateAppArg(app)
  return _extensionControllers.get(app.getName())
}

export function _getCommandController(app: AglynAppInstance): AglynCommandControllerInstance {
  _validateAppArg(app)
  return _commandControllers.get(app.getName())
}

/**
 * Sets log handler for all SDKs components
 * @param callbackFn - An optional custom log handler that executes user code whenever
 *   the SDK makes a logging call.
 * @param options
 */
export function onLog(callbackFn: LogCallback | null, options?: LogOptions): void {
  if (!_isNull(callbackFn) && !_isFnT(callbackFn)) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.INVALID_LOG_ARG, undefined)
  }
  Logger.setUserLogHandler(callbackFn, options)
}

/**
 * Sets log level for all SDK components
 *
 * All of the log types above the current log level are captured (i.e. if
 * you set the log level to `info`, errors are logged, but `debug` and
 * `verbose` logs are not).
 */
export function setLogLevel(logLevel: LogLevelString): void {
  Logger.setLogLevel(logLevel)
}

export function getExtension<T extends AglynExtensionInstance>(
  app: AglynAppInstance, data: { name: string },
): T {
  const {name} = data
  const extensionController = _getExtensionController(app)
  return extensionController.getExtensionByName(name) as T
}

export function getExtensions(
  app: AglynAppInstance,
): AglynExtensionInstance[] {
  const extensionController = _getExtensionController(app)
  return extensionController.getAllExtensions()
}

export function registerExtension(
  app: AglynAppInstance, data: AglynModuleEventPayload[AglynModuleEventFlag.EXTENSION_REGISTER],
): void {
  const extensionController = _getExtensionController(app)
  extensionController.registerExtension(data)
}

export function unregisterExtension(
  app: AglynAppInstance, data: AglynModuleEventPayload[AglynModuleEventFlag.EXTENSION_UNREGISTER],
): void {
  const extensionController = _getExtensionController(app)
  extensionController.unregisterExtension(data)
}

export function loadExtension(
  app: AglynAppInstance, data: AglynModuleEventPayload[AglynModuleEventFlag.EXTENSION_LOAD],
) {
  const extensionController = _getExtensionController(app)
  extensionController.loadExtension(data)
}

export function unloadExtension(
  app: AglynAppInstance, data: AglynModuleEventPayload[AglynModuleEventFlag.EXTENSION_UNLOAD],
) {
  const extensionController = _getExtensionController(app)
  extensionController.loadExtension(data)
}

export function registerCommand(
  app: AglynAppInstance, data: AglynModuleEventPayload[AglynModuleEventFlag.COMMAND_ACTION_REGISTER],
): void {
  const commandController = _getCommandController(app)
  commandController.registerAction(data)
}

export function unregisterAction(
  app: AglynAppInstance, data: AglynModuleEventPayload[AglynModuleEventFlag.COMMAND_ACTION_UNREGISTER],
): void {
  const commandController = _getCommandController(app)
  commandController.unregisterAction(data)
}

export function triggerCommand(
  app: AglynAppInstance, data: AglynModuleEventPayload[AglynModuleEventFlag.COMMAND_TRIGGER],
): void {
  const commandController = _getCommandController(app)
  commandController.executeCommand(data)
}
