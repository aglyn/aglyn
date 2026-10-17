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

jest.mock('./firebase-admin', () => {
  const firebaseAdmin = {
    firestore: {
      FieldPath: { documentId: () => '__name__' },
      FieldValue: { serverTimestamp: () => 'server-time' },
    },
  }
  return { __esModule: true, default: firebaseAdmin, firebaseAdmin }
})
jest.mock('./account-mail', () => ({ withoutMailWithheldAccounts: jest.fn() }))
jest.mock('./auth-pools', () => ({ findUserByUidAcrossPools: jest.fn() }))
jest.mock('./email-metering', () => ({ meterPlatformEmail: jest.fn() }))
jest.mock('./email-suppression', () => ({ filterSuppressedEmails: jest.fn() }))
jest.mock('./organizations', () => ({ listOrgMembers: jest.fn() }))
jest.mock('./release-flags', () => ({
  getServerReleaseFlagValues: jest.fn(),
  filterEnabledPluginsByReleaseFlags: jest.fn(),
}))
jest.mock('./render-system-email', () => ({
  loadSystemEmail: jest.fn(),
  renderLoadedSystemEmail: jest.fn(),
  systemEmailBrand: jest.fn(),
  systemEmailContent: jest.fn(),
}))

import type { AglynOrgMember } from '@aglyn/aglyn/foundation/definitions/organization.types'
import type { PluginFigureTable, ResolvedPluginFigureReader } from '@aglyn/aglyn/plugin-manager/plugin-figures'
import type { WeeklySummaryColors } from '@aglyn/aglyn/app-utils/weekly-summary'
import {
  runWeeklySummarySweep,
  WEEKLY_SUMMARY_MARKERS,
  type WeeklySummaryDeps,
  type WeeklySummaryMessage,
} from './weekly-summary'

/**
 * A Firestore holding documents by full path, with the handful of query
 * shapes the sweep uses: the org page in id order behind a cursor, a site's
 * hosts by `orgId`, `getAll`, and merged `set`s on the marker.
 */
function memoryFirestore(seed: Record<string, Record<string, unknown>>) {
  const docs = new Map<string, Record<string, unknown>>(Object.entries(seed).map(([path, data]) => [path, { ...data }]))
  const docRef = (path: string): any => {
    const parts = path.split('/')
    const id = parts[parts.length - 1]
    const parentPath = parts.slice(0, -1).join('/')
    return {
      id,
      path,
      parent: { id: parts[parts.length - 2], parent: parts.length > 2 ? { id: parts[parts.length - 3] } : null, path: parentPath },
      collection: (name: string) => collectionRef(`${path}/${name}`),
      get: async () => snapshot(path),
      set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
        const before = options?.merge ? (docs.get(path) ?? {}) : {}
        // Merged the way Firestore merges: maps all the way down.
        const deep = (prior: unknown, value: unknown): unknown => {
          if (!value || typeof value !== 'object' || !prior || typeof prior !== 'object') return value
          const out: Record<string, unknown> = { ...(prior as Record<string, unknown>) }
          for (const [key, next] of Object.entries(value as Record<string, unknown>)) out[key] = deep(out[key], next)
          return out
        }
        docs.set(path, options?.merge ? (deep(before, data) as Record<string, unknown>) : { ...data })
      },
    }
  }
  const snapshot = (path: string): any => {
    const data = docs.get(path)
    return { id: path.split('/').pop(), exists: data !== undefined, ref: docRef(path), data: () => data, get: (field: string) => data?.[field] }
  }
  const collectionRef = (path: string): any => {
    const query = (filters: Array<[string, unknown]>, after: string | null, limit: number): any => ({
      where: (field: string, _op: string, value: unknown) => query([...filters, [field, value]], after, limit),
      orderBy: () => query(filters, after, limit),
      limit: (n: number) => query(filters, after, n),
      startAfter: (ref: { id: string }) => query(filters, ref.id, limit),
      get: async () => {
        const depth = path.split('/').length + 1
        const matched = [...docs.keys()]
          .filter((key) => key.startsWith(`${path}/`) && key.split('/').length === depth)
          .sort()
          .map(snapshot)
          .filter((doc) => filters.every(([field, value]) => doc.get(field) === value))
          .filter((doc) => after === null || doc.id > after)
          .slice(0, limit)
        return { docs: matched, size: matched.length }
      },
    })
    return { ...query([], null, Infinity), doc: (id: string) => docRef(`${path}/${id}`) }
  }
  return {
    docs,
    collection: (name: string) => collectionRef(name),
    getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => snapshot(ref.path)),
  }
}

/** Monday 2026-10-12 at 13:00 UTC: the run covers Monday 10/5 to Sunday 10/11. */
const RUN_AT = new Date('2026-10-12T13:00:00Z')
const MARKER = `orgs/o1/${WEEKLY_SUMMARY_MARKERS}/2026-W41`

