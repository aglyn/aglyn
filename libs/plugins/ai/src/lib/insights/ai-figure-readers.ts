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

import { effectiveDatasetModel, type DatasetModel } from '@aglyn/aglyn/app-utils/dataset-models'
import { formPeriodKey, formStatsTotals, type FormStats } from '@aglyn/aglyn/app-utils/forms'
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import { hostRoleFor, isOrgWideMember, memberCanSee } from '@aglyn/aglyn/app-utils/organizations'
import type { AglynOrgMember } from '@aglyn/aglyn/foundation/definitions/organization.types'
import {
  PLUGIN_FIGURE_MAX_ROWS,
  pluginFigureChange,
  pluginFigureDay,
  pluginFigureWindows,
  registerPluginFigureReader,
  type PluginFigureReader,
  type PluginFigureRead,
  type PluginFigureRequest,
  type PluginFigureRow,
  type PluginFigureTable,
} from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { AI_PLUGIN_ID } from '../constants'

/**
 * The figure readers this plugin registers for records the PLATFORM keeps
 * (AGL-2915): a site's page-view counters, its forms' counters and the
 * workspace's datasets. Every other reader an insight reads is registered by
 * the plugin that owns its records — commerce, bookings, marketing — on the
 * `plugin-figures` seam, and nothing here reads their documents.
 *
 * Each reader answers with one compact table of aggregates, read-only and
 * about nobody: counts, sums and rates, labeled by a page path, a form's name,
 * a referring site or a dataset's own field — never a visitor, a submission or
 * a record. A dataset breakdown refuses a field with more than
 * `AI_DATASET_MAX_GROUP_VALUES` different values — on a dataset of any size, a
 * name, an address or an order number — and folds every group of fewer than
 * `AI_DATASET_MIN_GROUP` records into one row, so each label it shows is a
 * value at least that many records share.
 *
 * The readers use the arithmetic their console cards use: the Traffic card's
 * windows and change (`pluginFigureWindows`, `pluginFigureChange`, which are
 * that card's split and delta), and the forms plugin's month counters through
 * `formStatsTotals`, the one function every forms surface windows by.
 */

type Firestore = FirebaseFirestore.Firestore

/** How a reader reaches Firestore: resolved when it reads, never when it registers. */
export type AiFigureFirestore = () => Firestore

/** The traffic windows: the Traffic card's own ranges. */
export const AI_TRAFFIC_WINDOWS: readonly number[] = [7, 14, 30, 90]

/** A day-by-day table fits a table's row bound only over a short window. */
export const AI_TRAFFIC_DAILY_WINDOWS: readonly number[] = [7, 14]

/** Pages a pages table lists; the rest are counted in `omitted`. */
export const AI_TRAFFIC_TOP_PAGES = 10

/** Referring sites, and campaign sources and campaigns, a sources table lists. */
export const AI_TRAFFIC_TOP_REFERRERS = 8
export const AI_TRAFFIC_TOP_CAMPAIGNS = 5

/** Forms a forms table reads. */
export const AI_FORMS_READ_LIMIT = 100

/** Datasets a dataset summary reads. */
export const AI_DATASETS_READ_LIMIT = 50

/** Records a dataset breakdown or field summary reads, in document order; the rest are named in a note. */
export const AI_DATASET_RECORDS_READ_LIMIT = 2_000

/** The fewest records a breakdown shows a group of by its own label. */
export const AI_DATASET_MIN_GROUP = 3

/**
 * The most different values a breakdown groups by: every state and territory,
 * a status, a category. A field with more tells records apart rather than
 * sorting them, so it is refused.
 */
export const AI_DATASET_MAX_GROUP_VALUES = 60

/** The aggregates a breakdown computes. */
export const AI_DATASET_OPERATIONS = ['count', 'sum', 'average', 'min', 'max'] as const
export type AiDatasetOperation = (typeof AI_DATASET_OPERATIONS)[number]

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

/** A window's days as the table's period, oldest to newest. */
function periodOf(request: PluginFigureRequest): PluginFigureTable['period'] {
  const { current } = pluginFigureWindows(request.now, request.days)
  return { from: current.from, to: current.to, days: request.days }
}

