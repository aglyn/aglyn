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

import {BaseRefController} from './BaseRefController'


export class CollectionRefController<S extends DoD.Schema.CollectionModel> extends BaseRefController<S, DoD.Ref.Collection<S>> {

  constructor(id: DoD.PKey, schema: S, documents?: DoD.Ref.Collection<S>) {
    super({id, schema}, {...documents})
  }

  public static from<S extends DoD.Schema.CollectionModel>(
    id: DoD.PKey,
    schema: S,
    documents?: DoD.Ref.Collection<S>,
  ) {
    return new this(id, schema, documents)
  }

  /**
   * Initialize the instance, should be called immediately after
   * creating the object
   *
   * @public
   * @memberof CollectionRefController
   */
  public init(): this {
    this.preInit && this.preInit()
    this.initDocuments()
    this.onInit && this.onInit()
    return this
  }

  protected initDocuments() {
    console.debug('initDocuments', this.getId(), this.getSchema(), this.getDocuments())
    // Ensure if items are an object we ensure they are a document instance
    // if (!(this.documents instanceof Normalized)) {
    //   this.setDocuments(new Normalized(this.documents))
    // }
    // if (this.documents instanceof Normalized) {
    //   this.documents.toArray().forEach(doc => {
    //     if (!(doc instanceof DocumentRefController)) {
    //       this.setDocument(
    //         doc.id, this.createDocument(doc).init()
    //       )
    //     }
    //   })
    // }
  }

  public getDocuments(): DoD.Ref.CollectionDocuments<S> {
    return this.model
  }

  public setDocuments(value: DoD.Ref.CollectionDocuments<S>): this {
    this.model = value
    return this
  }

}
