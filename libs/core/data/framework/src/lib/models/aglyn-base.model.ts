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

import { Dictionary, Serializable, StringLike } from '@aglyn/shared-data-types'
import { LogLevelString } from '@aglyn/shared-util-logger'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { getStaticField } from '@aglyn/shared-util-tools'
import { AGLYN_EMITTER, AglynEmitter } from '../constants/emitter'
import { AGLYN_ERROR, AglynErrorFactory } from '../constants/error'
import { AGLYN_LOGGER, AglynLogger } from '../constants/logger'
import { AGLYN_PLATFORM, AglynPlatform } from '../constants/platform'
import { AglynVersion, SDK_VERSION } from '../constants/version'
import { AglynLifecycleObserver } from '../types'


export interface AglynBaseModelOptions {
  logLevel?: LogLevelString
  errorFactory?: AglynErrorFactory
  emitter?: AglynEmitter
  logger?: AglynLogger
}

export interface AglynBaseModel<O extends AglynBaseModelOptions = AglynBaseModelOptions> extends StringLike, Serializable, AglynLifecycleObserver {
  getCreatedAt(): Timestamp
  getOptions(): O
  getErrorFactory(): AglynErrorFactory
  setErrorFactory(value: AglynErrorFactory): this
  getEmitter(): AglynEmitter
  setEmitter(value: AglynEmitter): this
  getLogger(): AglynLogger
  setLogger(value: AglynLogger): this
}

const TAG = 'AglynBaseModel'
const MODULE_NAME = 'model'

export abstract class AglynBaseModel<O extends AglynBaseModelOptions = AglynBaseModelOptions> {

  public static readonly [Symbol.toStringTag]: string = TAG
  public static readonly namespace: string = MODULE_NAME
  public static readonly platform: AglynPlatform = AGLYN_PLATFORM
  public static readonly sdkVersion: AglynVersion = SDK_VERSION

  readonly #options: O = null
  readonly #created: Timestamp
  #errorFactory: AglynErrorFactory
  #emitter: AglynEmitter
  #logger: AglynLogger

  public get [Symbol.toStringTag](): string {
    return getStaticField(Symbol.toStringTag, this)
  }
  public get namespace(): string {
    return getStaticField('namespace', this)
  }
  public get platform(): AglynPlatform {
    return getStaticField('platform', this)
  }
  public get sdkVersion(): AglynVersion {
    return getStaticField('sdkVersion', this)
  }
  public get options(): O {
    return this.#options
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

  protected constructor(options: O) {
    this.#options = {...options}
    this.#created = Timestamp.now()
    this.#setup()
  }
  #setup() {
    const namespace = this.namespace

    const errorFactory = this.#options.errorFactory || AGLYN_ERROR
    this.#errorFactory = !namespace ? errorFactory : errorFactory.childFactory(namespace)

    this.#emitter = this.#options.emitter || AGLYN_EMITTER

    const logger = this.#options.logger || AGLYN_LOGGER
    const logLevel = this.#options.logLevel
    this.#logger = !logLevel ? logger : logger.setLogLevel(logLevel)
  }

  public toString(): string {
    return getStaticField(Symbol.toStringTag, this)
  }
  public toJSON(): Dictionary {
    return {
      namespace: this.namespace,
      created: this.#created,
      sdkVersion: this.sdkVersion,
      platform: this.platform,
    }
  }

  public getOptions = (): O => {
    return this.#options
  }
  public getCreatedAt = (): Timestamp => {
    return this.#created
  }
  public getErrorFactory = (): AglynErrorFactory => {
    return this.#errorFactory
  }
  public setErrorFactory = (value: AglynErrorFactory): this => {
    this.#errorFactory = value
    return this
  }
  public getEmitter = (): AglynEmitter => {
    return this.#emitter
  }
  public setEmitter = (value: AglynEmitter): this => {
    this.#emitter = value
    return this
  }
  public getLogger = (): AglynLogger => {
    return this.#logger
  }
  public setLogger = (value: AglynLogger): this => {
    this.#logger = value
    return this
  }
}

export default AglynBaseModel
