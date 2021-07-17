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

import { ErrorParams } from './types'
import { ErrorFactory, ErrorMap } from '@aglyn/shared/util/error'


export const DEFAULT_ENTRY_NAME = '[DEFAULT]'

export enum RestrictFlag {
  LIMIT = 'limit',
  DISALLOW = 'disallow',
}

export enum AppEventFlag {
  CREATED_APP = 'app:webapp:created-app-instance',
  BEFORE_DELETE_APP = 'app:webapp:deleting-app-instance',
  DELETED_APP = 'app:webapp:deleted-app-instance',
  SET_EXTENSION = 'app:webapp:app:set-extension',
  SET_COMPONENT = 'app:webapp:set-component',
}

export enum AppErrorFlag {
  NO_APP = 'app:error:no-app',
  BAD_APP_NAME = 'app:error:bad-app-name',
  DUPLICATE_APP = 'app:error:duplicate-app',
  APP_DELETED = 'app:error:app-deleted',
  INVALID_APP_ARG = 'app:error:invalid-app-argument',
  INVALID_LOG_ARG = 'app:error:invalid-log-argument',
  NO_APP_EXTENSION = 'app:error:no-app-extension',
}

const ERRORS: ErrorMap<AppErrorFlag> = {
  [AppErrorFlag.NO_APP]: 'No WebApp \'{$appName}\' has been created - call Web initializeApp()',
  [AppErrorFlag.BAD_APP_NAME]: 'Illegal App name: \'{$appName}\'',
  [AppErrorFlag.DUPLICATE_APP]: 'WebApp named \'{$appName}\' already exists',
  [AppErrorFlag.APP_DELETED]: 'WebApp named \'{$appName}\' already deleted',
  [AppErrorFlag.INVALID_APP_ARG]: 'WebApp.{$appName}() takes either no argument or a WebApp instance.',
  [AppErrorFlag.INVALID_LOG_ARG]: 'First argument to `onLog` must be null or a function.',
  [AppErrorFlag.NO_APP_EXTENSION]: 'No AppExtension \'{$extensionId}\' has been created on WebApp \'{$appName}\'',
}

export const APP_API_ERROR = new ErrorFactory<AppErrorFlag, ErrorParams>(
  'api',
  'WebApp',
  ERRORS,
)
