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

import type {Serializable, StringLike} from '@aglyn/shared-data-types'
import type {LogLevelString} from '@aglyn/shared-util-logger'
import type {Timestamp} from '@aglyn/shared-util-timestamp'
import type {AglynEmitter} from '../constants/emitter'
import type {AglynErrorFactory} from '../constants/error'
import type {AglynLogger} from '../constants/logger'
import type {AglynLifecycleObserver, AglynLoadableObserver} from './generic.types'


export interface AglynBaseModelOptions {
  logLevel?: LogLevelString
  errorFactory?: AglynErrorFactory
  emitter?: AglynEmitter
  logger?: AglynLogger
}

export interface IAglynBaseModel<O extends AglynBaseModelOptions = AglynBaseModelOptions, LO = never>
  extends StringLike, Serializable, AglynLifecycleObserver<LO>, AglynLoadableObserver<LO> {

  readonly [Symbol.toStringTag]: string
  readonly namespace: string
  readonly createdAt: Timestamp
  readonly options: O
  readonly errorFactory: AglynErrorFactory
  readonly logger: AglynLogger
  readonly emitter: AglynEmitter

  getCreatedAt(): Timestamp
  getOptions(): O
  getErrorFactory(): AglynErrorFactory
  setErrorFactory(value: AglynErrorFactory): this
  getEmitter(): AglynEmitter
  setEmitter(value: AglynEmitter): this
  getLogger(): AglynLogger
  setLogger(value: AglynLogger): this
}

export interface AglynBaseModelT<O extends AglynBaseModelOptions = AglynBaseModelOptions, LO = never> {
  readonly [Symbol.toStringTag]: string
  readonly namespace: string

  new(options: O): IAglynBaseModel<O, LO>
}