/** Every day id of the window and the one before it, newest first. */
function dayIds(now: Date, days: number): { current: string[]; previous: string[] } {
  const { current, previous } = pluginFigureWindows(now, days)
  const walk = (startMs: number, endMs: number): string[] => {
    const ids: string[] = []
    for (let at = endMs - 86_400_000; at >= startMs; at -= 86_400_000) ids.push(pluginFigureDay(new Date(at)))
    return ids
  }
  return { current: walk(current.startMs, current.endMs), previous: walk(previous.startMs, previous.endMs) }
}

// ── Traffic ───────────────────────────────────────────────────────────────

interface TrafficDay {
  total: number
  visitors: number
  paths: Record<string, number>
  referrers: Record<string, number>
  utm: Record<string, Record<string, number>>
}

const counts = (value: unknown): Record<string, number> => {
  const out: Record<string, number> = {}
  if (!value || typeof value !== 'object') return out
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    const n = num(count)
    if (n > 0) out[key] = n
  }
  return out
}

async function readTrafficDays(
  firestore: Firestore,
  hostId: string,
  ids: readonly string[],
): Promise<TrafficDay[]> {
  if (!ids.length) return []
  const collection = firestore.collection('hosts').doc(hostId).collection('analytics')
  const snapshots = await firestore.getAll(...ids.map((id) => collection.doc(id)))
  return snapshots.map((snapshot) => {
    const data = (snapshot.exists ? snapshot.data() : null) ?? {}
    const utm: Record<string, Record<string, number>> = {}
    for (const [param, values] of Object.entries((data['utm'] ?? {}) as Record<string, unknown>)) {
      utm[param] = counts(values)
    }
    return {
      total: num(data['total']),
      visitors: num(data['visitors']),
      paths: counts(data['paths']),
      referrers: counts(data['referrers']),
      utm,
    }
  })
}

function sumMaps(days: readonly TrafficDay[], pick: (day: TrafficDay) => Record<string, number>): Map<string, number> {
  const totals = new Map<string, number>()
  for (const day of days) {
    for (const [key, count] of Object.entries(pick(day))) totals.set(key, (totals.get(key) ?? 0) + count)
  }
  return totals
}

