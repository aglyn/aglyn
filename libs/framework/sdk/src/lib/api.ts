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


import { logger } from './logger'
import {
  AglynApp,
  AglynAppOptions,
  AglynCommandController,
  AglynExtension,
  AglynExtensionController,
  AglynModuleTriggerParams,
} from './types'
import {
  AGLYN_APP_ERROR,
  AglynAppEventFlag,
  AglynErrorEventFlag,
  AglynModuleTriggerFlag,
  DEFAULT_ENTRY_NAME,
} from './constants'
import { _apps, _modules } from './internal'
import { LogCallback, Logger, LogLevelString, LogOptions } from '@aglyn/shared/feature/logger'
import { _isFnT, _isNull, _isStrEmpty } from '@aglyn/shared/util/guards'
import { trim } from '@aglyn/shared/util/tools'
import { emitter } from './emitter'
import { Mutable } from '@aglyn/shared/util/types'
import { isAppModule, isCommand, isExtension } from './util/aglyn-is'
import { AglynAppController } from './controllers/aglyn-app.controller'


export function registerModules(app: AglynApp, ...modules: any[]) {
  modules.forEach(module => {
    if (!module) {
      throw AGLYN_APP_ERROR.create(AglynErrorEventFlag.NO_MODULE, undefined)
    }
    if (!isAppModule(module)) {
      throw AGLYN_APP_ERROR.create(
        AglynErrorEventFlag.INVALID_MODULE_ARG, {
          moduleName: module?.['$id'] ?? module?.['name'] ?? 'unknown',
          appName: app.getName() ?? DEFAULT_ENTRY_NAME,
        },
      )
    }
    if (isExtension(module)) {
      app.effect({
        type: AglynModuleTriggerFlag.EXTENSION_REGISTER,
        payload: {extension: module},
      })
    }
    if (isCommand(module)) {
      app.effect({
        type: AglynModuleTriggerFlag.COMMAND_ACTION_REGISTER,
        payload: {handler: module},
      })
    }
  })
}

export function initializeApp(appOptions: AglynAppOptions = {}): AglynApp {
  const options = {...appOptions}
  const {name: _name = DEFAULT_ENTRY_NAME} = options
  const name = trim(_name)
  if (_isStrEmpty(name)) {
    throw AGLYN_APP_ERROR.create(AglynErrorEventFlag.BAD_APP_NAME, {appName: name})
  }
  if (_apps.has(name)) {
    throw AGLYN_APP_ERROR.create(AglynErrorEventFlag.DUPLICATE_APP, {appName: name})
  }
  const app: AglynApp = new AglynAppController({options, emitter, logger})
  _apps.set(name, app)
  app.onInit?.()

  registerModules(app, ..._modules.extensions)
  registerModules(app, ..._modules.commands)

  return app
}

export function getApps(): AglynApp[] {
  return [..._apps.values()]
}

export function getApp(name: string = DEFAULT_ENTRY_NAME): AglynApp {
  const app = _apps.get(name)
  if (!app) {
    throw AGLYN_APP_ERROR.create(AglynErrorEventFlag.NO_APP, {appName: name})
  }
  return _apps.get(name)
}

export function deleteApp(app: AglynApp): void {
  _validateAppArg(app)
  const name = app.getName()
  logger.debug(AglynAppEventFlag.BEFORE_DELETE_APP, {app})
  emitter.emit(AglynAppEventFlag.BEFORE_DELETE_APP, {app})
  app.onDestroy?.()
  _apps.delete(name)
  ;(app as Mutable<AglynApp>)['deleted'] = true
  logger.debug(AglynAppEventFlag.APP_DELETED, {appName: name})
  emitter.emit(AglynAppEventFlag.APP_DELETED, {appName: name})
}

export function _validateAppArg(app: AglynApp): void {
  if (!(app as AglynApp)) {
    throw AGLYN_APP_ERROR.create(AglynErrorEventFlag.INVALID_APP_ARG, {appName: app?.getName?.()})
  }
  if (app['deleted']) {
    throw AGLYN_APP_ERROR.create(AglynErrorEventFlag.APP_DELETED, {appName: app?.getName?.()})
  }
}

