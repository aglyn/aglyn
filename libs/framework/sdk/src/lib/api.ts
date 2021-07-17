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
import { EventFlag } from './constants/flag'
import {
  AppComponent,
  AppExt,
  AppOptions,
  AppsMap,
  EventListener,
  EventName,
  AppExtMap,
  WebApp,
} from './types'


const DEFAULT_ENTRY_NAME = '[DEFAULT]'
const _apps: AppsMap = new Map()

export function initializeApp(options: AppOptions = {}): WebApp {
  const {name = DEFAULT_ENTRY_NAME} = options
  const _name = String(name)
  if (!_name) {
    throw new Error('Invalid name provided')
  }
  if (_apps.has(_name)) {
    throw new Error(`App already exists with name ${_name}`)
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

export function listenAppOnce<T>(app: WebApp, name: EventName, listener: EventListener<T>) {
  app.mitt.once(name, listener)
}

export function listenAppOn<T>(app: WebApp, name: EventName, listener: EventListener<T>) {
  app.mitt.on(name, listener)
}

export function listenAppOff<T>(app: WebApp, name: EventName, listener: EventListener<T>) {
  app.mitt.off(name, listener)
}

export function getApps(): WebApp[] {
  return [..._apps.values()]
}

export function getApp(name: string = DEFAULT_ENTRY_NAME): WebApp {
  const app = _apps.get(name)
  if (app) {
    return _apps.get(name)
  }
  throw new Error(`App does not exist ${name}`)
}

export function deleteApp(app: WebApp): void {
  const name = app.name
  if (_apps.has(name)) {
    _apps.delete(name)
  }
}

export function getExtensions(app: WebApp): AppExt[] {
  return Array.from(app.extensions.values())
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