const COLORS: WeeklySummaryColors = {
  text: '#212121',
  muted: '#666666',
  border: '#e0e0e0',
  surface: '#fafafa',
  accent: '#00b0ff',
  link: '#0077ad',
  up: '#357a38',
  down: '#9e1e1b',
}

function trafficTable(visitors: number): PluginFigureTable {
  return {
    title: 'Traffic',
    source: { label: 'Analytics', path: 'analytics' },
    period: { from: '2026-10-05', to: '2026-10-11', days: 7 },
    columns: [
      { key: 'figure', label: 'Figure', kind: 'text' },
      { key: 'current', label: 'This window', kind: 'count' },
    ],
    rows: [{ figure: 'Visitors', current: visitors }],
    omitted: 0,
    notes: [],
  }
}

function member(uid: string, role: string, extra: Partial<AglynOrgMember> = {}): AglynOrgMember {
  return { $id: uid, role, email: `${uid}@example.com`, ...extra } as AglynOrgMember
}

/** A site reader whose visitors are set per site, and a workspace reader of deals. */
function readers(visitorsBySite: Record<string, number>, deals: boolean) {
  const reads: Array<{ hostId: string | null; days: number; now: Date }> = []
  const traffic: ResolvedPluginFigureReader = {
    pluginId: 'ai',
    reader: {
      id: 'traffic.summary',
      label: 'Traffic',
      description: 'Visitors.',
      scope: 'site',
      windows: [7, 14],
      plugin: null,
      weeklySummary: {
        order: 10,
        summarize: (table) => {
          const count = Number(table.rows[0]?.['current'] ?? 0)
          return count
            ? { title: 'Traffic', stats: [{ label: 'Visitors', value: String(count), total: { count, one: 'visitor', many: 'visitors' } }] }
            : null
        },
      },
      read: async (request) => {
        reads.push({ hostId: request.hostId, days: request.days, now: request.now })
        return { ok: true, table: trafficTable(visitorsBySite[request.hostId ?? ''] ?? 0) }
      },
    },
  }
  const closed: ResolvedPluginFigureReader = {
    pluginId: 'crm',
    reader: {
      id: 'crm.closed',
      label: 'Deals',
      description: 'Deals won.',
      scope: 'org',
      windows: [7],
      weeklySummary: {
        order: 10,
        summarize: () => (deals ? { title: 'Deals closed', stats: [{ label: 'Won', value: '2' }] } : null),
      },
      read: async () => ({ ok: true, table: trafficTable(1) }),
    },
  }
  return {
    reads,
    deps: async ({ hostId }: { hostId: string | null }) => (hostId ? [traffic, closed] : [closed]),
  }
}

function setup(
  options: {
    visitors?: Record<string, number>
    deals?: boolean
    members?: AglynOrgMember[]
    send?: WeeklySummaryDeps['send']
    dryRun?: boolean
  } = {},
) {
  const firestore = memoryFirestore({
    'orgs/o1': { name: 'Acme', slug: 'acme' },
    'hosts/h1': { orgId: 'o1', subdomain: 'shop', name: 'Shop' },
    'hosts/h2': { orgId: 'o1', subdomain: 'blog', name: 'Blog', cname: 'blog.acme.test' },
    'hosts/h3': { orgId: 'other', subdomain: 'theirs', name: 'Theirs' },
    'hosts/h1/analytics/2026-10-06': { total: 40 },
    'users/u2': { digestPrefs: { weeklySummary: false } },
  })
  const sent: WeeklySummaryMessage[] = []
  const { reads, deps: readersDep } = readers(options.visitors ?? { h1: 120, h2: 30 }, options.deals ?? false)
  const deps: WeeklySummaryDeps = {
    firestore: firestore as never,
    runAt: RUN_AT,
    dryRun: options.dryRun ?? false,
    origin: 'https://app.example.com',
    flagOn: () => true,
    orgMembers: async () =>
      options.members ?? [
        member('u1', 'owner'),
        member('u2', 'admin'),
        member('u3', 'editor'),
        member('u4', 'admin', { orgSuspended: true } as never),
      ],
    reachable: async (uids) => uids,
    readers: readersDep,
    colors: () => COLORS,
    address: async (one) => String(one.email),
    send:
      options.send ??
      (async (message) => {
        sent.push(message)
        return { sent: true, rateLimited: false }
      }),
  }
  return { firestore, deps, sent, reads }
}

const summary = (message: WeeklySummaryMessage) => `${message.to} ${message.template} ${message.email.subject}`

