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

import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  PLUGIN_FIGURE_MAX_ROWS,
  hasPersonalDetails,
  listPluginFigureReaders,
  maskPersonalDetails,
  normalizePluginFigureTable,
  pluginFigureChange,
  pluginFigureParams,
  pluginFigureReader,
  pluginFigureReaderPlugin,
  pluginFigureWindows,
  registerPluginFigureReader,
  type PluginFigureReader,
  type PluginFigureTable,
} from './plugin-figures'
import { resetPluginServicesForTests, unregisterPluginServices } from './plugin-services'

/**
 * The seam with no commerce, analytics or AI in it: a `tasks` plugin owns its
 * tasks and publishes how many were closed, and a `report` that knows nothing
 * about tasks asks for the figures by id — through the owner's reader, held to
 * the contract on the way out, and never reading a task itself.
 */

const NOW = new Date('2026-09-16T15:00:00.000Z')

function tasksPlugin(): PluginFigureReader {
  return {
    id: 'tasks.closed',
    label: 'Closed tasks',
    description: 'How many tasks were closed in the window, by list.',
    scope: 'site',
    windows: [7, 30],
    read: async ({ hostId, days, now }) => {
      if (hostId !== 'host-1') return { ok: false, status: 404, error: 'Unknown site' }
      const { current } = pluginFigureWindows(now, days)
      return {
        ok: true,
        table: {
          title: 'Closed tasks',
          source: { label: 'Tasks', path: 'tasks' },
          period: { from: current.from, to: current.to, days },
          columns: [
            { key: 'list', label: 'List', kind: 'text' },
            { key: 'closed', label: 'Closed', kind: 'count' },
          ],
          rows: [
            { list: 'Kitchen', closed: 12 },
            { list: 'Garden', closed: 3 },
          ],
          omitted: 0,
          notes: [],
        },
      }
    },
  }
}

