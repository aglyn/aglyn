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


export class DatabaseRefController<Ss extends DoD.Schema.CollectionModels> extends BaseRefController<Ss, DoD.Schema.DatabaseCollections<Ss>> {

  constructor(id: DoD.PKey, schemas: Ss, instances?: DoD.Schema.DatabaseCollections<Ss>) {
    super({id, schema: schemas}, {...instances})
  }

  public static from<Ss extends DoD.Schema.CollectionModels>(
    id: DoD.PKey,
    schemas: Ss,
    collections: DoD.Schema.DatabaseCollections<Ss>,
  ) {
    return new this(id, schemas, collections)
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
    console.debug('initDocuments', this.getId(), this.getSchema(), this.getCollections())
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

  public getSchemaById<K extends keyof Ss>(id: K): Ss[K] {
    return super.getSchema()[id]
  }

  public getCollections(): DoD.Schema.DatabaseCollections<Ss> {
    return this.model
  }

  public setCollections(value: DoD.Schema.DatabaseCollections<Ss>): this {
    this.model = value
    return this
  }

}
