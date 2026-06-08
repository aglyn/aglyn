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
 * The default log handler will forward DEBUG, VERBOSE, INFO, WARN, and ERROR
 * messages on to their corresponding console counterparts (if the log method
 * is supported by the current log level)
 */
export const defaultLogHandler: LogHandler = (
  instance: Logger,
  level: LogLevelString,
  ...args: any[]
): void => {
  if (!level || level === 'silent') return

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
 * TODO: INTEGRATE PACKAGE`debug`
 */
export class Logger {
  /**
   * The default log level
   */
  public static defaultLogLevel: LogLevel = LogLevel.INFO

  #logLevel: LogLevelString = Logger.defaultLogLevel
  #logHandler: LogHandler = defaultLogHandler
  #userLogHandler: LogHandler | null = null

  /**
   * The log level of the given Logger instance.
   */
  public get logLevel(): LogLevelString {
    return this.#logLevel
  }
  /**
   * The log level of the given Logger instance.
   */
  public set logLevel(val: LogLevelString) {
    if (!(val in LogLevel)) {
      throw new TypeError(`Invalid value "${val}" assigned to \`logLevel\``)
    }
    this.#logLevel = val
  }
  /**
   * The main (internal) log handler for the Logger instance.
   * Can be set to a new function in internal package code but not by user.
   */
  public get logHandler(): LogHandler {
    return this.#logHandler
  }
  /**
   * The main (internal) log handler for the Logger instance.
   * Can be set to a new function in internal package code but not by user.
   */
  public set logHandler(val: LogHandler) {
    if (typeof val !== 'function') {
      throw new TypeError('Value assigned to `logHandler` must be a function')
    }
    this.#logHandler = val
  }
  /**
   * The optional, additional, user-defined log handler for the Logger instance.
   */
  public get userLogHandler(): LogHandler | null {
    return this.#userLogHandler
  }
  /**
   * The optional, additional, user-defined log handler for the Logger instance.
   */
  public set userLogHandler(val: LogHandler | null) {
    this.#userLogHandler = val
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
      this.#logLevel = val as LogLevel
    else this.#logLevel = FALLBACK_LOG_LEVEL
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
    this.#logHandler(this, LogLevel.DEBUG, ...args)
    this.#userLogHandler && this.#userLogHandler(this, LogLevel.DEBUG, ...args)
  }
  /** {@inheritDoc Console.log} */
  public log(...args: unknown[]): void {
    this.#logHandler(this, LogLevel.VERBOSE, ...args)
    this.#userLogHandler &&
      this.#userLogHandler(this, LogLevel.VERBOSE, ...args)
  }
  /** {@inheritDoc Console.info} */
  public info(...args: unknown[]): void {
    this.#logHandler(this, LogLevel.INFO, ...args)
    this.#userLogHandler && this.#userLogHandler(this, LogLevel.INFO, ...args)
  }
  /** {@inheritDoc Console.warn} */
  public warn(...args: unknown[]): void {
    this.#logHandler(this, LogLevel.WARN, ...args)
    this.#userLogHandler && this.#userLogHandler(this, LogLevel.WARN, ...args)
  }
  /** {@inheritDoc Console.error} */
  public error(...args: unknown[]): void {
    this.#logHandler(this, LogLevel.ERROR, ...args)
    this.#userLogHandler && this.#userLogHandler(this, LogLevel.ERROR, ...args)
  }
}

export default Logger
