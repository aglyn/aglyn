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

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/*
 * A store build of the apps takes no payment to Aglyn (the owner's decision of
 * 2026-11-19): every spec control that takes or starts one is held by
 * `app.billing`, which is false in a store build. This sweeps every native
 * `*.screens.json` and fails on a press, link or navigation into buying that
 * no condition on its path (the screen's `requires`, a block's or an item's
 * `when`) holds with `app.billing`.
 *
 * What counts as buying:
 * - opening a screen whose own `requires` holds `app.billing` (Choose a plan);
 * - a write to a route that charges: Checkout, the Stripe portal, a plan
 *   switch or resume, an add-on quantity, a default card, a marketplace
 *   payment, the AI overage settings, turning domain auto-renew on;
 * - opening a Stripe hosted invoice or Checkout page from Aglyn's own billing.
 *
 * What it cannot see: navigation written by hand in Swift or Kotlin
 * (`context.navigate("core.billing.plans")`, the plan card, the workspace
 * menu, the marketplace Buy button). Those are held by
 * `StoreBilling.buying` and the kit components that read it
 * (AglynUpgradeNotice / UpgradeNotice, AglynUpsellState, the store line,
 * `planUpgradeAction`), each with its own kit test.
 */

const ROOT = resolve(__dirname, '../../..')

/** Screens that are not Aglyn taking a payment from the reader. */
const NOT_BUYING_SCREENS: Array<[RegExp, string]> = [
  [/^core\.staff\./, 'staff tools, never a payment from the reader'],
  [/^ai\.staff/, 'staff tools'],
  [/^commerce\./, "a merchant's own sales and subscriptions"],
]

/** Presses that reach a charging route but take nothing (each one named). */
const NOT_BUYING_PRESSES = new Set([
  'core.billing.addons#off', // turns an add-on off: a cancellation
  'core.billing.cancel.offers#cancel', // cancels the plan
])

type Node = Record<string, unknown>

const screenFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'build') return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return screenFiles(path)
    return name.endsWith('.screens.json') ? [path] : []
  })

/** Each file once: the Android plugin folders link to the iOS resource. */
const FILES = [
  ...new Set(
    [...screenFiles(join(ROOT, 'libs/native/screens')), ...screenFiles(join(ROOT, 'libs/plugins'))].map((file) =>
      realpathSync(file),
    ),
  ),
].sort()

const SCREENS: Node[] = FILES.flatMap((file) => {
  const spec = JSON.parse(readFileSync(file, 'utf8')) as { screens?: Node[] }
  return (spec.screens ?? []).map((screen) => ({ ...screen, __file: relative(ROOT, file) }))
})

/** `app.billing` as a condition that must hold, not its negation. */
const HOLDS_BILLING = /(^|[^!\w.])app\.billing\b(?!Link)/
const held = (conditions: string[]): boolean => conditions.some((one) => HOLDS_BILLING.test(one))

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const body = (node: Node): Node => (node['body'] && typeof node['body'] === 'object' ? (node['body'] as Node) : {})

const BUY_SCREENS = new Set(
  SCREENS.filter((screen) => HOLDS_BILLING.test(text(screen['requires']))).map((screen) => text(screen['id'])),
)

/** Why a node takes or starts a payment to Aglyn, or null. */
function buying(node: Node): string | null {
  const screen = text(node['screen'])
  if (screen && BUY_SCREENS.has(screen)) return `opens ${screen}`
  const url = text(node['url'])
  if (url && node['method'] !== 'GET') {
    const action = text(body(node)['action'])
    if (url.startsWith('/api/billing/checkout')) return 'Checkout'
    if (url.startsWith('/api/billing/subscription') && ['portal', 'switch', 'resume'].includes(action)) {
      return `subscription ${action}`
    }
    if (url.startsWith('/api/billing/addons') && action === 'set') return 'add-on quantity'
    if (url.startsWith('/api/billing/profile') && action === 'set-default-card') return 'default card'
    if (url.startsWith('/api/marketplace/pay')) return 'marketplace payment'
    if (url.startsWith('/api/ai/billing/overage')) return 'AI overage'
    if (url.startsWith('/api/registrar/auto-renew') && body(node)['autoRenew'] === true) return 'auto-renew on'
    if (/^\/api\/registrar\/(buy|purchase|register|renew|checkout)/.test(url)) return 'domain purchase'
  }
  for (const key of ['open', 'link']) {
    if (/hostedInvoiceUrl|checkoutUrl/.test(text(node[key]))) return `${key} a Stripe page`
  }
  return null
}

const SKIPPED = new Set(['load', '__file'])

function sweep(value: unknown, conditions: string[], screenId: string, found: string[], file: string): void {
  if (Array.isArray(value)) {
    value.forEach((one) => sweep(one, conditions, screenId, found, file))
    return
  }
  if (!value || typeof value !== 'object') return
  const node = value as Node
  const here = [...conditions, text(node['when']), text(node['requires'])].filter(Boolean)
  const why = buying(node)
  const id = text(node['id']) || text(node['label']) || text(node['title'])
  // A named press that takes nothing, with what it does next (its `instead`) included.
  if (NOT_BUYING_PRESSES.has(`${screenId}#${id}`)) return
  if (why && !held(here)) {
    found.push(`${file} ${screenId} "${id}": ${why}, with no app.billing on its path`)
  }
  for (const [key, child] of Object.entries(node)) if (!SKIPPED.has(key)) sweep(child, here, screenId, found, file)
}

describe('store builds reach no buying from a native screen (the owner’s decision of 2026-11-19)', () => {
  it('reads every native screen file', () => {
    expect(FILES.length).toBeGreaterThan(20)
    expect(BUY_SCREENS.has('core.billing.plans')).toBe(true)
  })

  it('holds every press, link and navigation into buying with app.billing', () => {
    const found: string[] = []
    for (const screen of SCREENS) {
      const id = text(screen['id'])
      if (NOT_BUYING_SCREENS.some(([pattern]) => pattern.test(id))) continue
      // The screen's own `requires` is the start of the path, except on a buy screen itself, whose
      // `app.billing` only says a store build lands on the store-state page: its controls are checked as reached.
      const start = BUY_SCREENS.has(id) ? [] : [text(screen['requires'])].filter(Boolean)
      sweep(screen, start, id, found, text(screen['__file']))
    }
    expect(found).toEqual([])
  })

  it('knows a buying press when it sees one', () => {
    const found: string[] = []
    sweep(
      { blocks: [{ type: 'links', items: [{ title: 'See plans', screen: 'core.billing.plans' }] }] },
      [],
      'example',
      found,
      'example',
    )
    sweep({ blocks: [{ when: 'app.billing', items: [{ screen: 'core.billing.plans' }] }] }, [], 'held', found, 'held')
    sweep({ blocks: [{ when: '!app.billing', items: [{ screen: 'core.billing.plans' }] }] }, [], 'negated', found, 'negated')
    expect(found.map((line) => line.split(' ')[1])).toEqual(['example', 'negated'])
  })
})
