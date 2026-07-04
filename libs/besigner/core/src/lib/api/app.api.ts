/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import { _isObj, _isStrEmpty } from '@aglyn/shared-util-tools'
import { _INTERNAL_BESIGNER_APPS_ } from '../constants/_internal'
import BesignerAppController from '../controllers/besigner-app.controller'
import {
  type AppUUN,
  type BesignerAppOptions,
  DEFAULT_APP_UUN,
  type IBesignerAppController,
} from '../definitions/besigner-app.types'

export function getAllBesignerApps(): IBesignerAppController[] {
  return [..._INTERNAL_BESIGNER_APPS_.values()]
}

export function doesBesignerAppExist(appName?: AppUUN): boolean {
  return _INTERNAL_BESIGNER_APPS_.has(appName || DEFAULT_APP_UUN)
}

export function getBesignerApp(name?: AppUUN): IBesignerAppController {
  const appName = name || DEFAULT_APP_UUN
  if (!doesBesignerAppExist(appName)) {
    throw new Error(`[Besigner] No app initialized with name "${appName}"`)
  }
  return _INTERNAL_BESIGNER_APPS_.get(appName)
}

export function deleteBesignerApp(appName?: AppUUN): void {
  const resolvedName = appName || DEFAULT_APP_UUN
  const app = getBesignerApp(resolvedName)
  app.onDestroy?.()
  _INTERNAL_BESIGNER_APPS_.delete(resolvedName)
  app.setDeleted(true)
}

export function initializeBesignerApp(
  opts?: BesignerAppOptions,
): IBesignerAppController {
  const appName: string = opts?.appName || DEFAULT_APP_UUN
  if (_isStrEmpty(appName)) {
    throw new Error('[Besigner] App name must be a non-empty string')
  }
  if (doesBesignerAppExist(appName)) {
    throw new Error(`[Besigner] App "${appName}" is already initialized`)
  }
  const app: IBesignerAppController = new BesignerAppController({
    ...opts,
    appName,
  })
  _INTERNAL_BESIGNER_APPS_.set(appName, app)
  return app
}

export function _validateBesignerAppArg(app: IBesignerAppController): void {
  if (!app || !_isObj(app)) {
    console.warn('Not a BesignerAppController instance', app)
    throw new Error('[Besigner] Invalid app instance argument')
  }
}
