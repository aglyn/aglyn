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

import EventEmitter from 'events'
import { logger } from './logger'
import {
  AppComponent,
  AppExt,
  AppExtMap,
  AppOptions,
  EventListener,
  EventName,
  WebApp,
} from './types'
import { AppErrorFlag, DEFAULT_ENTRY_NAME, ERROR_FACTORY, EventFlag } from './constants'
import { _apps } from './internal'
import { LogCallback, Logger, LogLevelString, LogOptions } from '@aglyn/shared/feature/logger'
import { _isFn } from '@aglyn/shared/util/guards'


export function initializeApp(options: AppOptions = {}): WebApp {
  const {name = DEFAULT_ENTRY_NAME} = options
  const _name = String(name)
  if (!_name) {
    throw ERROR_FACTORY.create(AppErrorFlag.BAD_APP_NAME, {appName: _name})
  }
  if (_apps.has(_name)) {
    throw ERROR_FACTORY.create(AppErrorFlag.DUPLICATE_APP, {appName: _name})
  }
  const _created: string = new Date().toUTCString()
  const _mitt: EventEmitter = new EventEmitter()
  const _extensions: AppExtMap = new Map()
  const app: WebApp = new (class {
    get mitt() {
      return _mitt
    }
    get extensions() {
      return _extensions
    }
    get created() {
      return _created
    }
    get name() {
      return _name
    }
    get options() {
      return options
    }
  })()
  _apps.set(_name, app)
  return app
}

export function getApps(): WebApp[] {
  return [..._apps.values()]
}

export function getApp(name: string = DEFAULT_ENTRY_NAME): WebApp {
  const app = _apps.get(name)
  if (!app) {
    throw ERROR_FACTORY.create(AppErrorFlag.DUPLICATE_APP, {appName: name})
  }
  return _apps.get(name)
}

export function deleteApp(app: WebApp): void {
  const name = app.name
  if (_apps.has(name)) {
    _apps.delete(name)
  }
}

export function _appListenOnce<T>(app: WebApp, name: EventName, listener: EventListener<T>) {
  app.mitt.once(name, listener)
}

export function _appListenOn<T>(app: WebApp, name: EventName, listener: EventListener<T>) {
  app.mitt.on(name, listener)
}

export function _appListenOff<T>(app: WebApp, name: EventName, listener: EventListener<T>) {
  app.mitt.off(name, listener)
}

/**
 * Sets log handler for all SDKs components
 * @param callbackFn - An optional custom log handler that executes user code whenever
 *   the SDK makes a logging call.
 * @param options
 */
export function onLog(callbackFn: LogCallback | null, options?: LogOptions): void {
  if (callbackFn !== null && !_isFn(callbackFn)) {
    throw ERROR_FACTORY.create(AppErrorFlag.INVALID_LOG_ARG)
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

export function getExtensions(app: WebApp): AppExt[] {
  return [...app.extensions.values()]
}

export function getExtension(app: WebApp, options: { $id: string }): AppExt {
  const {$id} = options
  return app.extensions.get($id)
}

export function setExtension(app: WebApp, props: { $id: string; components: AppComponent[] }) {
  const {$id, components} = props
  const extension = {$id, components}
  app.extensions.set($id, extension)
  app.mitt.emit(EventFlag.SET_MODULE, extension)
  logger.debug(`Set module value for ${$id}`)
}

export function getComponent(app: WebApp, props: { moduleId: string; componentId: string }) {
  const {moduleId, componentId} = props
  return app.extensions.get(moduleId)?.components.find((m) => m.$id === componentId)
}

export function getComponents(app: WebApp, props: { moduleId: string; componentId?: string[] }) {
  const {moduleId, componentId} = props
  return componentId
    ? componentId.map((i) => getComponent(app, {moduleId, componentId: i}))
    : app.extensions.get(moduleId)?.components
}

export function setComponent(
  app: WebApp,
  props: {
    moduleId: string
    $id: string
    ctor: AppComponent['ctor']
    metadata?: AppComponent['metadata']
  },
) {
  const {moduleId, $id, ctor, metadata} = props
  const extension = app.extensions.get(moduleId) ?? {$id: moduleId, components: []}
  let component = extension.components.find((i) => i.$id === $id)
  if (!component) {
    component = {$id, ctor, metadata}
    extension.components.push(component)
  } else {
    component.$id = $id
    component.ctor = ctor
    component.metadata = metadata
  }
  app.extensions.set(moduleId, extension)
  app.mitt.emit(EventFlag.SET_COMPONENT, extension)
  logger.debug(`Set component id = ${$id} for module id = ${moduleId}`)
  return this
}