describe('the weekly summary sweep (AGL-3867)', () => {
  it('sends each owner and admin who kept it on the overview and each active site’s email, once a week', async () => {
    const { deps, sent, reads, firestore } = setup()
    const report = await runWeeklySummarySweep(deps)
    // u2 switched it off, u3 is not a manager of any site, u4 is suspended.
    expect(sent.map(summary)).toEqual([
      'u1@example.com weekly-summary Your week at Acme: 150 visitors',
      'u1@example.com weekly-summary-site Shop last week: 120 visitors',
      'u1@example.com weekly-summary-site Blog last week: 30 visitors',
    ])
    const [overview, shop, blog] = sent
    expect(overview.email.html).toContain('Across 2 sites')
    expect(overview.merge).toMatchObject({ 'summary.url': 'https://app.example.com/acme', 'org.name': 'Acme' })
    // Each site's email says which site it is: its custom domain when it has one.
    expect(shop.email.html).toContain('<a href="https://shop.aglyn.app"')
    expect(blog.email.html).toContain('<a href="https://blog.acme.test"')
    expect(shop.merge).toMatchObject({
      'summary.title': 'Shop last week',
      'summary.buttonLabel': 'Open Shop',
      'summary.url': 'https://app.example.com/acme/hosts/shop',
      'summary.html': shop.email.html,
    })
    // The seven whole days before the run, never a part of Monday.
    expect(reads[0]).toEqual({ hostId: 'h1', days: 7, now: new Date('2026-10-11T23:59:59.999Z') })
    expect(report).toMatchObject({ week: '2026-W41', swept: 1, sent: 3, done: true, deferred: false })
    expect(firestore.docs.get(MARKER)?.['sent']).toEqual({ u1: { overview: true, h1: true, h2: true } })

    // A second run in the same week sends nothing new.
    sent.length = 0
    await runWeeklySummarySweep(deps)
    expect(sent).toEqual([])
  })

  it('folds the workspace into the one site’s email when only one site had anything, and sends no overview', async () => {
    const { deps, sent } = setup({ visitors: { h1: 120 }, deals: true })
    await runWeeklySummarySweep(deps)
    expect(sent.map(summary)).toEqual(['u1@example.com weekly-summary-site Shop last week: 120 visitors'])
    expect(sent[0].email.html).toContain('Acme · Deals closed')
  })

  it('sends a site’s own admin that site’s email, and nothing about the workspace', async () => {
    const { deps, sent } = setup({
      deals: true,
      members: [member('u5', 'editor', { hostAccess: { h1: 'editor', h2: 'admin' } } as never)],
    })
    await runWeeklySummarySweep(deps)
    expect(sent.map(summary)).toEqual(['u5@example.com weekly-summary-site Blog last week: 30 visitors'])
    expect(sent[0].email.html).not.toContain('Deals closed')
  })

  it('sends nothing when nothing happened', async () => {
    const { deps, sent } = setup({ visitors: {} })
    const report = await runWeeklySummarySweep(deps)
    expect(sent).toEqual([])
    expect(report.orgs['o1']).toMatchObject({ skipped: 'nothing-to-report' })
  })

  it('reports and sends nothing on a dry run', async () => {
    const { deps, sent, firestore } = setup({ dryRun: true })
    const report = await runWeeklySummarySweep(deps)
    expect(sent).toEqual([])
    expect(report).toMatchObject({ dryRun: true, sent: 3 })
    expect(firestore.docs.has(MARKER)).toBe(false)
  })

  it('stops the run, finished, when the send rate refuses, and stamps nobody', async () => {
    const { deps, firestore } = setup({
      send: async () => ({ sent: false, rateLimited: true, reason: 'rate-limited' }),
    })
    const report = await runWeeklySummarySweep(deps)
    expect(report).toMatchObject({ deferred: 'rate', done: true, nextCursor: null, sent: 0 })
    expect(firestore.docs.has(MARKER)).toBe(false)
  })

  it('points to AI weekly insights only where the plan includes them, they are released, and the person has not turned them on', async () => {
    const withAi = async (flag: boolean, subscribed: boolean) => {
      const { deps, sent, firestore } = setup({ visitors: { h1: 120 } })
      firestore.docs.set('orgs/o1', { name: 'Acme', slug: 'acme', plan: 'free' })
      if (subscribed) firestore.docs.set('users/u1', { insightDigests: { o1: true } })
      await runWeeklySummarySweep({ ...deps, flagOn: () => flag })
      return sent
    }
    const offered = await withAi(true, false)
    expect(offered).toHaveLength(1)
    expect(offered[0].email.html).toContain('https://app.example.com/acme/hosts/shop/analytics')
    expect((await withAi(false, false))[0].email.html).not.toContain('AI weekly insights')
    expect((await withAi(true, true))[0].email.html).not.toContain('AI weekly insights')
  })
})