/** The report: it names the reader, never the plugin that owns the records. */
async function weeklyReport(hostId: string) {
  const found = pluginFigureReader('tasks.closed')
  if (!found) return { error: 'Tasks are not available' }
  const read = await found.reader.read({ orgId: 'org-1', hostId, days: 7, now: NOW, uid: null, params: {} })
  if (read.ok === false) return { error: read.error }
  return { owner: found.pluginId, table: normalizePluginFigureTable(read.table) }
}

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('figure readers', () => {
  it('lets a consumer read another plugin’s figures through the owner’s reader', async () => {
    setRegisteringPluginId('tasks')
    registerPluginFigureReader(tasksPlugin())
    setRegisteringPluginId(undefined)

    const report = await weeklyReport('host-1')
    expect(report).toMatchObject({
      owner: 'tasks',
      table: {
        title: 'Closed tasks',
        source: { label: 'Tasks', path: 'tasks' },
        period: { from: '2026-09-10', to: '2026-09-16', days: 7 },
        rows: [
          { list: 'Kitchen', closed: 12 },
          { list: 'Garden', closed: 3 },
        ],
      },
    })
    expect(await weeklyReport('host-2')).toEqual({ error: 'Unknown site' })
  })

  it('answers null for an id no plugin reads, and after its owner unloads', () => {
    expect(pluginFigureReader('tasks.closed')).toBeNull()
    registerPluginFigureReader(tasksPlugin(), { pluginId: 'tasks' })
    unregisterPluginServices('tasks')
    expect(pluginFigureReader('tasks.closed')).toBeNull()
    expect(listPluginFigureReaders()).toEqual([])
  })

  it('keeps one owner per id: a second plugin is refused naming both, and the owner re-registers its own', () => {
    const first = tasksPlugin()
    const second = { ...tasksPlugin(), label: 'Tasks closed' }
    registerPluginFigureReader(first, { pluginId: 'tasks' })
    expect(() => registerPluginFigureReader(second, { pluginId: 'chores' })).toThrow(
      'figure reader "tasks.closed" is already registered by "tasks"; refused "chores"',
    )
    expect(pluginFigureReader('tasks.closed')?.reader).toBe(first)
    registerPluginFigureReader(second, { pluginId: 'tasks' })
    expect(pluginFigureReader('tasks.closed')).toEqual({ pluginId: 'tasks', reader: second })
  })

  it('lists every reader ordered by id, whatever order they registered in', () => {
    registerPluginFigureReader({ ...tasksPlugin(), id: 'tasks.open' }, { pluginId: 'tasks' })
    registerPluginFigureReader({ ...tasksPlugin(), id: 'chores.done' }, { pluginId: 'chores' })
    registerPluginFigureReader(tasksPlugin(), { pluginId: 'tasks' })
    expect(listPluginFigureReaders().map(({ pluginId, reader }) => `${pluginId}:${reader.id}`)).toEqual([
      'chores:chores.done',
      'tasks:tasks.closed',
      'tasks:tasks.open',
    ])
  })

  it('names the plugin that must run: its own, else its owner, and none for platform figures', () => {
    registerPluginFigureReader(tasksPlugin(), { pluginId: 'tasks' })
    registerPluginFigureReader({ ...tasksPlugin(), id: 'tasks.views', plugin: null }, { pluginId: 'tasks' })
    registerPluginFigureReader({ ...tasksPlugin(), id: 'tasks.forms', plugin: 'forms' }, { pluginId: 'tasks' })
    expect(
      listPluginFigureReaders().map((resolved) => [resolved.reader.id, pluginFigureReaderPlugin(resolved)]),
    ).toEqual([
      ['tasks.closed', 'tasks'],
      ['tasks.forms', 'forms'],
      ['tasks.views', null],
    ])
  })

  it('reads only the parameters a reader declares, and refuses a request missing a required one', () => {
    const reader = {
      params: [
        { name: 'list', description: 'The list to count.', required: true },
        { name: 'owner', description: 'Whose tasks.', required: false },
      ],
    }
    expect(pluginFigureParams(reader, { list: '  Kitchen ', owner: '', extra: 'x' })).toEqual({
      ok: true,
      params: { list: 'Kitchen' },
    })
    expect(pluginFigureParams(reader, { owner: 'sam' })).toEqual({ ok: false, missing: 'list' })
    expect(pluginFigureParams({}, { list: 'Kitchen' })).toEqual({ ok: true, params: {} })
    expect(() =>
      registerPluginFigureReader(
        { ...tasksPlugin(), params: [{ name: 'a list', description: 'x', required: false }] },
        { pluginId: 'tasks' },
      ),
    ).toThrow(/is not a name/)
  })

  it('needs an id of dotted lowercase words, and an owner', () => {
    expect(() => registerPluginFigureReader({ ...tasksPlugin(), id: 'Tasks' }, { pluginId: 'tasks' })).toThrow(
      /lowercase words joined by dots/,
    )
    expect(() => registerPluginFigureReader({ ...tasksPlugin(), id: 'tasks' }, { pluginId: 'tasks' })).toThrow(
      /lowercase words joined by dots/,
    )
    expect(() => registerPluginFigureReader(tasksPlugin())).toThrow(/no owner/)
  })
})

