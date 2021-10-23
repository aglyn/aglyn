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

import { MutableShallow } from '@aglyn/shared-data-types'
import { _isCtor, _isStrEmpty } from '@aglyn/shared-util-guards'
import { trim } from '@aglyn/shared-util-tools'
import { _apps } from '../constants/_internal'
import { AGLYN_EMITTER, AglynAppEffectFlag, AglynAppEventFlag } from '../constants/emitter'
import { DEFAULT_ENTRY_NAME } from '../constants/enums'
import { AGLYN_ERROR, AglynErrorEventFlag } from '../constants/error'
import { AGLYN_LOGGER } from '../constants/logger'
import { AglynAppController, AglynAppOptions } from '../controllers/aglyn-app.controller'
import { AglynExtensionLoader } from '../controllers/aglyn-extensions.controller'
import { isAglynExtension, isAglynModule } from '../util/aglyn-is'


export function getAllApps(): AglynAppController[] {
  return [..._apps.values()]
}

export function getApp(name: string = DEFAULT_ENTRY_NAME): AglynAppController {
  const app = _apps.get(name)
  if (!app) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.NO_APP, {appName: name})
  }
  return _apps.get(name)
}

export function deleteApp(app: AglynAppController): void {
  _validateAppArg(app)
  const appName = app.getName()
  AGLYN_LOGGER.debug(AglynAppEventFlag.APP_DELETING, {appName})
  AGLYN_EMITTER.emit(AglynAppEventFlag.APP_DELETING, {appName})
  app.aglynOnDestroy?.()
  _apps.delete(appName)
  ;(app as MutableShallow<AglynAppController>)['deleted'] = true
  AGLYN_LOGGER.debug(AglynAppEventFlag.APP_DELETED, {appName})
  AGLYN_EMITTER.emit(AglynAppEventFlag.APP_DELETED, {appName})
}

export function initializeApp(options: AglynAppOptions = {}): AglynAppController {
  const opts: AglynAppOptions = {...options}
  const appName: string = trim(opts.name || DEFAULT_ENTRY_NAME)
  const extensions = opts.extensions || []
  if (_isStrEmpty(appName)) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.BAD_APP_NAME, {appName})
  }
  if (_apps.has(appName)) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.DUPLICATE_APP, {appName})
  }
  const app: AglynAppController = new AglynAppController(opts)
  _apps.set(appName, app)

  app.aglynOnInit()
  _loadAppExtensions({app, extensions})

  return app
}

export function _validateAppArg(app: AglynAppController): void {
  if (!(app as AglynAppController) || !(app instanceof AglynAppController)) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.INVALID_APP_ARG, {appName: app?.getName?.()})
  }
  if (app['deleted']) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.APP_DELETED, {appName: app?.getName?.()})
  }
}

export function _loadAppExtensions(data: { app: AglynAppController, extensions: AglynExtensionLoader[] }) {
  const {app, extensions = []} = data

  extensions.map((loader) => {
    console.log('loader', loader(), extensions)
    const module = loader()
    if (!module) {
      throw AGLYN_ERROR.create(AglynErrorEventFlag.NO_MODULE, undefined)
    }
    if (!isAglynModule(module) || !isAglynExtension(module) || !_isCtor(module)) {
      throw AGLYN_ERROR.create(AglynErrorEventFlag.INVALID_MODULE_ARG, {
        moduleName: module?.['name'] ?? 'unknown',
        appName: app.getName() ?? DEFAULT_ENTRY_NAME,
      })
    }

    const extensionModel = new module(app)
    app.effect({
      type: AglynAppEffectFlag.EXTENSION_REGISTER,
      payload: {extension: extensionModel},
    })
    return module
  })
}
