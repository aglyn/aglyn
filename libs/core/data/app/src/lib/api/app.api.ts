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

import type {
  AglynAppOptions,
  AppUUN,
  IAglynAppController,
} from '@aglyn/core-data-foundation'
import {
  _INTERNAL_APPS_,
  AGLYN_EMITTER,
  AGLYN_ERROR,
  AGLYN_LOGGER,
  AglynErrorEventFlag,
  AglynEventStateFlag,
  DEFAULT_APP_UUN,
} from '@aglyn/core-data-foundation'
import { _isObj, _isStrEmpty } from '@aglyn/shared-util-tools'
import { AglynAppController } from '../controllers/aglyn-app.controller'

export function getAllApps(): IAglynAppController[] {
  return [..._INTERNAL_APPS_.values()]
}

export function doesAppExist(appName?: AppUUN): boolean {
  return _INTERNAL_APPS_.has(appName || DEFAULT_APP_UUN)
}

export function getApp(name?: AppUUN): IAglynAppController {
  const appName = name || DEFAULT_APP_UUN
  if (!doesAppExist(appName)) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.APP_NONE, { appName })
  }
  return _INTERNAL_APPS_.get(appName)
}

export function deleteApp(appName?: AppUUN): void {
  const app = getApp(appName || DEFAULT_APP_UUN)
  AGLYN_LOGGER.debug(AglynEventStateFlag.APP_DELETING, { appName })
  AGLYN_EMITTER.emit(AglynEventStateFlag.APP_DELETING, { appName })
  app.onDestroy?.()
  _INTERNAL_APPS_.delete(appName)
  app.setDeleted(true)
  AGLYN_LOGGER.debug(AglynEventStateFlag.APP_DELETED, { appName })
  AGLYN_EMITTER.emit(AglynEventStateFlag.APP_DELETED, { appName })
}

export function initializeApp(opts?: AglynAppOptions): IAglynAppController {
  const appName: string = opts?.appName || DEFAULT_APP_UUN
  if (_isStrEmpty(appName)) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.APP_BAD_NAME, { appName })
  }
  if (doesAppExist(appName)) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.APP_EXISTS, { appName })
  }
  const app: IAglynAppController = new AglynAppController({ ...opts, appName })
  app.setupModules()
  app.setupExtensions()
  _INTERNAL_APPS_.set(appName, app)

  app.onInitialize()

  return app
}

export function _validateAppArg(app: IAglynAppController): void {
  if (
    !(app as IAglynAppController) ||
    !_isObj(app) /*!(app instanceof AglynAppController)*/
  ) {
    console.warn('Not instanceof AglynAppController', app)
    throw AGLYN_ERROR.create(AglynErrorEventFlag.APP_BAD_INSTANCE, {
      appName: app?.getName?.(),
    })
  }
  if (app['deleted']) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.APP_DELETED, {
      appName: app?.getName?.(),
    })
  }
}
