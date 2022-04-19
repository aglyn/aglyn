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

import {Timestamp} from '@aglyn/shared-util-timestamp'
import {getStaticField} from '@aglyn/shared-util-tools'
import {AGLYN_EMITTER, type AglynEmitter, AglynEventStateFlag} from '../constants/emitter'
import {AGLYN_ERROR, type AglynErrorFactory} from '../constants/error'
import {AGLYN_LOGGER, type AglynLogger} from '../constants/logger'
import {type AglynBaseModelOptions, type IAglynBaseModel} from '../types/aglyn-base.types'


const TAG = 'AglynBaseModel'
const NS = 'aglyn.core.data.framework.model.base'

export class AglynBaseModel<O extends AglynBaseModelOptions = AglynBaseModelOptions> implements IAglynBaseModel<O> {

  public static readonly [Symbol.toStringTag]: string = TAG
  public static readonly namespace: string = NS

  readonly #options: O = null
  readonly #createdAt: Timestamp
  #errorFactory: AglynErrorFactory
  #emitter: AglynEmitter
  #logger: AglynLogger

  public get [Symbol.toStringTag](): string {return getStaticField(Symbol.toStringTag, this)}
  public get namespace(): string {return getStaticField('namespace', this)}
  public get options(): O {return this.#options}
  public get createdAt(): Timestamp {return this.#createdAt}
  public get errorFactory(): AglynErrorFactory {return this.#errorFactory}
  public get logger(): AglynLogger {return this.#logger}
  public get emitter(): AglynEmitter {return this.#emitter}

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

    this.#errorFactory = !namespace ? errorFactory : errorFactory.childFactory(namespace)
    this.#emitter = this.#options.emitter || AGLYN_EMITTER
    this.#logger = !logLevel ? logger : logger.setLogLevel(logLevel)
  }

  private handleEvent(flag: AglynEventStateFlag): this {
    this.logger.debug(flag, {namespace: this.namespace})
    this.emitter.emit(flag, {namespace: this.namespace})
    return this
  }

  public onInitialize(): this {
    return this
  }
  public _initialize(props?: never): this {
    this.handleEvent(AglynEventStateFlag.MODULE_INITIALIZING)
    this.onInitialize()
    this.handleEvent(AglynEventStateFlag.MODULE_INITIALIZED)
    return this
  }

  public onActivate(): this {
    return this
  }
  public _activate(props?: never): this {
    this.handleEvent(AglynEventStateFlag.MODULE_ACTIVATING)
    this.onActivate()
    this.handleEvent(AglynEventStateFlag.MODULE_ACTIVATED)
    return this
  }

  public onDeactivate(): this {
    return this
  }
  public _deactivate(props?: never): this {
    this.handleEvent(AglynEventStateFlag.MODULE_DEACTIVATING)
    this.onDeactivate()
    this.handleEvent(AglynEventStateFlag.MODULE_DEACTIVATED)
    return this
  }

  public onDestroy(): this {
    return this
  }
  public _destroy(props?: never): this {
    this.handleEvent(AglynEventStateFlag.MODULE_DESTROYING)
    this.onDestroy()
    this.handleEvent(AglynEventStateFlag.MODULE_DESTROYED)
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
  public getCreatedAt(): Timestamp {
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
  public getLogger(): AglynLogger {
    return this.#logger
  }
  public setLogger(value: AglynLogger): this {
    this.#logger = value
    return this
  }
}

export default AglynBaseModel
