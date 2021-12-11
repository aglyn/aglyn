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

import type {MutableShallow} from '@aglyn/shared-data-types'
import {_isStrEmpty} from '@aglyn/shared-util-guards'
import {trim} from '@aglyn/shared-util-tools'
import {_INTERNAL_APPS_, DEFAULT_APP_UUN} from '../constants/_internal'
import {AGLYN_EMITTER, AglynAppEventFlag} from '../constants/emitter'
import {AGLYN_ERROR, AglynErrorEventFlag} from '../constants/error'
import {AGLYN_LOGGER} from '../constants/logger'
import type {AglynAppOptions} from '../controllers/aglyn-app.controller'
import {AglynAppController} from '../controllers/aglyn-app.controller'
import type {AppUUN} from '../types'


export function getAllApps(): AglynAppController[] {
  return [..._INTERNAL_APPS_.values()]
}

export function doesAppExist(name?: AppUUN): boolean {
  return _INTERNAL_APPS_.has(name || DEFAULT_APP_UUN)
}

export function getApp(name?: string): AglynAppController {
  const appName = name || DEFAULT_APP_UUN
  if (!doesAppExist(appName)) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.APP_NONE, {appName})
  }
  return _INTERNAL_APPS_.get(appName)
}

export function deleteApp(app: AglynAppController): void {
  _validateAppArg(app)
  const appName = app.getName()
  AGLYN_LOGGER.debug(AglynAppEventFlag.APP_DELETING, {appName})
  AGLYN_EMITTER.emit(AglynAppEventFlag.APP_DELETING, {appName})
  app.aglynOnDestroy?.()
  _INTERNAL_APPS_.delete(appName)
  ;(app as MutableShallow<AglynAppController>)['deleted'] = true
  AGLYN_LOGGER.debug(AglynAppEventFlag.APP_DELETED, {appName})
  AGLYN_EMITTER.emit(AglynAppEventFlag.APP_DELETED, {appName})
}

export function initializeApp(opts: AglynAppOptions = {}): AglynAppController {
  const options: AglynAppOptions = {...opts}
  const appName: string = trim(opts.appName || DEFAULT_APP_UUN)
  if (_isStrEmpty(appName)) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.APP_BAD_NAME, {appName})
  }
  if (doesAppExist(appName)) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.APP_EXISTS, {appName})
  }
  const app: AglynAppController = new AglynAppController(options)
  _INTERNAL_APPS_.set(appName, app)

  app.aglynOnInit()

  return app
}

export function _validateAppArg(app: AglynAppController): void {
  if (!(app as AglynAppController) || !(app instanceof AglynAppController)) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.APP_BAD_INSTANCE, {appName: app?.getName?.()})
  }
  if (app['deleted']) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.APP_DELETED, {appName: app?.getName?.()})
  }
}
