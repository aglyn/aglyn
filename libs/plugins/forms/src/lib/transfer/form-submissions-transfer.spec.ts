/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import { buildTransferFieldCatalog, transferFieldProblems } from '@aglyn/aglyn/data-transfer'
import type { TransferResourceContext } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { FieldPath, Timestamp } from 'firebase-admin/firestore'
import {
  FORM_SUBMISSIONS_OTHER_ANSWERS_MAX,
  createFormSubmissionsTransferResource,
  readFormSubmissionsFilter,
} from './form-submissions-transfer'

/**
 * A SITE'S FORM SUBMISSIONS, EXPORTED.
 *
 * Over an in-memory Firestore that models what the resource asks — equality
 * filters, `createdAt` newest first with the document id breaking ties,
 * `startAfter`, `limit`, `count()` and `getAll` — and records the shape of
 * every query, so the reads can be held to the indexes the collection has.
 */

type Data = Record<string, unknown>

const docs = new Map<string, Data>()

/** Every query run: its equality fields and its ordering. */
const queries: Array<{ collection: string; equalities: string[]; order: string[]; count: boolean }> = []

function fieldName(field: string | FieldPath): string {
  return String(field)
}

function valueAt(path: string, data: Data, field: string): unknown {
  return field === '__name__' ? path.slice(path.lastIndexOf('/') + 1) : data[field]
}

function compare(a: unknown, b: unknown): number {
  if (a instanceof Timestamp && b instanceof Timestamp) {
    return a.seconds - b.seconds || a.nanoseconds - b.nanoseconds
  }
  if (a === b) return 0
  return (a as string) < (b as string) ? -1 : 1
}

class Snapshot {
  constructor(
    readonly path: string,
    private readonly stored: Data | undefined,
  ) {}
  get id() {
    return this.path.slice(this.path.lastIndexOf('/') + 1)
  }
  get exists() {
    return this.stored !== undefined
  }
  data() {
    return this.stored
  }
  get(field: string) {
    return this.stored?.[field]
  }
}

class DocRef {
  constructor(readonly path: string) {}
  get id() {
    return this.path.slice(this.path.lastIndexOf('/') + 1)
  }
  collection(name: string) {
    return new Query(`${this.path}/${name}`)
  }
  doc(): never {
    throw new Error('unmodelled')
  }
  async get() {
    return new Snapshot(this.path, docs.get(this.path))
  }
}

class Query {
  constructor(
    readonly path: string,
    readonly filters: Array<{ field: string; value: unknown }> = [],
    readonly orders: Array<{ field: string; dir: string }> = [],
    readonly after: unknown[] | null = null,
    readonly max: number | null = null,
  ) {}
  doc(id: string) {
    return new DocRef(`${this.path}/${id}`)
  }
  where(field: string, op: string, value: unknown) {
    if (op !== '==') throw new Error(`unmodelled operator ${op}`)
    return new Query(this.path, [...this.filters, { field, value }], this.orders, this.after, this.max)
  }
  orderBy(field: string | FieldPath, dir = 'asc') {
    return new Query(this.path, this.filters, [...this.orders, { field: fieldName(field), dir }], this.after, this.max)
  }
  startAfter(...values: unknown[]) {
    return new Query(this.path, this.filters, this.orders, values, this.max)
  }
  limit(max: number) {
    return new Query(this.path, this.filters, this.orders, this.after, max)
  }
  private matching(): Array<[string, Data]> {
    const rows = [...docs.entries()].filter(
      ([path, data]) =>
        path.startsWith(`${this.path}/`) &&
        !path.slice(this.path.length + 1).includes('/') &&
        this.filters.every(({ field, value }) => data[field] === value),
    )
    const order = (a: [string, Data], b: [string, Data]) => {
      for (const { field, dir } of this.orders) {
        const result = compare(valueAt(a[0], a[1], field), valueAt(b[0], b[1], field))
        if (result) return dir === 'desc' ? -result : result
      }
      return 0
    }
    rows.sort(order)
    const after = this.after
    const kept = after
      ? rows.filter(([path, data]) => {
          for (const [index, { field, dir }] of this.orders.entries()) {
            const result = compare(valueAt(path, data, field), after[index])
            if (result) return (dir === 'desc' ? -result : result) > 0
          }
          return false
        })
      : rows
    return this.max === null ? kept : kept.slice(0, this.max)
  }
  private record(count: boolean) {
    queries.push({
      collection: this.path.slice(this.path.lastIndexOf('/') + 1),
      equalities: this.filters.map((filter) => filter.field),
      order: this.orders.map((one) => `${one.field} ${one.dir}`),
      count,
    })
  }
  async get() {
    this.record(false)
    const found = this.matching().map(([path, data]) => new Snapshot(path, data))
    return { docs: found, size: found.length, empty: !found.length }
  }
  count() {
    return {
      get: async () => {
        this.record(true)
        const count = this.matching().length
        return { data: () => ({ count }) }
      },
    }
  }
}

