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

import { _isFnT, _isNull } from '@aglyn/shared-util-guards'
import { LogCallback, Logger, LogLevelString, LogOptions } from '@aglyn/shared-util-logger'
import { AGLYN_ERROR, AglynErrorEventFlag } from '../constants/error'


/**
 * Sets log handler for all SDKs components
 * @param callbackFn - An optional custom log handler that executes user code whenever
 *   the SDK makes a logging call.
 * @param options - the logger options to pass to `Logger.setUserLogHandler()`
 */
export function onLog(callbackFn: LogCallback | null, options?: LogOptions): void {
  if (!_isNull(callbackFn) && !_isFnT(callbackFn)) {
    throw AGLYN_ERROR.create(AglynErrorEventFlag.INVALID_LOG_ARG, undefined)
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
