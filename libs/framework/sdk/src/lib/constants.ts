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

export enum EventFlag {
  INSTANCE_CREATED = 'website:app:created-instance',
  SET_MODULE = 'website:app:set-module',
  SET_COMPONENT = 'website:app:set-component',
}

export enum AppErrorFlag {
  NO_APP = 'app:error:no-app',
  BAD_APP_NAME = 'app:error:bad-app-name',
  DUPLICATE_APP = 'app:error:duplicate-app',
  APP_DELETED = 'app:error:app-deleted',
  INVALID_APP_ARG = 'app:error:invalid-app-argument',
  INVALID_LOG_ARG = 'app:error:invalid-log-argument'
}

const ERRORS: ErrorMap<AppErrorFlag> = {
  [AppErrorFlag.NO_APP]: 'No Web App \'{$appName}\' has been created - call Web initializeApp()',
  [AppErrorFlag.BAD_APP_NAME]: 'Illegal App name: \'{$appName}\'',
  [AppErrorFlag.DUPLICATE_APP]: 'Web App named \'{$appName}\' already exists',
  [AppErrorFlag.APP_DELETED]: 'Web App named \'{$appName}\' already deleted',
  [AppErrorFlag.INVALID_APP_ARG]: 'WebApp.{$appName}() takes either no argument or a ' + 'Firebase App instance.',
  [AppErrorFlag.INVALID_LOG_ARG]: 'First argument to `onLog` must be null or a function.',
}

export const ERROR_FACTORY = new ErrorFactory<AppErrorFlag, ErrorParams>(
  'api',
  'WebApp',
  ERRORS,
)

export enum RestrictFlag {
  LIMIT = 'limit',
  DISALLOW = 'disallow',
}
