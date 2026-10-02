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

import { hostRoleFor, isOrgWideMember, memberCanSee } from '@aglyn/aglyn/app-utils/organizations'
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import type { AglynOrgMember } from '@aglyn/aglyn/foundation/definitions/organization.types'
import {
  PLUGIN_FIGURE_MAX_ROWS,
  registerPluginFigureReader,
  type PluginFigureRead,
  type PluginFigureReader,
  type PluginFigureRequest,
  type PluginFigureRow,
} from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { BUNDLE_ID } from '../constants/bundle-common'
import { type DatasetModel, effectiveDatasetModel } from '../model/dataset-models'

/**
 * The figures an insight reads about the workspace's datasets (AGL-2915),
 * registered by the plugin that keeps them on the `plugin-figures` seam
 * (AGL-3080), so the asking plugin reads no dataset itself.
 *
 * Each reader answers with one compact table of aggregates, read-only and
 * about nobody: counts, sums and rates, labeled by a dataset's own field —
 * never a record. A breakdown refuses a field with more than
 * `DATASET_FIGURE_MAX_GROUP_VALUES` different values — on a dataset of any
 * size, a name, an address or an order number — and folds every group of
 * fewer than `DATASET_FIGURE_MIN_GROUP` records into one row, so each label it
 * shows is a value at least that many records share.
 *
 * A request reads only the datasets the member who asked may see — and,
 * narrowed to a site, only those shared with it, which is the site Data
 * page's rule (AGL-2891). With no member, only datasets shared with every
 * site.
 */

type Firestore = FirebaseFirestore.Firestore

/** How a reader reaches Firestore: resolved when it reads, never when it registers. */
export type DatasetFigureFirestore = () => Firestore

/** Datasets a dataset summary reads. */
export const DATASET_FIGURE_DATASETS_READ_LIMIT = 50

/** Records a dataset breakdown or field summary reads, in document order; the rest are named in a note. */
export const DATASET_FIGURE_RECORDS_READ_LIMIT = 2_000

/** The fewest records a breakdown shows a group of by its own label. */
export const DATASET_FIGURE_MIN_GROUP = 3

/**
 * The most different values a breakdown groups by: every state and territory,
 * a status, a category. A field with more tells records apart rather than
 * sorting them, so it is refused.
 */
export const DATASET_FIGURE_MAX_GROUP_VALUES = 60

/** The aggregates a breakdown computes. */
export const DATASET_FIGURE_OPERATIONS = ['count', 'sum', 'average', 'min', 'max'] as const
export type DatasetFigureOperation = (typeof DATASET_FIGURE_OPERATIONS)[number]

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const num = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const round1 = (value: number): number => Math.round(value * 10) / 10

const share = (part: number, whole: number): number | null => (whole > 0 ? round1((part / whole) * 100) : null)

function refused(status: 400 | 403 | 404, error: string): PluginFigureRead {
  return { ok: false, status, error }
}

interface VisibleDataset {
  id: string
  name: string
  model: DatasetModel
}

/**
 * The datasets a request may read: those the member who asked may see — and,
 * narrowed to a site, only those shared with it, which is the site Data page's
 * rule (AGL-2891). With no member, only datasets shared with every site.
 */
