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

/**
 * No dead buttons (AGL-3368). Every action a risk notice offers — owner or
 * staff — and every item page a signal source links resolves to a console
 * page that exists: a page file in the App Router tree, or, behind a
 * catch-all, a nav item (and section) a registered plugin declares. The
 * query keys the links carry are read by the pages they land on.
 *
 * ⛔ Registers every console plugin through the generated manifest first, so
 * a plugin dropped from it fails here rather than resolving nothing and
 * reading as "no plugin paths to check".
 */

import {
  resetPluginServicesForTests,
  resolveConsoleOrgPluginPage,
  resolveConsolePluginPage,
} from '@aglyn/aglyn'
import {
  resolveRiskActionHref,
  RISK_EVENT_KINDS,
  RISK_NOTICE_CATALOG,
  RISK_OWNER_ACTION_IDS,
  RISK_OWNER_ACTIONS,
  RISK_STAFF_ACTION_IDS,
  RISK_STAFF_ACTIONS,
} from '@aglyn/shared-util-email/risk-notice-catalog'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CONSOLE_PLUGIN_MANIFEST } from '../constants/plugins.client.generated'

const APP = join(__dirname, '..', 'app')
const HOST = 'HOSTID1'

type Resolution = { page: string } | { catchAll: 'org' | 'host'; rest: string[] } | null

/** Match URL segments against the App Router tree, route groups transparent. */
function match(dir: string, segments: readonly string[], level: 'root' | 'org' | 'host'): Resolution {
  const children = readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory())
  if (!segments.length) {
    if (existsSync(join(dir, 'page.tsx'))) return { page: join(dir, 'page.tsx') }
    for (const child of children.filter((name) => name.startsWith('('))) {
      const found = match(join(dir, child), segments, level)
      if (found) return found
    }
    return null
  }
  const [head, ...rest] = segments
  const ordered = [
    ...children.filter((name) => name === head),
    ...children.filter((name) => name.startsWith('(')),
    // `[staffPage]` is the generic staff route every plugin's staff page
    // shares; accepting it would read any `/admin/<typo>` as a page.
    ...children.filter((name) => /^\[[^.[\]]+\]$/.test(name) && name !== '[staffPage]'),
    ...children.filter((name) => name.startsWith('[...') || name.startsWith('[[...')),
  ]
  // A real page anywhere beats a plugin catch-all: the editor's routes live
  // in another group than the site shell's catch-all.
  let fallback: Resolution = null
  for (const child of ordered) {
    const path = join(dir, child)
    let found: Resolution = null
    if (child.startsWith('(')) {
      found = match(path, segments, level)
    } else if (child.startsWith('[...') || child.startsWith('[[...')) {
      if (level === 'org' || level === 'host') found = { catchAll: level, rest: [...segments] }
    } else {
      const nextLevel =
        child === '[orgSlug]' ? 'org' : child === '[host]' && level === 'org' ? 'host' : level
      found = match(path, rest, nextLevel as typeof level)
    }
    if (found && 'page' in found) return found
    fallback = fallback ?? found
  }
  return fallback
}