const firestore = {
  collection: (name: string) => new Query(name),
  async getAll(...refs: DocRef[]) {
    return refs.map((ref) => new Snapshot(ref.path, docs.get(ref.path)))
  },
} as unknown as FirebaseFirestore.Firestore

const at = (seconds: number) => new Timestamp(seconds, 0)

function seed() {
  docs.clear()
  docs.set('hosts/host-1/forms/form-a', {
    displayName: 'Contact',
    fields: [
      { fieldName: 'email', label: 'Your email', fieldType: 'email' },
      { fieldName: 'message', label: 'Message', fieldType: 'textarea' },
    ],
  })
  docs.set('hosts/host-1/forms/form-b', {
    displayName: 'Survey',
    fields: [
      { fieldName: 'email', label: 'Email', fieldType: 'email' },
      { fieldName: 'rating', label: 'How did we do?', fieldType: 'rating' },
      { fieldName: 'choice', fieldType: 'select', options: ['A', 'B'] },
    ],
  })
  const submission = (id: string, data: Data) =>
    docs.set(`hosts/host-1/formSubmissions/${id}`, { orgId: 'org-1', hostId: 'host-1', read: false, ...data })
  submission('s1', {
    formId: 'form-a',
    formName: 'Contact',
    path: '/contact',
    createdAt: at(100),
    fields: { email: 'ann@example.com', message: 'Hello', oldQ: 'asked once' },
  })
  submission('s2', {
    formId: 'form-a',
    formName: 'Contact us',
    path: '/contact',
    createdAt: at(200),
    read: true,
    repliedAtMs: Date.UTC(2026, 9, 1, 12),
    campaignIds: ['camp-1'],
    routing: { datasetId: 'ds-1' },
    rateDegraded: true,
    fields: { email: 'bo@example.com', message: '=HYPERLINK("x")' },
  })
  // The same instant as s2: the document id decides between them.
  submission('s3', {
    formId: 'form-b',
    formName: 'Survey',
    path: '/survey',
    createdAt: at(200),
    fields: { email: 'cy@example.com', rating: '4' },
  })
  // Older than the form entity: no formId.
  submission('s4', { formName: 'Old form', path: '/', createdAt: at(50), fields: { name: 'Dee' } })
  submission('s5', { formId: 'form-a', formName: 'Contact', path: '/contact', createdAt: at(300), fields: { email: 'ed@example.com' } })
  // Another site's submission is never read.
  docs.set('hosts/host-2/formSubmissions/x1', { hostId: 'host-2', formId: 'form-a', createdAt: at(400), fields: {} })
}

const ctx = (extra: Partial<TransferResourceContext> = {}): TransferResourceContext => ({
  resource: 'forms.submissions',
  orgId: 'org-1',
  hostId: 'host-1',
  actorUid: 'uid-1',
  ...extra,
})

const resource = createFormSubmissionsTransferResource({ firestore })