async function visibleDatasets(firestore: Firestore, request: PluginFigureRequest): Promise<VisibleDataset[]> {
  const orgRef = firestore.collection('orgs').doc(request.orgId)
  const [snapshot, memberSnapshot] = await Promise.all([
    orgRef.collection('datasets').limit(DATASET_FIGURE_DATASETS_READ_LIMIT).get(),
    request.uid ? orgRef.collection('members').doc(request.uid).get() : Promise.resolve(null),
  ])
  const member = memberSnapshot?.exists ? (memberSnapshot.data() as Partial<AglynOrgMember>) : null
  if (request.uid && !member) return []
  if (request.hostId && member && !isOrgWideMember(member) && hostRoleFor(member, request.hostId) === null) {
    return []
  }
  return snapshot.docs
    .map((doc) => ({ id: doc.id, data: (doc.data() ?? {}) as Record<string, unknown> }))
    .filter(({ data }) => {
      const visibleTo = data['visibleTo'] as string[] | undefined
      if (data['deletedAt']) return false
      if (request.hostId && !visibleToHost(visibleTo, request.hostId)) return false
      return member ? memberCanSee(member, visibleTo) : Boolean(visibleTo?.includes('org'))
    })
    .map(({ id, data }) => ({
      id,
      name: str(data['displayName']) || id,
      model: effectiveDatasetModel(data as { model?: DatasetModel; fields?: string[] }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function readRecords(
  firestore: Firestore,
  orgId: string,
  datasetId: string,
): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
  const recordsRef = firestore.collection('orgs').doc(orgId).collection('datasets').doc(datasetId).collection('records')
  const [page, count] = await Promise.all([
    recordsRef.limit(DATASET_FIGURE_RECORDS_READ_LIMIT).get(),
    recordsRef.count().get(),
  ])
  return {
    rows: page.docs.map((doc) => ((doc.data() ?? {})['values'] ?? {}) as Record<string, unknown>),
    total: num(count.data().count),
  }
}

const NUMERIC_TYPES = new Set(['float', 'int32', 'int64'])

function readNote(read: number, total: number): string[] {
  return total > read
    ? [`Read the first ${read.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} records, so every figure covers only those.`]
    : []
}

/** A field a dataset table may be read by: the model's own id, or its name as the dataset page shows it. */
function fieldOf(model: DatasetModel, raw: string): string | null {
  const wanted = raw.trim().toLowerCase()
  for (const id of model.order) {
    if (id.toLowerCase() === wanted || str(model.fields[id]?.name).toLowerCase() === wanted) return id
  }
  return null
}

/** A value as a breakdown groups it: text as written, a number or a yes/no as text; empty is its own group. */
function groupLabel(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(empty)'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number' || typeof value === 'string') return String(value).trim() || '(empty)'
  return '(not a single value)'
}

export function datasetFigureReaders(firestore: DatasetFigureFirestore): PluginFigureReader[] {
  const base = { scope: 'org' as const, plugin: 'data', feature: 'dataStore', windows: [] as number[] }
  // Datasets belong to the workspace, so a table links its Data page.
  const source = { label: 'Data', path: 'data' }
  return [
    {
      ...base,
      id: 'datasets.summary',
      label: 'Datasets',
      description:
        'With no dataset named: each dataset’s records and fields. With one: each of its fields, how many records fill it, how many distinct values it holds and, for a number, its lowest, average and highest.',
      params: [{ name: 'dataset', description: 'A dataset’s id or name, to summarize its fields.', required: false }],
      read: async (request) => {
        const db = firestore()
        const datasets = await visibleDatasets(db, request)
        const named = request.params['dataset']
        if (!named) {
          const counted = await Promise.all(
            datasets.slice(0, PLUGIN_FIGURE_MAX_ROWS).map(async (dataset) => ({
              dataset: dataset.name,
              records: num(
                (
                  await db
                    .collection('orgs')
                    .doc(request.orgId)
                    .collection('datasets')
                    .doc(dataset.id)
                    .collection('records')
                    .count()
                    .get()
                ).data().count,
              ),
              fields: dataset.model.order.length,
            })),
          )
          return {
            ok: true,
            table: {
              title: 'Datasets',
              source,
              period: null,
              columns: [
                { key: 'dataset', label: 'Dataset', kind: 'text' },
                { key: 'records', label: 'Records', kind: 'count' },
                { key: 'fields', label: 'Fields', kind: 'count' },
              ],
              rows: counted,
              omitted: Math.max(0, datasets.length - counted.length),
              notes: [],
            },
          }
        }
        const dataset = datasets.find((entry) => entry.id === named || entry.name.toLowerCase() === named.toLowerCase())
        if (!dataset) return refused(404, 'That dataset is not one you can read here')
        const { rows: values, total } = await readRecords(db, request.orgId, dataset.id)
        const rows = dataset.model.order.slice(0, PLUGIN_FIGURE_MAX_ROWS).map((fieldId) => {
          const field = dataset.model.fields[fieldId]
          const filled = values.filter((entry) => entry[fieldId] !== null && entry[fieldId] !== undefined && entry[fieldId] !== '')
          const numbers = NUMERIC_TYPES.has(String(field?.type))
            ? filled.map((entry) => entry[fieldId]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
            : []
          return {
            field: str(field?.name) || fieldId,
            type: String(field?.type ?? 'text'),
            filled: share(filled.length, values.length),
            distinct: new Set(filled.map((entry) => groupLabel(entry[fieldId]))).size,
            lowest: numbers.length ? Math.min(...numbers) : null,
            average: numbers.length ? Math.round((numbers.reduce((sum, value) => sum + value, 0) / numbers.length) * 100) / 100 : null,
            highest: numbers.length ? Math.max(...numbers) : null,
          }
        })
        return {
          ok: true,
          table: {
            title: `${dataset.name}: fields`,
            source,
            period: null,
            columns: [
              { key: 'field', label: 'Field', kind: 'text' },
              { key: 'type', label: 'Type', kind: 'text' },
              { key: 'filled', label: 'Records that fill it', kind: 'percent' },
              { key: 'distinct', label: 'Distinct values', kind: 'count' },
              { key: 'lowest', label: 'Lowest', kind: 'number' },
              { key: 'average', label: 'Average', kind: 'number' },
              { key: 'highest', label: 'Highest', kind: 'number' },
            ],
            rows,
            omitted: Math.max(0, dataset.model.order.length - rows.length),
            notes: readNote(values.length, total),
          },
        }
      },
    },
    {
      ...base,
      id: 'datasets.breakdown',
      label: 'Dataset breakdown',
      description:
        'One dataset’s records grouped by the values of one field, with how many records each group holds and, for a number field, its sum, average, lowest or highest in each group.',
      params: [
        { name: 'dataset', description: 'The dataset’s id or name.', required: true },
        { name: 'group', description: 'The field to group records by, by id or name.', required: true },
        { name: 'measure', description: 'A number field to aggregate, by id or name; empty to count records.', required: false },
        { name: 'operation', description: `One of ${DATASET_FIGURE_OPERATIONS.join(', ')}; count when empty.`, required: false },
      ],
      read: async (request) => {
        const db = firestore()
        const datasets = await visibleDatasets(db, request)
        const named = request.params['dataset'] ?? ''
        const dataset = datasets.find((entry) => entry.id === named || entry.name.toLowerCase() === named.toLowerCase())
        if (!dataset) return refused(404, 'That dataset is not one you can read here')
        const group = fieldOf(dataset.model, request.params['group'] ?? '')
        if (!group) return refused(400, 'That dataset has no field by that name to group by')
        const operation = (request.params['operation'] ?? 'count') as DatasetFigureOperation
        if (!(DATASET_FIGURE_OPERATIONS as readonly string[]).includes(operation)) {
          return refused(400, `The operation is one of ${DATASET_FIGURE_OPERATIONS.join(', ')}`)
        }
        const measure = request.params['measure'] ? fieldOf(dataset.model, request.params['measure']) : null
        if (operation !== 'count' && (!measure || !NUMERIC_TYPES.has(String(dataset.model.fields[measure]?.type)))) {
          return refused(400, 'Only a number field can be summed, averaged or ranged')
        }
        const { rows: values, total } = await readRecords(db, request.orgId, dataset.id)
        const groups = new Map<string, number[]>()
        const sizes = new Map<string, number>()
        for (const entry of values) {
          const label = groupLabel(entry[group])
          sizes.set(label, (sizes.get(label) ?? 0) + 1)
          const value = measure ? entry[measure] : null
          if (typeof value === 'number' && Number.isFinite(value)) {
            groups.set(label, [...(groups.get(label) ?? []), value])
          }
        }
        if (sizes.size > DATASET_FIGURE_MAX_GROUP_VALUES) {
          return refused(
            400,
            `That field has more than ${DATASET_FIGURE_MAX_GROUP_VALUES} different values, too many to group by. Group by a field many records share, such as a state, a status or a category`,
          )
        }
        // A group of fewer than DATASET_FIGURE_MIN_GROUP records is folded into
        // one row: a group that small is a record, and its label could be a
        // person's name.
        const small = [...sizes.entries()].filter(([, size]) => size < DATASET_FIGURE_MIN_GROUP)
        const aggregate = (numbers: number[]): number | null => {
          if (operation === 'count') return null
          if (!numbers.length) return null
          const sum = numbers.reduce((acc, value) => acc + value, 0)
          switch (operation) {
            case 'sum':
              return Math.round(sum * 100) / 100
            case 'average':
              return Math.round((sum / numbers.length) * 100) / 100
            case 'min':
              return Math.min(...numbers)
            default:
              return Math.max(...numbers)
          }
        }
        const row = (group: string, records: number, numbers: number[]): PluginFigureRow =>
          operation === 'count' ? { group, records } : { group, records, value: aggregate(numbers) }
        const rows: PluginFigureRow[] = [...sizes.entries()]
          .filter(([, size]) => size >= DATASET_FIGURE_MIN_GROUP)
          .map(([label, size]) => row(label, size, groups.get(label) ?? []))
        if (small.length) {
          rows.push(
            row(
              `Other (${small.length} groups under ${DATASET_FIGURE_MIN_GROUP} records)`,
              small.reduce((sum, [, size]) => sum + size, 0),
              small.flatMap(([label]) => groups.get(label) ?? []),
            ),
          )
        }
        rows.sort((a, b) => (num(b['value'] ?? b['records']) - num(a['value'] ?? a['records'])))
        const groupName = str(dataset.model.fields[group]?.name) || group
        const measureName = measure ? str(dataset.model.fields[measure]?.name) || measure : ''
        return {
          ok: true,
          table: {
            title: `${dataset.name} by ${groupName}`,
            source,
            period: null,
            columns: [
              { key: 'group', label: groupName, kind: 'text' },
              { key: 'records', label: 'Records', kind: 'count' },
              ...(operation === 'count'
                ? []
                : [{ key: 'value', label: `${operation[0].toUpperCase()}${operation.slice(1)} of ${measureName}`, kind: 'number' as const }]),
            ],
            rows: rows.slice(0, PLUGIN_FIGURE_MAX_ROWS),
            omitted: Math.max(0, rows.length - PLUGIN_FIGURE_MAX_ROWS),
            notes: [
              ...readNote(values.length, total),
              ...(small.length ? [`Groups of fewer than ${DATASET_FIGURE_MIN_GROUP} records are counted together as Other.`] : []),
            ],
          },
        }
      },
    },
  ]
}

/**
 * Registers them from the console's server declarations: the console is the
 * one surface that runs insight jobs. Registering again replaces this
 * plugin's own readers.
 */
export function registerDatasetFigureReaders(firestore: DatasetFigureFirestore): void {
  for (const reader of datasetFigureReaders(firestore)) {
    registerPluginFigureReader(reader, { pluginId: BUNDLE_ID })
  }
}
