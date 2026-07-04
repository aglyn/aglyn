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
} from '../../foundation'
import {
  AGLYN_EMITTER,
  AGLYN_ERROR,
  AGLYN_LOGGER,
  type AglynEmitter,
  type AglynErrorFactory,
  type AglynEventPayloads,
  AglynEventStateFlag,
  type AglynLogger,
} from '../../foundation'
import { _isArr } from '@aglyn/shared-util-tools'
import { ITimestamp, Timestamp } from '@aglyn/shared-util-timestamp'
import { getStaticField } from '@aglyn/shared-util-tools'

const TAG = 'AglynBaseModel'
const NS = 'com.aglyn.core.data.model.base'

export class AglynBaseModel<
  O extends AglynBaseModelOptions = AglynBaseModelOptions,
> implements IAglynBaseModel<O>
{
  readonly _options: O = null
  readonly _createdAt: ITimestamp
  _errorFactory: AglynErrorFactory
  _emitter: AglynEmitter
  _logger: AglynLogger

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
    return this._options
  }
  public get createdAt(): ITimestamp {
    return this._createdAt
  }
  public get errorFactory(): AglynErrorFactory {
    return this._errorFactory
  }
  public get logger(): AglynLogger {
    return this._logger
  }
  public get emitter(): AglynEmitter {
    return this._emitter
  }

  constructor(options: O) {
    this._options = options
    this._createdAt = Timestamp.now()
    this.setup()
  }

  private setup() {
    const namespace = this.namespace
    const errorFactory = this._options.errorFactory || AGLYN_ERROR
    const logger = this._options.logger || AGLYN_LOGGER
    const logLevel = this._options.logLevel

    this._errorFactory = !namespace
      ? errorFactory
      : errorFactory.childFactory(namespace)
    this._emitter = this._options.emitter || AGLYN_EMITTER
    this._logger = !logLevel ? logger : logger.setLogLevel(logLevel)
  }

  private doEvent<F extends AglynEventStateFlag>(
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
  private handleEventInternal<F1 extends AglynEventStateFlag, F2 extends AglynEventStateFlag>(
    flags: [before: F1, after: F2],
    payload:
      | undefined
      | AglynEventPayloads[F1 | F2]
      | [before: AglynEventPayloads[F1], after: AglynEventPayloads[F2]],
    handler: () => AglynEventPayloads[F2] | void,
  ): this {
    const [beforeFlag, afterFlag] = flags
    const beforePayload = _isArr(payload) ? payload[0] : payload
    this.doEvent(beforeFlag, beforePayload)
    const res = handler()
    const afterPayload =
      res || (_isArr(payload) ? payload[1] || payload[0] : payload)
    this.doEvent(afterFlag, afterPayload)
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
    this.handleEventInternal(flags, payload, handler)
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
      created: this._createdAt.toJSON(),
    }
  }

  public getOptions(): O {
    return this._options
  }

  public getCreatedAt(): ITimestamp {
    return this._createdAt
  }

  public getErrorFactory(): AglynErrorFactory {
    return this._errorFactory
  }
  public setErrorFactory(value: AglynErrorFactory): this {
    this._errorFactory = value
    return this
  }

  public getEmitter(): AglynEmitter {
    return this._emitter
  }
  public setEmitter(value: AglynEmitter): this {
    this._emitter = value
    return this
  }
  public get all() {
    return this._emitter.all
  }
  public on(type: any, handler: any) {
    return this._emitter.on(type, handler)
  }
  public off(type: any, handler?: any) {
    return this._emitter.off(type, handler)
  }
  public emit(type: any, handler?: any) {
    return this._emitter.emit(type, handler)
  }

  public getLogger(): AglynLogger {
    return this._logger
  }
  public setLogger(value: AglynLogger): this {
    this._logger = value
    return this
  }
  public setLogLevel(val: Parameters<AglynLogger['setLogLevel']>[0]) {
    return this._logger.setLogLevel(val)
  }
  public setUserLogHandler(
    logCallback: Parameters<AglynLogger['setUserLogHandler']>[0],
    options: Parameters<AglynLogger['setUserLogHandler']>[1],
  ) {
    return this._logger.setUserLogHandler(logCallback, options)
  }
  public debug(...args: Parameters<AglynLogger['debug']>) {
    return this._logger.debug(...args)
  }
  public error(...args: Parameters<AglynLogger['error']>) {
    return this._logger.error(...args)
  }
  public info(...args: Parameters<AglynLogger['info']>) {
    return this._logger.info(...args)
  }
  public log(...args: Parameters<AglynLogger['log']>) {
    return this._logger.log(...args)
  }
  public warn(...args: Parameters<AglynLogger['warn']>) {
    return this._logger.warn(...args)
  }
  public get logHandler() {
    return this._logger.logHandler
  }
  public get logLevel() {
    return this._logger.logLevel
  }
  public get userLogHandler() {
    return this._logger.userLogHandler
  }
}

export default AglynBaseModel