/** Every page of a read, joined. */
async function readAll(
  fieldIds: string[],
  options: Parameters<typeof resource.readPage>[3] = {},
): Promise<{ rows: Array<Record<string, unknown>>; pages: number }> {
  const rows: Array<Record<string, unknown>> = []
  let cursor: string | null = null
  let pages = 0
  do {
    const page = await resource.readPage(ctx(), cursor, fieldIds, options)
    rows.push(...page.rows)
    cursor = page.next
    pages += 1
  } while (cursor !== null && pages < 20)
  return { rows, pages }
}

beforeEach(() => {
  seed()
  queries.length = 0
})

describe('the catalog follows the form', () => {
  it('on one form: its questions, typed and labeled, then answers it no longer asks', async () => {
    const input = await resource.fields(ctx({ filter: { formId: 'form-a' } }))
    const catalog = buildTransferFieldCatalog(input)
    expect(transferFieldProblems(catalog.fields)).toEqual([])
    expect(catalog.groups.map((group) => [group.id, group.label])).toEqual([
      ['submission', 'Submission'],
      ['form:form-a', 'Answers'],
      ['otherAnswers', 'Other answers'],
    ])
    expect(catalog.fields.map((field) => field.id)).toEqual([
      'id',
      'createdAt',
      'formId',
      'formName',
      'path',
      'read',
      'repliedAt',
      'campaignIds',
      'routing',
      'rateDegraded',
      'hostId',
      'answer:email',
      'answer:message',
      'answer:oldQ',
    ])
    expect(catalog.byId.get('answer:email')).toMatchObject({ label: 'Your email', type: 'email', aliases: ['email'] })
    expect(catalog.byId.get('answer:message')).toMatchObject({ label: 'Message', type: 'longText' })
    expect(catalog.byId.get('answer:oldQ')).toMatchObject({ label: 'oldQ', type: 'text', group: 'otherAnswers' })
  })

  it('marks every detail read-only, and the platform-written ones system', async () => {
    const catalog = buildTransferFieldCatalog(await resource.fields(ctx()))
    const details = catalog.fields.filter((field) => field.group === 'submission')
    expect(details.every((field) => field.readOnly)).toBe(true)
    expect(details.filter((field) => !field.system).map((field) => field.id)).toEqual(['read', 'repliedAt'])
    expect(catalog.byId.get('id')).toMatchObject({ matchKey: true, system: true })
    expect(catalog.byId.get('createdAt')).toMatchObject({ label: 'Submitted at', type: 'datetime' })
    expect(catalog.byId.get('campaignIds')?.type).toBe('tags')
  })

  it('on the whole site: every form its own group, a shared question one column', async () => {
    const catalog = buildTransferFieldCatalog(await resource.fields(ctx()))
    expect(transferFieldProblems(catalog.fields)).toEqual([])
    expect(catalog.groups.map((group) => group.label)).toEqual([
      'Submission',
      'Answers: Contact',
      'Answers: Survey',
      'Other answers',
    ])
    const answers = catalog.fields.filter((field) => field.id.startsWith('answer:'))
    expect(answers.map((field) => [field.id, field.group, field.type])).toEqual([
      ['answer:email', 'form:form-a', 'email'],
      ['answer:message', 'form:form-a', 'longText'],
      ['answer:rating', 'form:form-b', 'integer'],
      ['answer:choice', 'form:form-b', 'text'],
      ['answer:oldQ', 'otherAnswers', 'text'],
      ['answer:name', 'otherAnswers', 'text'],
    ])
    expect(catalog.byId.get('answer:choice')?.label).toBe('choice')
  })

  it('offers a bounded number of answers no form asks, the most frequent first', async () => {
    for (let n = 0; n < FORM_SUBMISSIONS_OTHER_ANSWERS_MAX + 10; n += 1) {
      docs.set(`hosts/host-1/formSubmissions/k${n}`, {
        formId: 'form-a',
        createdAt: at(1000 + n),
        fields: { [`stray${n}`]: 'x', frequent: 'y' },
      })
    }
    const input = await resource.fields(ctx({ filter: { formId: 'form-a' } }))
    const others = input.standard.filter((field) => field.group === 'otherAnswers')
    expect(others).toHaveLength(FORM_SUBMISSIONS_OTHER_ANSWERS_MAX)
    expect(others[0]?.id).toBe('answer:frequent')
  })

  it('answers the details alone for a reader with no site', async () => {
    const input = await resource.fields(ctx({ hostId: null }))
    expect(input.standard.every((field) => field.group === 'submission')).toBe(true)
    expect(queries).toEqual([])
  })
})

