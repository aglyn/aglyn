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

import { ErrorTagMessages, NsErrorFactory } from '@aglyn/shared/util/errors'
import { AglynError } from './types'


export enum AglynErrorEventFlag {
  NO_APP = 'error:no-app',
  BAD_APP_NAME = 'error:bad-app-name',
  DUPLICATE_APP = 'error:duplicate-app',
  APP_DELETED = 'error:app-deleted',
  INVALID_APP_ARG = 'error:invalid-app-argument',
  INVALID_LOG_ARG = 'error:invalid-log-argument',
  NO_APP_EXTENSION = 'error:no-app-extension',
  NO_MODULE = 'error:no-module',
  INVALID_MODULE_ARG = 'error:invalid-module-argument',
}

const AGLYN_APP_SDK_ERROR_MSG: ErrorTagMessages<AglynErrorEventFlag> = {
  [AglynErrorEventFlag.NO_APP]: 'No AglynApp \'{$appName}\' has been created - call Web initializeApp()',
  [AglynErrorEventFlag.BAD_APP_NAME]: 'Illegal App name: \'{$appName}\'',
  [AglynErrorEventFlag.DUPLICATE_APP]: 'AglynApp named \'{$appName}\' already exists',
  [AglynErrorEventFlag.APP_DELETED]: 'AglynApp named \'{$appName}\' already deleted',
  [AglynErrorEventFlag.INVALID_APP_ARG]: 'AglynApp.{$appName}() takes either no argument or a AglynApp instance.',
  [AglynErrorEventFlag.INVALID_LOG_ARG]: 'First argument to \'onLog\' must be null or a function.',
  [AglynErrorEventFlag.NO_APP_EXTENSION]: 'No AppExtension \'{$extensionName}\' has been created on AglynApp \'{$appName}\'',
  [AglynErrorEventFlag.NO_MODULE]: 'No module has been provided for loading',
  [AglynErrorEventFlag.INVALID_MODULE_ARG]: 'An invalid AppModule \'{$moduleName}\' has been provided on AglynApp \'{$appName}\'',
}
export const AGLYN_ERROR: AglynError = new NsErrorFactory('sdk', 'AglynApp', AGLYN_APP_SDK_ERROR_MSG)
