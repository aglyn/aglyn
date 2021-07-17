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

import { AppEmitter, AppExtMap, AppOptions, WebApp } from '../types'
import { Timestamp } from '@aglyn/shared/feature/timestamp'
import { Mitt } from '@aglyn/shared/util/helpers'


export class WebAppModel implements WebApp {

  private readonly _event: AppEmitter = Mitt()

  private readonly _name: string
  private readonly _created: Timestamp
  private readonly _options: AppOptions
  private readonly _extensions: AppExtMap

  get event() {
    return this._event
  }

  get extension() {
    return this._extensions
  }

  get [Symbol.toStringTag]() {
    return `WebApp`
  }

  constructor(
    options: AppOptions,
  ) {
    this._created = Timestamp.now()
    this._options = {...options}
    this._name = this._options.name
    this._extensions = new Map()
  }

  public getCreated() {
    return this._created
  }

  public getName() {
    return this._name
  }

  public getOptions() {
    return this._options
  }

  public getExtensions() {
    return [...this._extensions.values()]
  }

  toString() {
    return `WebApp(name: ${this._name})`
  }

  toJSON() {
    return {
      created: this._created,
      name: this._name,
      options: this._options,
    }
  }
}
