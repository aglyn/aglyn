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

import {
  AGLYN_LOGGER,
  type AglynLogger,
  type IAglynAppController,
} from '@aglyn/core-data-foundation'
import {
  Logger,
  type LogHandler,
  type LogLevelString,
} from '@aglyn/shared-util-logger'
import { AglynAppController } from '../controllers/aglyn-app.controller'
import { _validateAppArg } from './app.api'

/**
 * Sets log handler for all SDKs components
 * @param app - the Aglyn instance
 * @param logHandler - An custom log handler to execute whenever the SDK makes
 *   a logging call.
 */
export function setUserLogHandler(
  app: IAglynAppController,
  logHandler: LogHandler,
): void
/**
 * Sets log handler for all SDKs components
 * @param ctx - the Logger instance otherwise will set global
 * @param logHandler - An custom log handler to execute whenever the SDK makes
 *   a logging call.
 */
export function setUserLogHandler(
  ctx: IAglynAppController | AglynLogger | null,
  logHandler: LogHandler,
): void {
  if (ctx instanceof AglynAppController) {
    _validateAppArg(ctx)
    ctx.getLogger().userLogHandler = logHandler
    return
  }
  if (ctx instanceof Logger) {
    ctx.userLogHandler = logHandler
    return
  }
  AGLYN_LOGGER.userLogHandler = logHandler
}

/**
 * Sets log level for all SDK components
 *
 * All of the log types above the current log level are captured (i.e. if
 * you set the log level to `info`, errors are logged, but `debug` and
 * `verbose` logs are not).
 *
 * @param app - the Aglyn instance
 * @param options - the options to pass to `setLogLevel()`
 */
export function setLogLevel(
  app: IAglynAppController,
  options: { logLevel: LogLevelString },
): void

/**
 * Sets log level for all SDK components
 *
 * All of the log types above the current log level are captured (i.e. if
 * you set the log level to `info`, errors are logged, but `debug` and
 * `verbose` logs are not).
 *
 * @param ctx - the Logger instance otherwise will set global
 * @param options - the options to pass to `setLogLevel()`
 */
export function setLogLevel(
  ctx: IAglynAppController | AglynLogger | null,
  options: { logLevel: LogLevelString },
): void {
  const { logLevel } = options
  if (ctx instanceof AglynAppController) {
    _validateAppArg(ctx)
    ctx.getLogger().setLogLevel(logLevel)
    return
  }
  if (ctx instanceof Logger) {
    ctx.setLogLevel(logLevel)
    return
  }
  AGLYN_LOGGER.setLogLevel(logLevel)
}