const ranked = (totals: Map<string, number>): Array<[string, number]> =>
  [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

function siteReader(
  base: Omit<PluginFigureReader, 'read' | 'scope' | 'plugin'>,
  read: (firestore: Firestore, request: PluginFigureRequest & { hostId: string }) => Promise<PluginFigureRead>,
  firestore: AiFigureFirestore,
  plugin: string | null,
): PluginFigureReader {
  return {
    ...base,
    scope: 'site',
    plugin,
    read: async (request) => {
      if (!request.hostId) return refused(400, 'Open a site to read its figures')
      if (!base.windows.includes(request.days)) return refused(400, 'That window is not one this reader covers')
      return read(firestore(), { ...request, hostId: request.hostId })
    },
  }
}

export function trafficFigureReaders(firestore: AiFigureFirestore): PluginFigureReader[] {
  const source = { label: 'Analytics', path: 'analytics' }
  const visitorsNote =
    'Visitors are counted once per browser tab per day, so one person on two days counts twice.'
  return [
    siteReader(
      {
        id: 'traffic.summary',
        label: 'Traffic',
        description:
          'Page views, visitors and views a day on the site over the window, each beside the window before it and the change.',
        windows: AI_TRAFFIC_WINDOWS,
      },
      async (db, request) => {
        const ids = dayIds(request.now, request.days)
        const [current, previous] = await Promise.all([
          readTrafficDays(db, request.hostId, ids.current),
          readTrafficDays(db, request.hostId, ids.previous),
        ])
        const total = (days: TrafficDay[]) => days.reduce((sum, day) => sum + day.total, 0)
        const visitors = (days: TrafficDay[]) => days.reduce((sum, day) => sum + day.visitors, 0)
        const views = total(current)
        const viewsBefore = total(previous)
        const perDay = Math.round(views / request.days)
        const perDayBefore = Math.round(viewsBefore / request.days)
        const table: PluginFigureTable = {
          title: 'Traffic',
          source,
          period: periodOf(request),
          columns: [
            { key: 'figure', label: 'Figure', kind: 'text' },
            { key: 'current', label: 'This window', kind: 'count' },
            { key: 'previous', label: 'Window before', kind: 'count' },
            { key: 'change', label: 'Change', kind: 'change' },
          ],
          rows: [
            { figure: 'Page views', current: views, previous: viewsBefore, change: pluginFigureChange(views, viewsBefore) },
            {
              figure: 'Visitors',
              current: visitors(current),
              previous: visitors(previous),
              change: pluginFigureChange(visitors(current), visitors(previous)),
            },
            {
              figure: 'Page views a day',
              current: perDay,
              previous: perDayBefore,
              change: pluginFigureChange(perDay, perDayBefore),
            },
          ],
          omitted: 0,
          notes: [
            visitorsNote,
            ...(viewsBefore ? [] : ['The window before this one recorded no page views, so there is no change to compare.']),
          ],
        }
        return { ok: true, table }
      },
      firestore,
      null,
    ),
    siteReader(
      {
        id: 'traffic.pages',
        label: 'Top pages',
        description: `The site's ${AI_TRAFFIC_TOP_PAGES} most viewed pages over the window, with each page's share of all views and its change from the window before.`,
        windows: AI_TRAFFIC_WINDOWS,
      },
      async (db, request) => {
        const ids = dayIds(request.now, request.days)
        const [current, previous] = await Promise.all([
          readTrafficDays(db, request.hostId, ids.current),
          readTrafficDays(db, request.hostId, ids.previous),
        ])
        const now = ranked(sumMaps(current, (day) => day.paths))
        const before = sumMaps(previous, (day) => day.paths)
        const all = now.reduce((sum, [, count]) => sum + count, 0)
        const rows: PluginFigureRow[] = now.slice(0, AI_TRAFFIC_TOP_PAGES).map(([path, views]) => ({
          page: path,
          views,
          share: share(views, all),
          change: pluginFigureChange(views, before.get(path) ?? null),
        }))
        return {
          ok: true,
          table: {
            title: 'Top pages',
            source,
            period: periodOf(request),
            columns: [
              { key: 'page', label: 'Page', kind: 'text' },
              { key: 'views', label: 'Views', kind: 'count' },
              { key: 'share', label: 'Share of views', kind: 'percent' },
              { key: 'change', label: 'Change', kind: 'change' },
            ],
            rows,
            omitted: Math.max(0, now.length - rows.length),
            notes: [],
          },
        }
      },
      firestore,
      null,
    ),
    siteReader(
      {
        id: 'traffic.sources',
        label: 'Traffic sources',
        description:
          'Where visits came from over the window: the referring sites, and the campaign sources and campaigns links were tagged with, with each one’s views.',
        windows: AI_TRAFFIC_WINDOWS,
      },
      async (db, request) => {
        const days = await readTrafficDays(db, request.hostId, dayIds(request.now, request.days).current)
        const all = days.reduce((sum, day) => sum + day.total, 0)
        const referrers = ranked(sumMaps(days, (day) => day.referrers))
        const sources = ranked(sumMaps(days, (day) => day.utm['source'] ?? {}))
        const campaigns = ranked(sumMaps(days, (day) => day.utm['campaign'] ?? {}))
        const rowsOf = (entries: Array<[string, number]>, limit: number, type: string) =>
          entries.slice(0, limit).map(([name, views]) => ({ source: name, type, views, share: share(views, all) }))
        const rows = [
          ...rowsOf(referrers, AI_TRAFFIC_TOP_REFERRERS, 'Referring site'),
          ...rowsOf(sources, AI_TRAFFIC_TOP_CAMPAIGNS, 'Campaign source'),
          ...rowsOf(campaigns, AI_TRAFFIC_TOP_CAMPAIGNS, 'Campaign'),
        ]
        return {
          ok: true,
          table: {
            title: 'Traffic sources',
            source,
            period: periodOf(request),
            columns: [
              { key: 'source', label: 'Source', kind: 'text' },
              { key: 'type', label: 'Kind', kind: 'text' },
              { key: 'views', label: 'Views', kind: 'count' },
              { key: 'share', label: 'Share of all views', kind: 'percent' },
            ],
            rows,
            omitted:
              Math.max(0, referrers.length - AI_TRAFFIC_TOP_REFERRERS) +
              Math.max(0, sources.length - AI_TRAFFIC_TOP_CAMPAIGNS) +
              Math.max(0, campaigns.length - AI_TRAFFIC_TOP_CAMPAIGNS),
            notes: ['A visit with no referring site, such as a typed address, is in no row.'],
          },
        }
      },
      firestore,
      null,
    ),
    siteReader(
      {
        id: 'traffic.daily',
        label: 'Traffic by day',
        description: 'Page views and visitors on each day of the window, oldest first, for spotting a day that stood out.',
        windows: AI_TRAFFIC_DAILY_WINDOWS,
      },
      async (db, request) => {
        const ids = [...dayIds(request.now, request.days).current].reverse()
        const days = await readTrafficDays(db, request.hostId, ids)
        return {
          ok: true,
          table: {
            title: 'Traffic by day',
            source,
            period: periodOf(request),
            columns: [
              { key: 'day', label: 'Day', kind: 'date' },
              { key: 'views', label: 'Page views', kind: 'count' },
              { key: 'visitors', label: 'Visitors', kind: 'count' },
            ],
            rows: days.map((day, index) => ({ day: ids[index], views: day.total, visitors: day.visitors })),
            omitted: 0,
            notes: [visitorsNote],
          },
        }
      },
      firestore,
      null,
    ),
  ]
}

// ── Forms ─────────────────────────────────────────────────────────────────

export function formsFigureReader(firestore: AiFigureFirestore): PluginFigureReader {
  return siteReader(
    {
      id: 'forms.performance',
      label: 'Forms',
      description:
        'Each form’s views, submissions, the share of views that became a submission, and leads, over the calendar months the window falls in.',
      windows: AI_TRAFFIC_WINDOWS,
    },
    async (db, request) => {
      const { current } = pluginFigureWindows(request.now, request.days)
      const from = formPeriodKey(current.startMs)
      const to = formPeriodKey(current.endMs - 1)
      const snapshot = await db
        .collection('hosts')
        .doc(request.hostId)
        .collection('forms')
        .limit(AI_FORMS_READ_LIMIT)
        .get()
      const forms = snapshot.docs
        .map((doc) => ({ doc, data: (doc.data() ?? {}) as Record<string, unknown> }))
        .filter(({ data }) => !data['deletedAt'])
        .map(({ doc, data }) => {
          const totals = formStatsTotals(data['stats'] as FormStats | undefined, { from, to })
          return {
            form: str(data['displayName']) || doc.id,
            views: totals.views,
            submissions: totals.submissions,
            completion:
              totals.views && totals.submissions !== null ? share(totals.submissions, totals.views) : null,
            leads: totals.leads,
          }
        })
        .sort((a, b) => (b.submissions ?? -1) - (a.submissions ?? -1) || a.form.localeCompare(b.form))
      const monthStart = from ? `${from}-01` : current.from
      return {
        ok: true,
        table: {
          title: 'Forms',
          source: { label: 'Forms', path: 'forms' },
          period: {
            from: monthStart,
            to: current.to,
            days: Math.round((Date.parse(current.to) - Date.parse(monthStart)) / 86_400_000) + 1,
          },
          columns: [
            { key: 'form', label: 'Form', kind: 'text' },
            { key: 'views', label: 'Views', kind: 'count' },
            { key: 'submissions', label: 'Submissions', kind: 'count' },
            { key: 'completion', label: 'Views that became a submission', kind: 'percent' },
            { key: 'leads', label: 'Leads', kind: 'count' },
          ],
          rows: forms.slice(0, PLUGIN_FIGURE_MAX_ROWS),
          omitted: Math.max(0, forms.length - PLUGIN_FIGURE_MAX_ROWS),
          notes: [
            'Form figures are kept by calendar month, so they cover whole months from the first day of the month the window starts in.',
            'Views are counted in the visitor’s browser and submissions on the server, so a rate can pass 100%.',
          ],
        },
      }
    },
    firestore,
    'forms',
  )
}

// ── Datasets ──────────────────────────────────────────────────────────────

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
    orgRef.collection('datasets').limit(AI_DATASETS_READ_LIMIT).get(),
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

/** A dataset a question may name, with its fields, as the read prompt lists it. */
export interface AiDatasetCatalogEntry {
  id: string
  name: string
  fields: Array<{ id: string; name: string; type: string }>
}

/** The datasets a request may read, with their fields: what the model picks a breakdown from. */
export async function aiDatasetCatalog(
  firestore: Firestore,
  request: Pick<PluginFigureRequest, 'orgId' | 'hostId' | 'uid'>,
): Promise<AiDatasetCatalogEntry[]> {
  const datasets = await visibleDatasets(firestore, { ...request, days: 0, now: new Date(0), params: {} })
  return datasets.map((dataset) => ({
    id: dataset.id,
    name: dataset.name,
    fields: dataset.model.order.map((fieldId) => ({
      id: fieldId,
      name: str(dataset.model.fields[fieldId]?.name) || fieldId,
      type: String(dataset.model.fields[fieldId]?.type ?? 'text'),
    })),
  }))
}

async function readRecords(
  firestore: Firestore,
  orgId: string,
  datasetId: string,
): Promise<{ values: Array<Record<string, unknown>>; total: number }> {
  const recordsRef = firestore.collection('orgs').doc(orgId).collection('datasets').doc(datasetId).collection('records')
  const [page, count] = await Promise.all([
    recordsRef.limit(AI_DATASET_RECORDS_READ_LIMIT).get(),
    recordsRef.count().get(),
  ])
  return {
    values: page.docs.map((doc) => ((doc.data() ?? {})['values'] ?? {}) as Record<string, unknown>),
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

export function datasetFigureReaders(firestore: AiFigureFirestore): PluginFigureReader[] {
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
        const { values, total } = await readRecords(db, request.orgId, dataset.id)
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
        { name: 'operation', description: `One of ${AI_DATASET_OPERATIONS.join(', ')}; count when empty.`, required: false },
      ],
      read: async (request) => {
        const db = firestore()
        const datasets = await visibleDatasets(db, request)
        const named = request.params['dataset'] ?? ''
        const dataset = datasets.find((entry) => entry.id === named || entry.name.toLowerCase() === named.toLowerCase())
        if (!dataset) return refused(404, 'That dataset is not one you can read here')
        const group = fieldOf(dataset.model, request.params['group'] ?? '')
        if (!group) return refused(400, 'That dataset has no field by that name to group by')
        const operation = (request.params['operation'] ?? 'count') as AiDatasetOperation
        if (!(AI_DATASET_OPERATIONS as readonly string[]).includes(operation)) {
          return refused(400, `The operation is one of ${AI_DATASET_OPERATIONS.join(', ')}`)
        }
        const measure = request.params['measure'] ? fieldOf(dataset.model, request.params['measure']) : null
        if (operation !== 'count' && (!measure || !NUMERIC_TYPES.has(String(dataset.model.fields[measure]?.type)))) {
          return refused(400, 'Only a number field can be summed, averaged or ranged')
        }
        const { values, total } = await readRecords(db, request.orgId, dataset.id)
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
        if (sizes.size > AI_DATASET_MAX_GROUP_VALUES) {
          return refused(
            400,
            `That field has more than ${AI_DATASET_MAX_GROUP_VALUES} different values, too many to group by. Group by a field many records share, such as a state, a status or a category`,
          )
        }
        // A group of fewer than AI_DATASET_MIN_GROUP records is folded into
        // one row: a group that small is a record, and its label could be a
        // person's name.
        const small = [...sizes.entries()].filter(([, size]) => size < AI_DATASET_MIN_GROUP)
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
          .filter(([, size]) => size >= AI_DATASET_MIN_GROUP)
          .map(([label, size]) => row(label, size, groups.get(label) ?? []))
        if (small.length) {
          rows.push(
            row(
              `Other (${small.length} groups under ${AI_DATASET_MIN_GROUP} records)`,
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
              ...(small.length ? [`Groups of fewer than ${AI_DATASET_MIN_GROUP} records are counted together as Other.`] : []),
            ],
          },
        }
      },
    },
  ]
}

/** Every reader this plugin registers, for the platform's own records. */
export function aiFigureReaders(firestore: AiFigureFirestore): PluginFigureReader[] {
  return [...trafficFigureReaders(firestore), formsFigureReader(firestore), ...datasetFigureReaders(firestore)]
}

/**
 * Registers them from the console surface, the one surface that runs insight
 * jobs. By a call, never by an import (AGL-3025).
 */
export function registerAiFigureReaders(firestore: AiFigureFirestore): void {
  for (const reader of aiFigureReaders(firestore)) {
    registerPluginFigureReader(reader, { pluginId: AI_PLUGIN_ID })
  }
}
