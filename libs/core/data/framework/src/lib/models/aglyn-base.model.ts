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

import { Dictionary, LifecycleObserver, Serializable, StringLike } from '@aglyn/shared-data-types'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { getStaticField } from '@aglyn/shared-util-tools'
import { AglynEmitter } from '../constants/emitter'
import { AglynError } from '../constants/error'
import { AglynLogger } from '../types'


const TAG = 'AglynBaseModel'

export interface AglynBaseModel extends StringLike, Serializable, LifecycleObserver {
  getCreatedAt(): Timestamp
  getErrorFactory(): AglynError
  setErrorFactory(value: AglynError): this
  getEmitter(): AglynEmitter
  setEmitter(value: AglynEmitter): this
  getLogger(): AglynLogger
  setLogger(value: AglynLogger): this
}

export abstract class AglynBaseModel {
  public static readonly [Symbol.toStringTag]: string = TAG
  readonly #created: Timestamp
  #errorFactory: AglynError
  #emitter: AglynEmitter
  #logger: AglynLogger
  public get [Symbol.toStringTag](): string {
    return getStaticField(Symbol.toStringTag, this)
  }
  protected constructor() {
    this.#created = Timestamp.now()
  }
  public getCreatedAt = (): Timestamp => {
    return this.#created
  }
  public getErrorFactory = (): AglynError => {
    return this.#errorFactory
  }
  public setErrorFactory = (value: AglynError): this => {
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
  public toString = (): string => {
    return getStaticField(Symbol.toStringTag, this)
  }
  public toJSON = (): Dictionary => {
    return {
      created: this.#created,
    }
  }
}

export default AglynBaseModel
