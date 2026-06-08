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

import {DoD} from '@aglyn/shared-data-types'
import {Crud} from '@aglyn/shared-util-tools'
import {RefController} from '../interfaces/ref-controller'


/**
 *
 *
 * @export
 * @class BaseRefController
 * @extends {Crud<DoD.Base<S>>}
 * @implements {RefController<S>}
 * @template S
 */
export class BaseRefController<S, T> extends Crud<T> implements RefController<T> {

  constructor(public readonly meta: DoD.Ref.Base<S>, model: T) {
    super(model)
  }

  /** @inheritdoc */
  public preInit?(): void

  /**
   * Initialize the instance, should be called immediately after
   * creating the object. If overridden you must call preInit and
   * onInit yourself, do not super this method.
   *
   * @public
   * @memberof BaseRefController
   */
  public init(): this {
    this.preInit && this.preInit()
    this.onInit && this.onInit()
    return this
  }

  /** @inheritdoc */
  public onInit?(): void

  public getId(): DoD.PKey {
    return this.meta.id
  }

  public setId(value: DoD.PKey): this {
    this.meta.id = value
    return this
  }

  public getSchema(): S {
    return this.meta.schema
  }

  public setSchema(value: S): this {
    this.meta.schema = value
    return this
  }

}
