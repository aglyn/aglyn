/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import {
  type ErrorTagMessages,
  NsErrorFactory,
} from '@aglyn/shared-util-errors'
import type { AppUUN } from '../definitions/app.types'
import type { ExtensionUUN } from '../definitions/extensions.types'
import type { PayloadData, PayloadParams } from '../definitions/shared'
import { AglynLifecycleFlag } from './lifecycle'

export enum AglynErrorEventFlag {
  APP_NONE = 'error:app:none',
  APP_EXISTS = 'error:app:exists',
  APP_DELETED = 'error:app:deleted',
  APP_BAD_NAME = 'error:app:bad-name',
  APP_BAD_INSTANCE = 'error:app:bad-instance',

  MODULE_MISSING_MEMBER = 'error:module:missing-member',
  MODULE_INVALID_LIFECYCLE = 'error:module:invalid-lifecycle',

  EXTENSION_NONE = 'error:module:extensions:no-extension',
  EXTENSION_BAD_MODULE_LOADER = 'error:module:extensions:bad-loader',
  EXTENSION_BAD_MODULE = 'error:module:extensions:bad-module',
}

export interface AglynErrorEventParams
  extends Record<AglynErrorEventType, unknown> {
  [AglynErrorEventFlag.APP_NONE]: PayloadData<{ appName: AppUUN }>
  [AglynErrorEventFlag.APP_BAD_NAME]: PayloadData<{ appName: AppUUN }>
  [AglynErrorEventFlag.APP_EXISTS]: PayloadData<{ appName: AppUUN }>
  [AglynErrorEventFlag.APP_DELETED]: PayloadData<{ appName: AppUUN }>
  [AglynErrorEventFlag.APP_BAD_INSTANCE]: PayloadData<{ appName: AppUUN }>

  [AglynErrorEventFlag.MODULE_MISSING_MEMBER]: PayloadData<{
    moduleName: ExtensionUUN
    memberMethod: string
  }>
  [AglynErrorEventFlag.MODULE_INVALID_LIFECYCLE]: PayloadData<{
    now: AglynLifecycleFlag
    prev: AglynLifecycleFlag
  }>

  [AglynErrorEventFlag.EXTENSION_NONE]: PayloadData<{
    extensionName: ExtensionUUN
  }>
  [AglynErrorEventFlag.EXTENSION_BAD_MODULE_LOADER]: PayloadData<{
    appName: AppUUN
  }>
  [AglynErrorEventFlag.EXTENSION_BAD_MODULE]: PayloadData<{
    extensionName?: ExtensionUUN
    appName: AppUUN
  }>
}

export const AglynErrorEventMessageTemplates: ErrorTagMessages<
  IndexOf<typeof AglynErrorEventFlag>
> = {
  [AglynErrorEventFlag.APP_NONE]:
    "No AglynApp '{$appName}' has been created, must call initializeApp()",
  [AglynErrorEventFlag.APP_BAD_NAME]: "Illegal App name: '{$appName}'",
  [AglynErrorEventFlag.APP_EXISTS]:
    "AglynApp named '{$appName}' already exists",
  [AglynErrorEventFlag.APP_DELETED]:
    "AglynApp named '{$appName}' already deleted",
  [AglynErrorEventFlag.APP_BAD_INSTANCE]:
    'AglynApp.{$appName}() takes either no argument or a AglynApp instance.',

  [AglynErrorEventFlag.MODULE_MISSING_MEMBER]:
    "Module '{$namespace}' must implement member method AglynModule.{$memberMethod}()",
  [AglynErrorEventFlag.MODULE_INVALID_LIFECYCLE]:
    "Inappropriate lifecycle '{$now}' during lifecycle '{$prev}'",

  [AglynErrorEventFlag.EXTENSION_NONE]:
    "No AppExtension '{$moduleName}' has been registered on AglynApp '{$appName}'",
  [AglynErrorEventFlag.EXTENSION_BAD_MODULE_LOADER]:
    'Invalid module loader has been provided',
  [AglynErrorEventFlag.EXTENSION_BAD_MODULE]:
    "Bad AglynExtension module '{$namespace}' provided on AglynApp '{$appName}'",
}

export type AglynErrorParams = PayloadParams<AglynErrorEventParams>
export type AglynErrorEventType = IndexOf<typeof AglynErrorEventFlag>
export type AglynErrorFactory = NsErrorFactory<
  AglynErrorEventFlag,
  AglynErrorParams
>

export const AGLYN_ERROR: AglynErrorFactory = new NsErrorFactory(
  '@aglyn',
  'sdk',
  AglynErrorEventMessageTemplates,
)
export default AGLYN_ERROR