describe('a table held to the contract', () => {
  const table = (patch: Partial<PluginFigureTable> & Record<string, unknown> = {}) =>
    ({
      title: 'Orders',
      source: { label: 'Orders', path: 'commerce/orders' },
      period: { from: '2026-09-03', to: '2026-09-16', days: 14 },
      columns: [
        { key: 'region', label: 'Region', kind: 'text' },
        { key: 'orders', label: 'Orders', kind: 'count' },
        { key: 'revenue', label: 'Revenue', kind: 'money', currency: 'USD' },
        { key: 'change', label: 'Change', kind: 'change' },
      ],
      rows: [{ region: 'Texas', orders: 12, revenue: 1204.5, change: 14.7 }],
      omitted: 0,
      notes: [],
      ...patch,
    }) as PluginFigureTable

  it('keeps a well-formed table as it is', () => {
    expect(normalizePluginFigureTable(table())).toEqual(table())
  })

  it('bounds the rows and counts what it left out beside what the reader did', () => {
    const rows = Array.from({ length: PLUGIN_FIGURE_MAX_ROWS + 7 }, (_, index) => ({
      region: `Region ${index}`,
      orders: index,
      revenue: index,
      change: null as number | null,
    }))
    const normalized = normalizePluginFigureTable(table({ rows, omitted: 3 }))
    expect(normalized?.rows).toHaveLength(PLUGIN_FIGURE_MAX_ROWS)
    expect(normalized?.omitted).toBe(10)
  })

  it('drops a column it cannot read, and reads every cell through its column', () => {
    const normalized = normalizePluginFigureTable(
      table({
        columns: [
          { key: 'region', label: 'Region', kind: 'text' },
          { key: 'orders', label: 'Orders', kind: 'count' },
          { key: 'revenue', label: 'Revenue', kind: 'money' },
          { key: 'bad key', label: 'Bad', kind: 'count' },
          { key: 'orders', label: 'Twice', kind: 'count' },
          { key: 'score', label: 'Score', kind: 'rating' as never },
          { key: 'day', label: 'Day', kind: 'date' },
        ],
        rows: [{ region: 42, orders: 3.6, revenue: 10, day: '16/09/2026' }],
      }),
    )
    expect(normalized?.columns.map((column) => column.key)).toEqual(['region', 'orders', 'day'])
    expect(normalized?.rows).toEqual([{ region: null, orders: 4, day: null }])
  })

  it('masks personal details in every text cell and note', () => {
    const normalized = normalizePluginFigureTable(
      table({
        rows: [{ region: 'Avery avery@example.com', orders: 1, revenue: 1, change: null }],
        notes: ['Call +1 (555) 010-4477 about it'],
      }),
    )
    expect(normalized?.rows[0]['region']).toBe('Avery [email]')
    expect(normalized?.notes).toEqual(['Call [phone] about it'])
  })

  it('refuses a console path that could leave the site’s root, and a period that is not a window', () => {
    const normalized = normalizePluginFigureTable(
      table({
        source: { label: 'Orders', path: '../admin/flags' },
        period: { from: '2026-09-03', to: 'today', days: 14 },
      }),
    )
    expect(normalized?.source).toEqual({ label: 'Orders', path: null })
    expect(normalized?.period).toBeNull()
  })

  it('answers null for something that is not a table', () => {
    expect(normalizePluginFigureTable(null)).toBeNull()
    expect(normalizePluginFigureTable({ title: 'No columns', columns: [], rows: [] })).toBeNull()
    expect(normalizePluginFigureTable({ title: '', columns: [{ key: 'a', label: 'A', kind: 'count' }] })).toBeNull()
  })
})

describe('personal details', () => {
  it('masks email addresses and phone numbers', () => {
    expect(maskPersonalDetails('Write to sam.rep+orders@example.org today')).toBe('Write to [email] today')
    expect(maskPersonalDetails('Ring 020 7946 0958 or +44 20 7946 0958')).toBe('Ring [phone] or [phone]')
    expect(hasPersonalDetails('(555) 010-4477')).toBe(true)
  })

  it('leaves the figures and labels a table is made of', () => {
    for (const text of [
      '2026-09-16',
      '/blog/2026/09/15-roof-repair',
      '$1,204.50',
      '14.7%',
      'Fall 2026 sale',
      'Order total 12345678',
    ]) {
      expect([text, maskPersonalDetails(text)]).toEqual([text, text])
    }
  })
})

describe('windows and change', () => {
  it('ends the window on today, and compares it with the window of the same length before it', () => {
    expect(pluginFigureWindows(NOW, 7)).toEqual({
      current: {
        from: '2026-09-10',
        to: '2026-09-16',
        startMs: Date.UTC(2026, 8, 10),
        endMs: Date.UTC(2026, 8, 17),
      },
      previous: {
        from: '2026-09-03',
        to: '2026-09-09',
        startMs: Date.UTC(2026, 8, 3),
        endMs: Date.UTC(2026, 8, 10),
      },
    })
  })

  it('reads no change where there is nothing earlier to compare with', () => {
    expect(pluginFigureChange(120, 100)).toBe(20)
    expect(pluginFigureChange(1204, 1050)).toBe(14.7)
    expect(pluginFigureChange(90, 100)).toBe(-10)
    expect(pluginFigureChange(12, 0)).toBeNull()
    expect(pluginFigureChange(12, null)).toBeNull()
  })
})