describe('reading a page', () => {
  const fieldIds = ['id', 'createdAt', 'formId', 'answer:email']

  it('reads the whole site newest first, the id breaking a tie, across pages', async () => {
    const { rows, pages } = await readAll(fieldIds, { pageSize: 2 })
    expect(rows.map((row) => row['id'])).toEqual(['s5', 's3', 's2', 's1', 's4'])
    expect(pages).toBe(3)
    expect(rows[0]).toEqual({
      id: 's5',
      createdAt: '1970-01-01T00:05:00.000Z',
      formId: 'form-a',
      'answer:email': 'ed@example.com',
    })
    // A submission older than the form entity has no form id; one that did
    // not answer a question holds null.
    expect(rows[4]).toEqual({ id: 's4', createdAt: '1970-01-01T00:00:50.000Z', formId: null, 'answer:email': null })
  })

  it('says the last page is the last, with no empty page after it', async () => {
    const page = await resource.readPage(ctx(), null, fieldIds, { pageSize: 5 })
    expect(page.rows).toHaveLength(5)
    expect(page.next).toBeNull()
  })

  it('narrows to one form, and to read or unread, as Firestore queries', async () => {
    expect((await readAll(fieldIds, { filter: { formId: 'form-a' }, pageSize: 1 })).rows.map((row) => row['id'])).toEqual(
      ['s5', 's2', 's1'],
    )
    expect((await readAll(fieldIds, { filter: { read: true } })).rows.map((row) => row['id'])).toEqual(['s2'])
    expect(queries.filter((query) => !query.count).map((query) => query.equalities)).toEqual([
      ['formId'],
      ['formId'],
      ['formId'],
      ['read'],
    ])
  })

  it('reads a selection by id, in the order given, skipping what is gone or filtered out', async () => {
    expect((await readAll(fieldIds, { ids: ['s4', 'gone', 's1', 's1'] })).rows.map((row) => row['id'])).toEqual([
      's4',
      's1',
    ])
    expect(
      (await readAll(fieldIds, { ids: ['s4', 's1'], filter: { formId: 'form-a' } })).rows.map((row) => row['id']),
    ).toEqual(['s1'])
    const first = await resource.readPage(ctx(), null, fieldIds, { ids: ['s3', 's2', 's1'], pageSize: 2 })
    expect(first.rows.map((row) => row['id'])).toEqual(['s3', 's2'])
    expect(first.next).toBe('2')
    const second = await resource.readPage(ctx(), first.next, fieldIds, { ids: ['s3', 's2', 's1'], pageSize: 2 })
    expect(second.rows.map((row) => row['id'])).toEqual(['s1'])
    expect(second.next).toBeNull()
  })

  it('holds only the fields asked for, every detail as the row stores it', async () => {
    const page = await resource.readPage(
      ctx(),
      null,
      ['read', 'repliedAt', 'campaignIds', 'routing', 'rateDegraded', 'hostId', 'formName', 'path', 'answer:message', 'nope'],
      { ids: ['s2'] },
    )
    expect(page.rows).toEqual([
      {
        read: true,
        repliedAt: '2026-10-01T12:00:00.000Z',
        campaignIds: ['camp-1'],
        routing: { datasetId: 'ds-1' },
        rateDegraded: true,
        hostId: 'host-1',
        formName: 'Contact us',
        path: '/contact',
        // As the visitor typed it: the file's writer decides how a cell is written.
        'answer:message': '=HYPERLINK("x")',
        nope: null,
      },
    ])
  })

  it('reads only this site', async () => {
    const { rows } = await readAll(['id'])
    expect(rows.map((row) => row['id'])).not.toContain('x1')
    expect(await resource.readPage(ctx({ hostId: null }), null, ['id'], {})).toEqual({ rows: [], next: null })
  })

  it('is not narrowed by scope tokens: a host resource is gated on the site by the route', async () => {
    const plain = await readAll(['id'])
    const scoped = await readAll(['id'], { scopeTokens: ['host:host-9'] })
    expect(scoped.rows).toEqual(plain.rows)
  })

  it('refuses a filter it cannot honor rather than exporting more than asked', async () => {
    await expect(resource.readPage(ctx(), null, ['id'], { filter: { status: 'new' } })).rejects.toThrow(/"status"/)
    await expect(resource.readPage(ctx(), null, ['id'], { filter: { read: 'maybe' } })).rejects.toThrow(/true or false/)
    await expect(resource.readPage(ctx(), 'garbage', ['id'], {})).rejects.toThrow(/cursor/)
  })
})

