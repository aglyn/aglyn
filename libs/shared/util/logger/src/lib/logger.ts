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

/**
 * A container for all of the Logger instances
 */
export const instances: Logger[] = []

/**
 * The JS SDK supports 5 log levels and also allows a user the ability to
 * silence the logs altogether.
 *
 * The order is a follows:
 * DEBUG < VERBOSE < INFO < WARN < ERROR
 *
 * All of the log types above the current log level will be captured (i.e. if
 * you set the log level to `INFO`, errors will still be logged, but `DEBUG` and
 * `VERBOSE` logs will not)
 */
export enum LogLevel {
  DEBUG = 'debug',
  ERROR = 'error',
  INFO = 'info',
  SILENT = 'silent',
  VERBOSE = 'verbose',
  WARN = 'warn',
}

export type LogLevelString = LogLevel | keyof Console

/**
 * We allow users the ability to pass their own log handler. We will pass the
 * type of log, the current log level, and any other arguments passed (i.e. the
 * messages that the user wants to log) to this function.
 */
export type LogHandler = (
  loggerInstance: Logger,
  level: LogLevelString,
  ...args: unknown[]
) => void

export interface LogOptions {
  level: LogLevel | keyof Console
}

export interface LogCallbackParams {
  level: LogLevel | keyof Console
  message: string
  args: unknown[]
  type: string
}

export type LogCallback = (callbackParams: LogCallbackParams) => void

/**
 * By default, `console.debug` is not displayed in the developer console (in
 * chrome). To avoid forcing users to have to opt-in to these logs twice
 * (i.e. once for firebase, and once in the console), we are sending `DEBUG`
 * logs to the `console.log` function.
 */
export const ConsoleMethodKey: Partial<Record<string, string>> = {
  [LogLevel.DEBUG]: 'log',
  [LogLevel.VERBOSE]: 'log',
  [LogLevel.INFO]: 'info',
  [LogLevel.WARN]: 'warn',
  [LogLevel.ERROR]: 'error',
}

/**
 * Rank of each level, so "at or above the configured level" is comparable.
 *
 * The levels are string values, so `level >= instance.logLevel` compares them
 * alphabetically — under which `'debug' >= 'error'` holds and `'warn' >= 'info'`
 * does not. A level needs a number to be ordered by.
 *
 * SILENT sits above ERROR: it is the level at which nothing qualifies.
 */
const LOG_LEVEL_RANK: Record<string, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.VERBOSE]: 1,
  [LogLevel.INFO]: 2,
  [LogLevel.WARN]: 3,
  [LogLevel.ERROR]: 4,
  [LogLevel.SILENT]: 5,
}

/**
 * Whether a message at `level` clears the `configured` threshold.
 *
 * `setLogLevel` accepts any `keyof Console`, not just a `LogLevel`, so either
 * side can be a string this table has no rank for. An unranked THRESHOLD falls
 * back to the default one rather than admitting everything; an unranked
 * MESSAGE is passed through to the invalid-logType throw below, which is what
 * names the mistake.
 */
function meetsLogLevel(level: LogLevelString, configured: LogLevelString): boolean {
  const messageRank = LOG_LEVEL_RANK[level as string]
  if (messageRank === undefined) return true
  const threshold =
    LOG_LEVEL_RANK[configured as string] ?? LOG_LEVEL_RANK[FALLBACK_LOG_LEVEL]
  return messageRank >= threshold
}

/**
 * The default log handler will forward DEBUG, VERBOSE, INFO, WARN, and ERROR
 * messages on to their corresponding console counterparts (if the log method
 * is supported by the current log level)
 *
 * ## The level was decorative (AGL-1151)
 *
 * This handler used to test only the level of the CALL — dropping the literal
 * `'silent'` and forwarding everything else — so `_logLevel` decided nothing
 * and `logger.debug()` reached `console.log` at every level including the
 * default INFO. On a published tenant page that is not a stray line: plugin
 * registration walks every component and preset through `lifecycleEvent`,
 * which logs a before and an after for each, so a visitor's browser formatted
 * and retained ~400 `console.log` calls of internal event names and payloads
 * before the page was interactive — measurably, and on a customer's site.
 *
 * The threshold is now the INSTANCE's, which is what the level's own docblock
 * has always said it means.
 */
