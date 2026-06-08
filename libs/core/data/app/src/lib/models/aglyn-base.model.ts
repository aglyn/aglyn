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
  AglynBaseModelOptions,
  IAglynBaseModel,
} from '@aglyn/core-data-foundation'
import {
  AGLYN_EMITTER,
  AGLYN_ERROR,
  AGLYN_LOGGER,
  type AglynEmitter,
  type AglynErrorFactory,
  type AglynEventPayloads,
  AglynEventStateFlag,
  type AglynLogger,
} from '@aglyn/core-data-foundation'
import { _isArr } from '@aglyn/shared-util-tools'
import { ITimestamp, Timestamp } from '@aglyn/shared-util-timestamp'
import { getStaticField } from '@aglyn/shared-util-tools'

const TAG = 'AglynBaseModel'
const NS = 'com.aglyn.core.data.model.base'

export class AglynBaseModel<
  O extends AglynBaseModelOptions = AglynBaseModelOptions,
> implements IAglynBaseModel<O>
{
  readonly #options: O = null
  readonly #createdAt: ITimestamp
  #errorFactory: AglynErrorFactory
  #emitter: AglynEmitter
  #logger: AglynLogger

  public static get [Symbol.toStringTag](): string {
    return TAG
  }
  public get [Symbol.toStringTag](): string {
    return getStaticField(Symbol.toStringTag, this)
  }
  public static get namespace(): string {
    return NS
  }
  public get namespace(): string {
    return getStaticField('namespace', this)
  }
  public get options(): O {
    return this.#options
  }
  public get createdAt(): ITimestamp {
    return this.#createdAt
  }
  public get errorFactory(): AglynErrorFactory {
    return this.#errorFactory
  }
  public get logger(): AglynLogger {
    return this.#logger
  }
  public get emitter(): AglynEmitter {
    return this.#emitter
  }

  constructor(options: O) {
    this.#options = options
    this.#createdAt = Timestamp.now()
    this.#setup()
  }

  #setup() {
    const namespace = this.namespace
    const errorFactory = this.#options.errorFactory || AGLYN_ERROR
    const logger = this.#options.logger || AGLYN_LOGGER
    const logLevel = this.#options.logLevel

    this.#errorFactory = !namespace
      ? errorFactory
      : errorFactory.childFactory(namespace)
    this.#emitter = this.#options.emitter || AGLYN_EMITTER
    this.#logger = !logLevel ? logger : logger.setLogLevel(logLevel)
  }

  #doEvent<F extends AglynEventStateFlag>(
    flag: F,
    payload?: AglynEventPayloads[F],
  ): this {
    const mergedPayload = {
      ...payload,
      __eventTimestamp__: Timestamp.now().toJSON(),
      __eventController__: this.toJSON(),
    }
    this.logger.debug(flag, mergedPayload)
    this.emitter.emit(flag, mergedPayload)
    return this
  }
  #handleEvent<F1 extends AglynEventStateFlag, F2 extends AglynEventStateFlag>(
    flags: [before: F1, after: F2],
    payload:
      | undefined
      | AglynEventPayloads[F1 | F2]
      | [before: AglynEventPayloads[F1], after: AglynEventPayloads[F2]],
    handler: () => AglynEventPayloads[F2] | void,
  ): this {
    const [beforeFlag, afterFlag] = flags
    const beforePayload = _isArr(payload) ? payload[0] : payload
    this.#doEvent(beforeFlag, beforePayload)
    const res = handler()
    const afterPayload =
      res || (_isArr(payload) ? payload[1] || payload[0] : payload)
    this.#doEvent(afterFlag, afterPayload)
    return this
  }
  protected handleEvent<
    F1 extends AglynEventStateFlag,
    F2 extends AglynEventStateFlag,
  >(
    flags: [before: F1, after: F2],
    payload:
      | undefined
      | AglynEventPayloads[F1 | F2]
      | [before: AglynEventPayloads[F1], after: AglynEventPayloads[F2]],
    handler: () => AglynEventPayloads[F2] | void,
  ): this {
    this.#handleEvent(flags, payload, handler)
    return this
  }

  public onInitialize(): this {
    return this
  }
  /** @ignore */
  public __initialize__(props?: never): this {
    this.handleEvent(
      [
        AglynEventStateFlag.MODULE_INITIALIZING,
        AglynEventStateFlag.MODULE_INITIALIZED,
      ],
      { namespace: this.namespace },
      () => {
        this.onInitialize()
      },
    )
    return this
  }

  public onActivate(): this {
    return this
  }
  /** @ignore */
  public __activate__(props?: never): this {
    this.handleEvent(
      [
        AglynEventStateFlag.MODULE_ACTIVATING,
        AglynEventStateFlag.MODULE_ACTIVATED,
      ],
      { namespace: this.namespace },
      () => {
        this.onActivate()
      },
    )
    return this
  }

  public onDeactivate(): this {
    return this
  }
  /** @ignore */
  public __deactivate__(props?: never): this {
    this.handleEvent(
      [
        AglynEventStateFlag.MODULE_DEACTIVATING,
        AglynEventStateFlag.MODULE_DEACTIVATED,
      ],
      { namespace: this.namespace },
      () => {
        this.onDeactivate()
      },
    )
    return this
  }

  public onDestroy(): this {
    return this
  }
  /** @ignore */
  public __destroy__(props?: never): this {
    this.handleEvent(
      [
        AglynEventStateFlag.MODULE_DESTROYING,
        AglynEventStateFlag.MODULE_DESTROYED,
      ],
      { namespace: this.namespace },
      () => {
        this.onDestroy()
      },
    )
    return this
  }

  public toString(): string {
    return getStaticField(Symbol.toStringTag, this)
  }
  public toJSON() {
    return {
      namespace: this.namespace,
      created: this.#createdAt.toJSON(),
    }
  }

  public getOptions(): O {
    return this.#options
  }

  public getCreatedAt(): ITimestamp {
    return this.#createdAt
  }

  public getErrorFactory(): AglynErrorFactory {
    return this.#errorFactory
  }
  public setErrorFactory(value: AglynErrorFactory): this {
    this.#errorFactory = value
    return this
  }

  public getEmitter(): AglynEmitter {
    return this.#emitter
  }
  public setEmitter(value: AglynEmitter): this {
    this.#emitter = value
    return this
  }
  public get all() {
    return this.#emitter.all
  }
  public on(type, handler) {
    return this.#emitter.on(type, handler)
  }
  public off(type, handler?) {
    return this.#emitter.off(type, handler)
  }
  public emit(type, handler?) {
    return this.#emitter.emit(type, handler)
  }

  public getLogger(): AglynLogger {
    return this.#logger
  }
  public setLogger(value: AglynLogger): this {
    this.#logger = value
    return this
  }
  public setLogLevel(val) {
    return this.#logger.setLogLevel(val) as any
  }
  public setUserLogHandler(logCallback, options) {
    return this.#logger.setUserLogHandler(logCallback, options)
  }
  public debug(...args) {
    return this.#logger.debug(...args)
  }
  public error(...args) {
    return this.#logger.error(...args)
  }
  public info(...args) {
    return this.#logger.info(...args)
  }
  public log(...args) {
    return this.#logger.log(...args)
  }
  public warn(...args) {
    return this.#logger.warn(...args)
  }
  public get logHandler() {
    return this.#logger.logHandler
  }
  public get logLevel() {
    return this.#logger.logLevel
  }
  public get userLogHandler() {
    return this.#logger.userLogHandler
  }
}

export default AglynBaseModel