export function _getExtensionController(app: AglynApp): AglynExtensionController {
  _validateAppArg(app)
  return AglynAppController.extensionControllers.get(app.getName())
}

export function _getCommandController(app: AglynApp): AglynCommandController {
  _validateAppArg(app)
  return AglynAppController.commandControllers.get(app.getName())
}

/**
 * Sets log handler for all SDKs components
 * @param callbackFn - An optional custom log handler that executes user code whenever
 *   the SDK makes a logging call.
 * @param options
 */
export function onLog(callbackFn: LogCallback | null, options?: LogOptions): void {
  if (!_isNull(callbackFn) && !_isFnT(callbackFn)) {
    throw AGLYN_APP_ERROR.create(AglynErrorEventFlag.INVALID_LOG_ARG, undefined)
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

export function getExtension(
  app: AglynApp, data: { extensionId: string },
): AglynExtension {
  const {extensionId} = data
  const extensionController = _getExtensionController(app)
  return extensionController.getExtension(extensionId)
}

export function getExtensions(
  app: AglynApp,
): AglynExtension[] {
  const extensionController = _getExtensionController(app)
  return extensionController.getExtensions()
}

export function registerExtension(
  app: AglynApp, data: AglynModuleTriggerParams[AglynModuleTriggerFlag.EXTENSION_REGISTER],
): void {
  const extensionController = _getExtensionController(app)
  extensionController.registerExtension(data)
}

export function unregisterExtension(
  app: AglynApp, data: AglynModuleTriggerParams[AglynModuleTriggerFlag.EXTENSION_UNREGISTER],
): void {
  const extensionController = _getExtensionController(app)
  extensionController.unregisterExtension(data)
}

export function loadExtension(
  app: AglynApp, data: AglynModuleTriggerParams[AglynModuleTriggerFlag.EXTENSION_LOAD],
) {
  const extensionController = _getExtensionController(app)
  extensionController.loadExtension(data)
}

export function unloadExtension(
  app: AglynApp, data: AglynModuleTriggerParams[AglynModuleTriggerFlag.EXTENSION_UNLOAD],
) {
  const extensionController = _getExtensionController(app)
  extensionController.loadExtension(data)
}

export function registerCommand(
  app: AglynApp, data: AglynModuleTriggerParams[AglynModuleTriggerFlag.COMMAND_ACTION_REGISTER],
): void {
  const commandController = _getCommandController(app)
  commandController.registerAction(data)
}

export function unregisterAction(
  app: AglynApp, data: AglynModuleTriggerParams[AglynModuleTriggerFlag.COMMAND_ACTION_UNREGISTER],
): void {
  const commandController = _getCommandController(app)
  commandController.unregisterAction(data)
}

export function triggerCommand(
  app: AglynApp, data: AglynModuleTriggerParams[AglynModuleTriggerFlag.COMMAND_TRIGGER],
): void {
  const commandController = _getCommandController(app)
  commandController.executeCommand(data)
}

// export function getComponent(app: AglynApp, extId: string, options: { $id: string }) {
//   const {$id} = options
//   return app.extensions.get(extId)?.component.find((m) => m.$id === $id)
// }
//
// export function getComponents(app: AglynApp, extId: string, props: { componentIds?: string[] }) {
//   const {componentIds} = props
//   return componentIds
//     ? componentIds.map(($id) => getComponent(app, {extId, $id}))
//     : [...app.extensions.get(extId)?.component.values()]
// }
//
// export function addComponent(
//   app: AglynApp,
//   extId: string,
//   component: PartPartial<AglynComponent, 'options'>,
// ) {
//   const extension = app.extensions?.get(extId)
//   if (!extension) {
//     throw AGLYN_APP_ERROR.create(AglynErrorEventFlag.NO_APP_EXTENSION, {
//       appName: app.getName(), extensionId: extId,
//     })
//   }
//   if (!(component.options)) component.options = {}
//   extension.component.push(component as AglynComponent)
//   app.event.emit(AglynAppEventFlag.SET_COMPONENT, component)
//   logger.debug(`Set component id = ${$id} for extension id = ${extId}`)
//   return this
// }
