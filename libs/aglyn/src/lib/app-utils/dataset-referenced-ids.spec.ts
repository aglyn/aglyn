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

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  datasetIntegrityFields,
  datasetIntegrityUpdate,
  datasetReferencedIds,
  type DatasetModel,
} from './dataset-models'

/**
 * A record's reference index travels with its values.
 *
 * Deleting a dataset record has to answer "is anything still pointing at
 * this?" — `restrict` refuses the delete on a yes, `setNull` strips the FKey.
 * The answer cannot be queried where it is stored: dataset fields are
 * user-defined, so `records.values` carries a deliberate index exemption in
 * `cloud/firebase-firestore.indexes.json`, and
 * `where('values.<fieldId>', '==', id)` is FAILED_PRECONDITION. So the
 * reference is denormalized onto `referencedIds`, which Firestore will index.
 *
 * A denormalization is only as correct as the write paths are disciplined,
 * and this one's failure is the dangerous kind rather than the quiet kind: a
 * record whose index was never written is INVISIBLE to `array-contains`, the
 * check reads "nothing references it", and the UI tells the user the record is
 * safe to remove. The document that pointed at it is left pointing at nothing.
 */
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..')
const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8')

const model: DatasetModel = {
  order: ['title', 'owner', 'tags', 'attendees'],
  fields: {
    title: { name: 'Title', type: 'text' },
    owner: {
      name: 'Owner',
      type: 'reference',
      reference: { datasetId: 'people', onDelete: 'restrict' },
    },
    tags: { name: 'Tags', type: 'sorted' },
    attendees: {
      name: 'Attendees',
      type: 'reference',
      reference: { datasetId: 'people', multiple: true },
    },
  },
}

describe('datasetReferencedIds flattens what the check queries', () => {
  it('takes a scalar id and an array of ids from the same record', () => {
    // The two shapes a reference field stores — `multiple` writes the array —
    // land in one list, because the question asked of it is never "which
    // field", it is "does this record still point at that document".
    expect(
      datasetReferencedIds(model, {
        title: 'Standup',
        owner: 'person-1',
        attendees: ['person-2', 'person-3'],
      }),
    ).toEqual(['person-1', 'person-2', 'person-3'])
  })

  it('de-duplicates across fields', () => {
    // One `array-contains` hit is the whole answer; a repeated id would
    // inflate the count the `restrict` refusal quotes.
    expect(
      datasetReferencedIds(model, {
        owner: 'person-1',
        attendees: ['person-1', 'person-1'],
      }),
    ).toEqual(['person-1'])
  })

  it('ignores fields that are not references', () => {
    // `tags` is a `sorted` list of free text. Indexing it would make an
    // arbitrary string answer for a record id.
    expect(
      datasetReferencedIds(model, { title: 'Standup', tags: ['a', 'b'] }),
    ).toEqual([])
  })

  it('skips blank and non-string entries rather than storing them', () => {
    expect(
      datasetReferencedIds(model, {
        owner: '   ',
        attendees: ['', '  person-4  ', null, 7],
      } as Record<string, unknown>),
    ).toEqual(['person-4'])
  })

  it('reads reference fields missing from `order`', () => {
    // Every other pass over a model walks `order`, which is right for
    // anything the user sees. A reference with no display slot still holds a
    // real FKey, and an index that skipped it would under-report.
    const hidden: DatasetModel = {
      order: ['title'],
      fields: {
        title: { name: 'Title', type: 'text' },
        owner: {
          name: 'Owner',
          type: 'reference',
          reference: { datasetId: 'people' },
        },
      },
    }
    expect(datasetReferencedIds(hidden, { owner: 'person-9' })).toEqual([
      'person-9',
    ])
  })
})

describe('the field is OMITTED when a record references nothing', () => {
  it('writes no `referencedIds` at all on a create', () => {
    /*
     * `isNotEmpty` is served as `!= null` and an empty array is not null, so a
     * record stamped `[]` answers "holds a reference" for a record that holds
     * none.
     */
    const fields = datasetIntegrityFields(model, { title: 'Standup' })
    expect('referencedIds' in fields).toBe(false)
    expect(datasetIntegrityFields(model, undefined)).toEqual({})
  })

  it('CLEARS it on a merging write instead of omitting it', () => {
    // Omission preserves what is stored. A record whose last reference is
    // cleared would go on answering the `array-contains` for a document it no
    // longer points at — a `restrict` refusing a delete nothing is holding.
    const clear = Symbol('deleteField')
    expect(datasetIntegrityUpdate(model, { title: 'Standup' }, clear)).toEqual({
      referencedIds: clear,
    })
    expect(
      datasetIntegrityUpdate(model, { owner: 'person-1' }, clear),
    ).toEqual({ referencedIds: ['person-1'] })
  })
})