describe('counting before the first byte', () => {
  it('counts with an aggregate, under the same filter the pages read', async () => {
    expect(await resource.count(ctx(), {})).toBe(5)
    expect(await resource.count(ctx(), { filter: { formId: 'form-a' } })).toBe(3)
    expect(await resource.count(ctx(), { filter: { read: false } })).toBe(4)
    expect(queries.every((query) => query.count)).toBe(true)
  })

  it('counts a selection by what exists of it', async () => {
    expect(await resource.count(ctx(), { ids: ['s1', 'gone', 's2'] })).toBe(2)
    expect(await resource.count(ctx(), { ids: ['s1', 's3'], filter: { formId: 'form-b' } })).toBe(1)
  })
})

describe('every read rides an index the collection has', () => {
  it('asks only the shapes cloud/firebase-firestore.indexes.json serves', async () => {
    await resource.fields(ctx())
    await resource.fields(ctx({ filter: { formId: 'form-a' } }))
    await readAll(['id'], { pageSize: 2 })
    await readAll(['id'], { filter: { formId: 'form-a' }, pageSize: 2 })
    await readAll(['id'], { filter: { read: true }, pageSize: 2 })
    await resource.count(ctx(), { filter: { formId: 'form-a' } })
    await resource.count(ctx(), { filter: { read: true } })
    const submissionReads = queries.filter((query) => query.collection === 'formSubmissions')
    expect(submissionReads.length).toBeGreaterThan(0)
    for (const query of submissionReads) {
      // At most one equality — formId (formId ↑ createdAt ↓) or read
      // (read ↑ createdAt ↓) — or none (single-field createdAt).
      expect(query.equalities.length).toBeLessThanOrEqual(1)
      expect(['formId', 'read']).toEqual(expect.arrayContaining(query.equalities))
      expect(query.order).toEqual(query.count ? [] : ['createdAt desc', '__name__ desc'])
    }
  })
})

describe('the filter', () => {
  it('reads one form and read or unread, and nothing else', () => {
    expect(readFormSubmissionsFilter(undefined)).toEqual({})
    expect(readFormSubmissionsFilter({ formId: ' form-a ', read: 'false' })).toEqual({ formId: 'form-a', read: false })
    expect(readFormSubmissionsFilter({ formId: null })).toEqual({})
    expect(() => readFormSubmissionsFilter({ formId: 'a/b' })).toThrow()
    expect(() => readFormSubmissionsFilter(['form-a'])).toThrow()
  })
})

describe('export only', () => {
  it('answers no write', () => {
    expect(Object.keys(resource).sort()).toEqual(['count', 'fields', 'lookup', 'matchKeys', 'readPage'])
    expect(resource.matchKeys).toEqual([{ fieldId: 'id', normalizer: 'aglynId' }])
  })

  it('looks a submission up by its Aglyn ID, with its details and answers', async () => {
    const found = await resource.lookup(ctx(), [
      { fieldId: 'id', normalizer: 'aglynId', values: ['s1', 'gone'] },
      { fieldId: 'answer:email', normalizer: 'email', values: ['someone@example.com'] },
    ])
    expect([...found.records.keys()]).toEqual(['s1'])
    expect(found.records.get('s1')).toMatchObject({ id: 's1', formId: 'form-a' })
    expect([...found.lookup.values()]).toEqual([['s1']])
  })
})