/** A stored-shape console path, as the reader's browser will open it. */
function concrete(path: string): string[] {
  const bare = path.split(/[?#]/)[0]
  if (bare === '/org' || bare.startsWith('/org/')) return ['acme', ...bare.slice(5).split('/').filter(Boolean)]
  if (bare === `/${HOST}` || bare.startsWith(`/${HOST}/`)) {
    return ['acme', 'hosts', 'site', ...bare.slice(HOST.length + 2).split('/').filter(Boolean)]
  }
  return bare.split('/').filter(Boolean)
}

function resolves(path: string): { ok: boolean; how: string } {
  if (path.startsWith('https://')) {
    return { ok: path.startsWith('https://dashboard.stripe.com/'), how: 'external' }
  }
  const found = match(APP, concrete(path), 'root')
  if (!found) return { ok: false, how: 'no page' }
  if ('page' in found) return { ok: true, how: found.page }
  const href = `/${found.rest.join('/')}`
  const plugin =
    found.catchAll === 'org' ? resolveConsoleOrgPluginPage(href) : resolveConsolePluginPage(href)
  if (!plugin) return { ok: false, how: `no plugin page for ${found.catchAll} ${href}` }
  // A path past the nav item must name a section it declares.
  const declaresSections = Boolean(plugin.navItem.sections?.length)
  if (declaresSections && plugin.segments.length && !plugin.section) {
    return { ok: false, how: `no section ${plugin.segments[0]} on ${plugin.navItem.href}` }
  }
  return { ok: true, how: `plugin ${plugin.extension.pluginId} ${plugin.navItem.href}` }
}

/** Every item page a signal source links, as the source writes it. */
const ITEM_PATHS = [
  '/org/emails/messages/send-1',
  '/org/emails/sending',
  '/org/automation',
  `/${HOST}/automation`,
  '/org/marketplace/listings',
  '/org/marketplace/payouts',
  `/${HOST}/screens/screen-1/versions/v2/view`,
  `/${HOST}/admin/domain`,
  `/${HOST}/products`,
  `/${HOST}/products/orders?order=order-1`,
  `/${HOST}/bookings`,
  `/${HOST}`,
  '/org/billing',
  '/org/billing/invoices',
  '/org/settings/holds',
]

beforeAll(async () => {
  resetPluginServicesForTests()
  expect(CONSOLE_PLUGIN_MANIFEST.length).toBeGreaterThan(5)
  for (const entry of CONSOLE_PLUGIN_MANIFEST) {
    const loaded = (await entry.load()) as Record<string, () => void>
    const register = entry.register?.console
    if (register && typeof loaded[String(register)] === 'function') loaded[String(register)]()
  }
})

describe('every risk notice action lands on a real page', () => {
  it('CONTROL: the resolver refuses a page that does not exist', () => {
    expect(resolves('/org/settings/no-such-section').ok).toBe(false)
    expect(resolves(`/${HOST}/products/no-such-section`).ok).toBe(false)
    expect(resolves('/admin/no-such-page').ok).toBe(false)
  })

  it.each(ITEM_PATHS)('the item page %s', (path) => {
    expect({ path, ...resolves(path) }).toMatchObject({ path, ok: true })
  })

  it.each(RISK_OWNER_ACTION_IDS)('the owner action %s', (id) => {
    for (const itemPath of ITEM_PATHS) {
      const href = resolveRiskActionHref(RISK_OWNER_ACTIONS[id], {
        itemPath,
        noticeId: 'a'.repeat(40),
        hostId: HOST,
        orgId: 'org-1',
      })
      expect(href).not.toBeNull()
      expect({ id, href, ...resolves(String(href)) }).toMatchObject({ id, ok: true })
    }
  })

  it.each(RISK_STAFF_ACTION_IDS)('the staff action %s', (id) => {
    const href = resolveRiskActionHref(RISK_STAFF_ACTIONS[id], {
      reviewId: 'b'.repeat(40),
      orgId: 'org-1',
      hostId: HOST,
      stripeUrl: 'https://dashboard.stripe.com/test/payments/pi_1',
      lockScope: 'org',
      lockTargetId: 'org-1',
    })
    expect(href).not.toBeNull()
    expect({ id, href, ...resolves(String(href)) }).toMatchObject({ id, ok: true })
  })

  it('gives every kind at least one owner action and one staff action that resolve', () => {
    for (const kind of RISK_EVENT_KINDS) {
      const definition = RISK_NOTICE_CATALOG[kind]
      const owner = definition.owner.actions
        .map((id) => resolveRiskActionHref(RISK_OWNER_ACTIONS[id], { itemPath: '/org/billing', noticeId: 'n', hostId: HOST }))
        .filter((href): href is string => Boolean(href))
      const staff = definition.staff.actions
        .map((id) =>
          resolveRiskActionHref(RISK_STAFF_ACTIONS[id], {
            reviewId: 'r',
            orgId: 'o',
            hostId: HOST,
            stripeUrl: 'https://dashboard.stripe.com/x',
            lockScope: 'org',
            lockTargetId: 'o',
          }),
        )
        .filter((href): href is string => Boolean(href))
      expect({ kind, owner: owner.length > 0, staff: staff.length > 0 }).toEqual({ kind, owner: true, staff: true })
      for (const href of [...owner, ...staff]) expect({ kind, href, ...resolves(href) }).toMatchObject({ ok: true })
    }
  })
})

describe('the query keys the links carry are read where they land', () => {
  const source = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8')

  it('the abuse queue opens `?report=` and pre-selects `&decide=`', () => {
    const page = source('app/(app)/admin/abuse-reports/page.tsx')
    expect(page).toContain("params.get('report')")
    expect(page).toContain("params.get('decide')")
  })

  it('Lockdown pre-fills `?scope=&targetId=`', () => {
    const page = source('app/(app)/admin/lockdown/page.tsx')
    expect(page).toContain("params.get('scope')")
    expect(page).toContain("params.get('targetId')")
  })

  it('Holds & reviews opens the request for `?notice=`', () => {
    expect(source('components/settings/org-holds-card.component.tsx')).toContain("get('notice')")
  })

  it('the staff org page anchors its Subscription card at #subscription', () => {
    expect(source('components/staff-org-subscription-card.component.tsx')).toContain(
      "STAFF_SUBSCRIPTION_CARD_ID = 'subscription'",
    )
  })
})