/**
 * Static checks, because there is no runtime one. Records are written from six
 * places that share no function: the console card (editor save, CSV upsert,
 * and the FKey strip the delete check itself performs), the quota-enforcing
 * console route, the `/v1` REST API, the tenant form-submission leg, the event
 * actions runner, and the site-import restore.
 */
describe('every record write path carries the index', () => {
  const CARD =
    'libs/plugins/data/src/lib/components/host-datasets-card.component.tsx'
  const CONSOLE_ROUTE = 'apps/console/app/api/orgs/datasets/route.ts'
  const REST_API = 'apps/console/utils/api-v1-resources.ts'
  const FORM_SUBMIT = 'apps/tenant/app/api/forms/submit/route.ts'
  const EVENT_ACTIONS = 'libs/tenant/runtime/src/lib/run-event-actions.ts'
  const SITE_IMPORT = 'apps/console/app/api/hosts/import/route.ts'

  const callSites = (path: string) =>
    (read(path).match(/datasetIntegrity(Fields|Update)\(/g) ?? []).length

  it.each([
    // The editor save, the importer's upsert branch, and the FKey strip.
    [CARD, 3],
    // create-record and one chunk of import-records.
    [CONSOLE_ROUTE, 2],
    // POST and PATCH on /v1/datasets/{id}/records.
    [REST_API, 2],
    // A bound form appends a record.
    [FORM_SUBMIT, 1],
    // datasetAppend, plus updateDataset's update-or-append pair.
    [EVENT_ACTIONS, 3],
    // The restore re-keys records by their original id.
    [SITE_IMPORT, 1],
  ])('%s derives it at every write', (path, expected) => {
    expect({ path, sites: callSites(path) }).toEqual({ path, sites: expected })
  })

  it('the merging writes CLEAR rather than omit', () => {
    // A create may omit; an update may not. Mixing them up is invisible
    // until a reference is removed and the stale index keeps refusing.
    expect(read(CARD)).toContain('datasetIntegrityUpdate(model, coerced, deleteField())')
    expect(read(REST_API)).toContain('datasetIntegrityUpdate(model, merged, FieldValue.delete())')
  })

  it('the site import DERIVES it rather than trusting the bundle', () => {
    // A bundle written before the field existed carries none, so accepting
    // its copy would restore records the check cannot reach.
    expect(read(SITE_IMPORT)).toContain(
      'datasetIntegrityFields(model, record.values ?? {})',
    )
  })

  it('THE CONTROL: those files exist and write records', () => {
    // Otherwise every assertion above passes on an empty string the day a
    // file is renamed or a search path is blocked.
    for (const path of [
      CARD,
      CONSOLE_ROUTE,
      REST_API,
      FORM_SUBMIT,
      EVENT_ACTIONS,
      SITE_IMPORT,
    ]) {
      expect({ path, length: read(path).length > 1000 }).toEqual({
        path,
        length: true,
      })
      expect(read(path)).toContain("'records'")
    }
  })
})

describe('no OTHER source file writes a record without it', () => {
  /*
   * The sweep the per-file table cannot do: a seventh write path, in a file
   * nobody thought to add above, is exactly how a denormalization goes stale.
   * Any source file that both reaches a `records` collection and writes a
   * `values` field has to name the helper.
   */
  const sources: string[] = []
  const walk = (relative: string) => {
    for (const entry of readdirSync(join(REPO_ROOT, relative))) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.next') {
        continue
      }
      const next = `${relative}/${entry}`
      if (statSync(join(REPO_ROOT, next)).isDirectory()) {
        walk(next)
      } else if (/\.tsx?$/.test(entry) && !/\.spec\.tsx?$/.test(entry)) {
        sources.push(next)
      }
    }
  }
  walk('apps')
  walk('libs')

  const writesRecordValues = (path: string) => {
    const source = read(path)
    return (
      /collection\('records'\)|'records',/.test(source) &&
      /^\s+values[,:]/m.test(source)
    )
  }

  it.each(sources.filter(writesRecordValues))(
    '%s names datasetIntegrity*',
    (path) => {
      expect({ path, derives: read(path).includes('datasetIntegrity') }).toEqual(
        { path, derives: true },
      )
    },
  )

  it('THE CONTROL: the sweep actually found the known write paths', () => {
    // A walk that matched nothing would make every case above vacuous — the
    // shape a blocked directory or a changed extension produces.
    const found = sources.filter(writesRecordValues)
    expect(found.length).toBeGreaterThanOrEqual(5)
    expect(found).toContain(
      'libs/plugins/data/src/lib/components/host-datasets-card.component.tsx',
    )
  })
})