export const defaultLogHandler: LogHandler = (
  instance: Logger,
  level: LogLevelString,
  ...args: any[]
): void => {
  if (!level || level === 'silent') return
  if (!meetsLogLevel(level, instance.logLevel)) return

  const now = new Date().toISOString()
  const method = ConsoleMethodKey[level]

  if (method) {
    return (console as unknown as Record<string, (...a: any[]) => void>)[method](`[${now}]  ${instance.name}`, ...args)
  }

  throw new Error(
    `Attempted to log a message with an invalid logType (value: ${level})`,
  )
}

export const FALLBACK_LOG_LEVEL = LogLevel.INFO

/**
 * Whether this build is something other than a deployed one.
 *
 * Proven, never assumed: the default is the QUIET level, and only a readable
 * `NODE_ENV` that is positively not `production` raises it. A bundler that
 * does not substitute the expression, or a realm-plugin bundle with no
 * `process` at all, leaves this false and the deployed behaviour stands —
 * which is the direction a wrong answer here has to fail in.
 *
 * Dot notation on both reads is load-bearing: the substitution is textual and
 * matches only this exact form.
 */
const DEVELOPMENT_RUNTIME: boolean =
  typeof process !== 'undefined' &&
  typeof process.env !== 'undefined' &&
  typeof process.env.NODE_ENV === 'string' &&
  process.env.NODE_ENV !== 'production'

/**
 * TODO: INTEGRATE PACKAGE`debug`
 */
export class Logger {
  /**
   * The default log level.
   *
   * DEBUG outside production, so a developer keeps the running commentary the
   * handler used to emit unconditionally, and a deployed build does not.
   * Nothing in the workspace calls `setLogLevel`, so this constant is the only
   * threshold that applies anywhere until something does.
   *
   * `process` is guarded because this library is reachable from a browser
   * realm that has no bundler substituting `process.env` — a marketplace
   * plugin bundle. Dot notation is load-bearing: the substitution is textual
   * and never sees the bracket form.
   */
  public static defaultLogLevel: LogLevel = DEVELOPMENT_RUNTIME
    ? LogLevel.DEBUG
    : LogLevel.INFO

  _logLevel: LogLevelString = Logger.defaultLogLevel
  _logHandler: LogHandler = defaultLogHandler
  _userLogHandler: LogHandler | null = null

  /**
   * The log level of the given Logger instance.
   */
  public get logLevel(): LogLevelString {
    return this._logLevel
  }
  /**
   * The log level of the given Logger instance.
   */
  public set logLevel(val: LogLevelString) {
    if (!(val in LogLevel)) {
      throw new TypeError(`Invalid value "${val}" assigned to \`logLevel\``)
    }
    this._logLevel = val
  }
  /**
   * The main (internal) log handler for the Logger instance.
   * Can be set to a new function in internal package code but not by user.
   */
  public get logHandler(): LogHandler {
    return this._logHandler
  }
  /**
   * The main (internal) log handler for the Logger instance.
   * Can be set to a new function in internal package code but not by user.
   */
  public set logHandler(val: LogHandler) {
    if (typeof val !== 'function') {
      throw new TypeError('Value assigned to `logHandler` must be a function')
    }
    this._logHandler = val
  }
  /**
   * The optional, additional, user-defined log handler for the Logger instance.
   */
  public get userLogHandler(): LogHandler | null {
    return this._userLogHandler
  }
  /**
   * The optional, additional, user-defined log handler for the Logger instance.
   */
  public set userLogHandler(val: LogHandler | null) {
    this._userLogHandler = val
  }

  /**
   * Gives you an instance of a Logger to capture messages according to
   * Firebase's logging scheme.
   *
   * @param name The name that the logs will be associated with
   */
  constructor(public name?: string) {
    /**
     * Capture the current instance for later use
     */
    instances.push(this)
  }

