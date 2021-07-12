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

import { PKey, Ref, Schema } from '../interfaces/dod'

import { BaseRefController } from './BaseRefController'


/**
 *
 *
 * @export
 * @class DocumentRefController
 * @extends {BaseRefController<Ref.Document<S>>}
 * @template S
 */
export class DocumentRefController<S extends Schema.ModelFields> extends BaseRefController<S, Ref.Document<S>> {

  constructor(id: PKey, schema: S, fields?: Ref.Document<S>) {
    super({ id, schema }, { ...fields })
  }

  public static from<S extends Schema.ModelFields>(id: PKey, schema: S, fields?: Ref.Document<S>) {
    return new this(id, schema, fields)
  }

  /**
   * Initialize the instance, should be called immediately after
   * creating the object
   *
   * @public
   * @memberof DocumentRefController
   */
  public init(): this {
    this.preInit && this.preInit()
    this.initFields()
    this.onInit && this.onInit()
    return this
  }

  protected initFields() {
    console.debug('initFields', this.getId(), this.getSchema(), this.getFields())
    // Ensure if items are an object we ensure they are a document instance
    // if (!(this.fields instanceof Normalized)) {
    //   this.setFields(new Normalized(this.fields))
    // }
    // if (this.fields instanceof Normalized) {
    //   this.fields.toArray().forEach(field => {
    //     if (!(field instanceof FieldRefController)) {
    //       this.setField(
    //         field.id, this.createField(field).init()
    //       )
    //     }
    //   })
    // }
  }

  public getFields(): Ref.DocumentFields<S> {
    return this.model
  }

  public setFields(value: Ref.DocumentFields<S>): this {
    this.model = value
    return this
  }

}
