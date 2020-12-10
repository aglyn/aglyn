import { s } from './utils'
import { Sig, Data, n } from './const'
// import { Normalized } from './models/normalized'
import { Document } from './models/document'
import { Collection } from './models/collection'
import { ID } from './types/data'

const fields = new Collection<Document>({
  items: [
    {
      id: Sig.ID,
      name: n.displayName[Sig.ID],
      kind: Data.TEXT
    },
    {
      id: Sig.NAME,
      name: n.displayName[Sig.NAME],
      kind: Data.TEXT,
    },
    {
      id: Sig.KIND,
      name: n.displayName[Sig.KIND],
      kind: Data.TEXT,
    },
    {
      id: Sig.CREATED,
      name: n.displayName[Sig.CREATED],
      kind: Data.TEXT,
    },
    {
      id: Sig.UPDATED,
      name: n.displayName[Sig.UPDATED],
      kind: Data.TEXT,
    },
    {
      id: Sig.DELETED,
      name: n.displayName[Sig.DELETED],
      kind: Data.TEXT,
    },
  ].map(i => new Document(i))
})

const docs = new Collection<Document>({
  items: [
    {
      id: Sig.MODEL,
      name: 'Default Document Model',
      cid: Sig.FIELDS,
      items: Array.from(fields.items).map(i => s(i.id))
    },
  ].map(i => new Document(i))
})

export class AppController {

  /** singleton */
  private static instance: AppController
  public static getInstance() {
    if (!this.instance) { this.instance = new this() }
    return this.instance
  }

  collections = new Collection<Collection<Document>>()

  private constructor() {
    this.collections.set('fields', fields)
    this.collections.set('documents', docs)
  }

  getCollectionFromId(id: ID): Collection<Document> {
    return this[Sig.COLLECTIONS][id]
  }

  addCollection(id: ID, v: Collection<Document>): this {
    console.log('add, ', id, v)
    this[Sig.COLLECTIONS][id] = v
    console.log('add after, ', AppController.getInstance().getCollectionFromId(id))
    return this
  }

  delCollection(id: ID): this {
    this.collections.del(id)
    return this
  }

  getCollections(): Collection<Collection<Document>> {
    return this.collections
  }

  toJSON() {
    return this.collections
  }

}

console.log('app controller', AppController.getInstance())