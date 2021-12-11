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

import { DoD } from '@aglyn/shared-data-types'

import { BaseRefController } from './BaseRefController'


/**
 *
 *
 * @export
 * @class FieldRefController
 * @extends {BaseRefController<DoD.Ref.Field<S>>}
 * @template S
 */
export class FieldRefController<S extends DoD.Schema.FieldDefinition> extends BaseRefController<S, { value: DoD.Ref.Field<S> }> {

  constructor(id: DoD.PKey, schema: S, value?: DoD.Ref.Field<S>) {
    super({id, schema}, {value: value})
  }

  public static from<S extends DoD.Schema.FieldDefinition>(id: DoD.PKey, schema: S, value: DoD.Ref.Field<S>) {
    return new this(id, schema, value)
  }

  /**
   * Initialize the instance, should be called immediately after
   * creating the object
   *
   * @public
   * @memberof FieldRefController
   */
  public init(): this {
    this.preInit && this.preInit()
    this.initValue()
    this.onInit && this.onInit()
    return this
  }

  protected initValue() {
    console.debug('initValue', this.getId(), this.getSchema(), this.getValue())
  }

  public getValue(): DoD.Ref.Field<S> {
    return this.get('value')
  }

  public setValue(value: DoD.Ref.Field<S>): this {
    return this.set('value', value)
  }

}
