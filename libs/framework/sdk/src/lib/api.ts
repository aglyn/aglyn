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
  AppComponent,
  AppEvent,
  AppEventHandler,
  AppExtension,
  AppOptions,
  ComponentMetadata,
  ExtensionConfig,
  WebApp,
} from './types'
import { APP_API_ERROR, AppErrorFlag, AppEventFlag, DEFAULT_ENTRY_NAME } from './constants'
import { _apps } from './internal'
import { LogCallback, Logger, LogLevelString, LogOptions } from '@aglyn/shared/feature/logger'
import { _isFn, _isNull, _isStrEmpty } from '@aglyn/shared/util/guards'
import { trim } from '@aglyn/shared/util/tools'
import { WithPartial } from '@aglyn/shared/util/types'
import { WebAppModel } from './models/web-app.model'
import { AppExtensionModel } from './models/app-extension.model'


export function initializeApp(options: AppOptions = {}): WebApp {
  const {name = DEFAULT_ENTRY_NAME} = options
  const _name = trim(name)
  if (_isStrEmpty(_name)) {
    throw APP_API_ERROR.create(AppErrorFlag.BAD_APP_NAME, {appName: _name})
  }
  if (_apps.has(_name)) {
    throw APP_API_ERROR.create(AppErrorFlag.DUPLICATE_APP, {appName: _name})
  }
  const app: WebApp = new WebAppModel(options)
  _apps.set(_name, app)
  app.event.emit(AppEventFlag.CREATED_APP, app)
  logger.debug(`Created app instance ${_name}`)
  return app
}

export function getApps(): WebApp[] {
  return [..._apps.values()]
}

export function getApp(name: string = DEFAULT_ENTRY_NAME): WebApp {
  const app = _apps.get(name)
  if (!app) {
    throw APP_API_ERROR.create(AppErrorFlag.DUPLICATE_APP, {appName: name})
  }
  return _apps.get(name)
}

export function deleteApp(app: WebApp): void {
  const name = app.getName()
  if (_apps.has(name)) {
    app.event.emit(AppEventFlag.BEFORE_DELETE_APP, _apps.get(name))
    _apps.delete(name)
    app.event.emit(AppEventFlag.DELETED_APP, name)
    logger.debug(`Deleted app ${name}`)
  }
}

export function _validateApp(app: WebApp): void {
  if (!(app as WebApp)) {
    throw APP_API_ERROR.create(AppErrorFlag.INVALID_APP_ARG, {appName: app?.getName?.()})
  }
}

export function _appListenOn(app: WebApp, name: AppEvent, listener: AppEventHandler) {
  app.event.on(name, listener)
}

export function _appListenOff(app: WebApp, name: AppEvent, listener: AppEventHandler) {
  app.event.off(name, listener)
}

/**
 * Sets log handler for all SDKs components
 * @param callbackFn - An optional custom log handler that executes user code whenever
 *   the SDK makes a logging call.
 * @param options
 */
export function onLog(callbackFn: LogCallback | null, options?: LogOptions): void {
  if (!_isNull(callbackFn) && !_isFn(callbackFn)) {
    throw APP_API_ERROR.create(AppErrorFlag.INVALID_LOG_ARG)
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

export function addExtension(app: WebApp, config: ExtensionConfig): void {
  const _extension: AppExtension = new AppExtensionModel(app, config)
  app.extension.set(_extension.getId(), _extension)
  app.event.emit(AppEventFlag.SET_EXTENSION, _extension)
  logger.debug(`Set module value for ${_extension.getId()}`)
}

export function getExtension(app: WebApp, options: { $id: string }): AppExtension {
  const {$id} = options
  return app.extension.get($id)
}

export function getExtensions(app: WebApp): AppExtension[] {
  return [...app.extension.values()]
}

export function getComponent(app: WebApp, extId: string, options: { $id: string }) {
  const {$id} = options
  return app.extension.get(extId)?.component.find((m) => m.$id === $id)
}

export function getComponents(app: WebApp, extId: string, props: { componentIds?: string[] }) {
  const {componentIds} = props
  return componentIds
    ? componentIds.map(($id) => getComponent(app, {extId, $id}))
    : [...app.extension.get(extId)?.component.values()]
}

export function addComponent(
  app: WebApp,
  extId: string,
  component: WithPartial<AppComponent, 'metadata'>,
) {
  const extension = app.extension?.get(extId)
  if (!extension) {
    throw APP_API_ERROR.create(AppErrorFlag.NO_APP_EXTENSION, {
      appName: app.getName(), extensionId: extId,
    })
  }
  if (!(component.metadata)) component.metadata = {}
  extension.component.push(component as AppComponent)
  app.event.emit(AppEventFlag.SET_COMPONENT, component)
  logger.debug(`Set component id = ${$id} for extension id = ${extId}`)
  return this
}