  /**
   * Workaround for setter/getter having to be the same type
   */
  public setLogLevel(val?: LogLevelString): this {
    if ((val && (LogLevel as Record<string, unknown>)[(LogLevel as Record<string, unknown>)[val as string] as string]) || (console as unknown as Record<string, unknown>)[val as string])
      this._logLevel = val as LogLevel
    else this._logLevel = FALLBACK_LOG_LEVEL
    return this
  }
  /**
   * Set the log level for all logger instances
   */
  public static setLogLevel(val?: LogLevelString): typeof Logger {
    instances.forEach((inst) => inst.setLogLevel(val))
    return this
  }

  /**
   * The optional, additional, user-defined log handler for the Logger instance.
   */
  public setUserLogHandler(
    logCallback: LogCallback | null,
    options?: LogOptions,
  ): void {
    let customLogLevel: LogLevelString | null = null
    if (
      options?.level &&
      ((LogLevel as Record<string, unknown>)[(LogLevel as Record<string, unknown>)[options.level as string] as string] || (console as unknown as Record<string, unknown>)[options.level as string])
    ) {
      customLogLevel = options.level
    }
    if (logCallback === null) {
      this.userLogHandler = null
    } else {
      this.userLogHandler = (
        instance: Logger,
        level: LogLevelString,
        ...args: unknown[]
      ) => {
        const message = args
          .map((arg) => {
            if (arg == null) {
              return null
            } else if (typeof arg === 'string') {
              return arg
            } else if (typeof arg === 'number' || typeof arg === 'boolean') {
              return arg.toString()
            } else if (arg instanceof Error) {
              return arg.message
            } else {
              try {
                return JSON.stringify(arg)
              } catch (ignored) {
                return null
              }
            }
          })
          .filter((arg) => arg)
          .join(' ')
        if (level >= (customLogLevel ?? instance.logLevel)) {
          logCallback({
            args,
            message,
            type: instance.name,
            level:
              (options?.level &&
                ((LogLevel as Record<string, unknown>)[(LogLevel as Record<string, unknown>)[options.level as string] as string] ||
                  (console as unknown as Record<string, unknown>)[options.level as string])) as LogLevel ||
              FALLBACK_LOG_LEVEL,
          })
        }
      }
    }
  }
  /**
   * The optional, additional, user-defined log handler for the Logger instance.
   */
  public static setUserLogHandler(
    logCallback: LogCallback | null,
    options?: LogOptions,
  ): void {
    for (const instance of instances) {
      instance.setUserLogHandler(logCallback, options)
    }
  }

  /**
   * The functions below are all based on the `console` interface
   */

  /** {@inheritDoc Console.debug} */
  public debug(...args: unknown[]): void {
    this._logHandler(this, LogLevel.DEBUG, ...args)
    this._userLogHandler && this._userLogHandler(this, LogLevel.DEBUG, ...args)
  }
  /** {@inheritDoc Console.log} */
  public log(...args: unknown[]): void {
    this._logHandler(this, LogLevel.VERBOSE, ...args)
    this._userLogHandler &&
      this._userLogHandler(this, LogLevel.VERBOSE, ...args)
  }
  /** {@inheritDoc Console.info} */
  public info(...args: unknown[]): void {
    this._logHandler(this, LogLevel.INFO, ...args)
    this._userLogHandler && this._userLogHandler(this, LogLevel.INFO, ...args)
  }
  /** {@inheritDoc Console.warn} */
  public warn(...args: unknown[]): void {
    this._logHandler(this, LogLevel.WARN, ...args)
    this._userLogHandler && this._userLogHandler(this, LogLevel.WARN, ...args)
  }
  /** {@inheritDoc Console.error} */
  public error(...args: unknown[]): void {
    this._logHandler(this, LogLevel.ERROR, ...args)
    this._userLogHandler && this._userLogHandler(this, LogLevel.ERROR, ...args)
  }
}

export default Logger
