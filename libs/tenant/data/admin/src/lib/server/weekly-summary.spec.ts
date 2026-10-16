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
import {
  runWeeklySummarySweep,
  WEEKLY_SUMMARY_MARKERS,
  type WeeklySummaryDeps,
  type WeeklySummaryEmail,
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
        const merged: Record<string, unknown> = { ...before }
        for (const [key, value] of Object.entries(data)) {
          const prior = merged[key]
          merged[key] =
            options?.merge && value && typeof value === 'object' && prior && typeof prior === 'object'
              ? { ...(prior as object), ...(value as object) }
              : value
        }
        docs.set(path, merged)
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

function trafficTable(visitors: number): PluginFigureTable {
  return {
    title: 'Traffic',
    source: { label: 'Analytics', path: 'analytics' },
    period: { from: '2026-10-05', to: '2026-10-11', days: 7 },
    columns: [
      { key: 'figure', label: 'Figure', kind: 'text' },
      { key: 'current', label: 'This window', kind: 'count' },
      { key: 'previous', label: 'Window before', kind: 'count' },
      { key: 'change', label: 'Change', kind: 'change' },
    ],
    rows: [
      { figure: 'Page views', current: visitors * 3, previous: visitors * 2, change: 50 },
      { figure: 'Visitors', current: visitors, previous: visitors, change: 0 },
    ],
    omitted: 0,
    notes: [],
  }
}

function member(uid: string, role: string, extra: Partial<AglynOrgMember> = {}): AglynOrgMember {
  return { $id: uid, role, email: `${uid}@example.com`, ...extra } as AglynOrgMember
}

function setup(options: { visitors?: number; send?: WeeklySummaryDeps['send']; dryRun?: boolean } = {}) {
  const firestore = memoryFirestore({
    'orgs/o1': { name: 'Acme', slug: 'acme' },
    'hosts/h1': { orgId: 'o1', subdomain: 'shop', name: 'Shop' },
    'hosts/h2': { orgId: 'other', subdomain: 'theirs', name: 'Theirs' },
    'hosts/h1/analytics/2026-10-06': { total: 40 },
    'users/u2': { digestPrefs: { weeklySummary: false } },
  })
  const sent: WeeklySummaryEmail[] = []
  const reads: Array<{ hostId: string | null; days: number; now: Date }> = []
  const traffic: ResolvedPluginFigureReader = {
    pluginId: 'ai',
    reader: {
      id: 'traffic.summary',
      label: 'Traffic',
      description: 'Page views and visitors.',
      scope: 'site',
      windows: [7, 14, 30, 90],
      plugin: null,
      read: async (request) => {
        reads.push({ hostId: request.hostId, days: request.days, now: request.now })
        return { ok: true, table: trafficTable(options.visitors ?? 120) }
      },
    },
  }
  const deps: WeeklySummaryDeps = {
    firestore: firestore as never,
    runAt: RUN_AT,
    dryRun: options.dryRun ?? false,
    origin: 'https://app.example.com',
    flagOn: () => true,
    listMembers: async () => [
      member('u1', 'owner'),
      member('u2', 'admin'),
      member('u3', 'member'),
      member('u4', 'admin', { orgSuspended: true } as never),
    ],
    reachable: async (uids) => uids,
    readers: async ({ ids }) => (ids.includes('traffic.summary') ? [traffic] : []),
    address: async (one) => String(one.email),
    send:
      options.send ??
      (async (email) => {
        sent.push(email)
        return { sent: true, rateLimited: false }
      }),
  }
  return { firestore, deps, sent, reads }
}

describe('the weekly summary sweep (AGL-3867)', () => {
  it('emails each owner and admin who kept it on, once, with the site’s figures', async () => {
    const { deps, sent, reads, firestore } = setup()
    const report = await runWeeklySummarySweep(deps)
    // u2 switched it off, u3 is not a manager, u4 is suspended.
    expect(sent.map((email) => email.to)).toEqual(['u1@example.com'])
    const [email] = sent
    expect(email.subject).toBe('Your week at Acme: 120 visitors')
    expect(email.body).toContain('Shop')
    expect(email.body).toContain('Visitors: 120 (no change) · Page views: 360 (+50%)')
    expect(email.body).toContain('https://app.example.com/acme/hosts/shop')
    expect(email.body).toContain('Oct 5 – Oct 11')
    expect(email.merge['summary.body']).toBe(email.body)
    // The closing line rides in the footer of the designed email, and in the plain text.
    expect(email.body).not.toContain('Turn it off in Notifications')
    expect(email.text).toContain('Turn it off in Notifications')
    // The seven whole days before the run, never a part of Monday.
    expect(reads).toEqual([{ hostId: 'h1', days: 7, now: new Date('2026-10-11T23:59:59.999Z') }])
    expect(report).toMatchObject({ week: '2026-W41', swept: 1, sent: 1, done: true, deferred: false })
    expect(firestore.docs.get(`orgs/o1/${WEEKLY_SUMMARY_MARKERS}/2026-W41`)?.['sent']).toEqual({ u1: true })

    // A second run in the same week reaches nobody new.
    sent.length = 0
    const again = await runWeeklySummarySweep(deps)
    expect(sent).toEqual([])
    // u2 is still asked, and still has it off.
    expect(again.orgs['o1']).toMatchObject({ skipped: 'summary-off' })
  })

  it('sends nothing when nothing happened', async () => {
    const { deps, sent } = setup({ visitors: 0 })
    const report = await runWeeklySummarySweep(deps)
    expect(sent).toEqual([])
    expect(report.orgs['o1']).toMatchObject({ skipped: 'nothing-to-report' })
  })

  it('reports and sends nothing on a dry run', async () => {
    const { deps, sent, firestore } = setup({ dryRun: true })
    const report = await runWeeklySummarySweep(deps)
    expect(sent).toEqual([])
    expect(report).toMatchObject({ dryRun: true, sent: 1 })
    expect(firestore.docs.has(`orgs/o1/${WEEKLY_SUMMARY_MARKERS}/2026-W41`)).toBe(false)
  })

  it('stops the run, finished, when the send rate refuses, and stamps nobody', async () => {
    const { deps, firestore } = setup({
      send: async () => ({ sent: false, rateLimited: true, reason: 'rate-limited' }),
    })
    const report = await runWeeklySummarySweep(deps)
    expect(report).toMatchObject({ deferred: 'rate', done: true, nextCursor: null, sent: 0 })
    expect(firestore.docs.has(`orgs/o1/${WEEKLY_SUMMARY_MARKERS}/2026-W41`)).toBe(false)
  })

  it('points to AI weekly insights only where the plan includes them, they are released, and the person has not turned them on', async () => {
    const withAi = (flag: boolean, subscribed: boolean) => {
      const { deps, sent, firestore } = setup()
      firestore.docs.set('orgs/o1', { name: 'Acme', slug: 'acme', plan: 'free' })
      if (subscribed) firestore.docs.set('users/u1', { insightDigests: { o1: true } })
      return runWeeklySummarySweep({ ...deps, flagOn: () => flag }).then(() => sent)
    }
    const offered = await withAi(true, false)
    expect(offered).toHaveLength(1)
    expect(offered[0].body).toContain('AI weekly insights')
    expect(offered[0].body).toContain('https://app.example.com/acme/hosts/shop/analytics')

    const unreleased = await withAi(false, false)
    expect(unreleased).toHaveLength(1)
    expect(unreleased[0].body).not.toContain('AI weekly insights')

    const alreadyOn = await withAi(true, true)
    expect(alreadyOn).toHaveLength(1)
    expect(alreadyOn[0].body).not.toContain('AI weekly insights')
  })
})
