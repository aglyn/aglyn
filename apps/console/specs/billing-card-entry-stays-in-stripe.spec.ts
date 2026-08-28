/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
 *
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
 * A card number never reaches our DOM, our server or our logs.
 *
 * The native billing page put a card LIST and an "Add new card" button on a
 * surface that is ours. The thing that must not follow is the card FORM. The
 * distance between "we render the list" and "we render the input" is one
 * plausible-looking commit, and it is the commit that would put a PAN into a
 * request body, a Next.js server log and a log drain — and move this product
 * from SAQ-A into a compliance scope nobody has budgeted for.
 *
 * No individual test can find that, because the offending file would look
 * fine on its own. So this is an exhaustive sweep of the billing surface —
 * client and server — for the shapes that collect card data, plus a
 * behavioural check that the one action which touches card entry hands back a
 * Stripe client secret and nothing else.
 *
 * ## Why the allow-list is what it is
 *
 * `expMonth`/`exp_month`/`last4`/`brand` are NOT forbidden. They are fields
 * Stripe RETURNS about a saved method, and the list card renders them — that
 * is the whole point of a native list. What is forbidden is the vocabulary of
 * COLLECTION: a number, a CVC, an autocomplete hint that asks a browser to
 * fill a card into our input.
 *
 * ## Comments are stripped before the sweep
 *
 * Not a convenience. Every file this guard protects carries a docblock saying
 * WHY it must not touch a card, and those docblocks necessarily contain the
 * words "CVC" and "card number". Scanning raw source makes the explanation of
 * the rule trip the rule — so the guard would be permanently red on correct
 * code, and the only way to green would be to delete the reasoning. Stripping
 * comments first is what lets the code be documented and checked at once.
 */

export {}

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { stripTypeScriptComments } from '@aglyn/aglyn/foundation/definitions/write-deny-coverage.util'

const CONSOLE_ROOT = join(__dirname, '..')
const REPO_ROOT = join(CONSOLE_ROOT, '..', '..')

/**
 * Every shape that means "a card is being typed into something of ours".
 *
 * Written as the field vocabulary rather than as a regex for digits: a PAN is
 * just digits and cannot be recognized in source, but the NAME of the input
 * that would hold one always can.
 */
const COLLECTS_CARD_DATA: Array<{ pattern: RegExp; what: string }> = [
  { pattern: /\bcardNumber\b/, what: 'a card-number field' },
  { pattern: /\bcard_number\b/, what: 'a card-number field' },
  { pattern: /card\[number\]/, what: "Stripe's raw card[number] parameter" },
  { pattern: /payment_method_data\[card\]\[/, what: 'raw card data sent to Stripe by us' },
  { pattern: /\bcvc\b/i, what: 'a CVC field' },
  { pattern: /\bcvv\b/i, what: 'a CVV field' },
  { pattern: /\bsecurityCode\b/i, what: 'a security-code field' },
  { pattern: /autoComplete=["']cc-/, what: "a browser autofill hint for card data" },
  { pattern: /name=["']cardnumber["']/i, what: 'a card-number input' },
]

/** The surfaces swept: everything that could plausibly grow a form. */
const SWEPT_ROOTS = [
  join(CONSOLE_ROOT, 'app', 'api', 'billing'),
  join(CONSOLE_ROOT, 'components', 'billing'),
  join(CONSOLE_ROOT, 'app', '(app)', '[orgSlug]', 'billing'),
]

function walk(dir: string, out: string[] = []): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      walk(full, out)
    } else if (/\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

const SWEPT_FILES = SWEPT_ROOTS.flatMap((root) => walk(root))

describe('the billing surface does not collect card data', () => {
  it('CONTROL — the sweep is reading real files', () => {
    // A sweep that opens nothing reports "no violations" forever, which is
    // indistinguishable from a clean tree (`feedback_blocked_dir_makes_grep_lie`).
    // Prove the read with files known to be present and a token known to be in
    // one of them.
    expect(SWEPT_FILES.length).toBeGreaterThan(10)
    const names = SWEPT_FILES.map((file) => relative(REPO_ROOT, file))
    expect(names).toContain('apps/console/app/api/billing/profile/route.ts')
    expect(names).toContain(
      'apps/console/components/billing/billing-payment-methods-card.component.tsx',
    )
    // Read through the SAME stripping the sweep uses, so this control also
    // proves the stripper did not reduce every file to whitespace — which
    // would make the sweep below vacuously green.
    const joined = SWEPT_FILES.map((file) =>
      stripTypeScriptComments(readFileSync(file, 'utf8')),
    ).join('\n')
    expect(joined).toContain('begin-card-setup')
    expect(joined).toContain('EmbeddedCheckoutDialogComponent')
  })

  it('CONTROL — the patterns match when the shape is actually present', () => {
    // The other half. Patterns that match nothing would also report a clean
    // tree, so exercise each one against the string it is meant to catch.
    const bait = [
      'const cardNumber = body.cardNumber',
      'const card_number = body.card_number',
      "params.set('card[number]', pan)",
      "params.set('payment_method_data[card][number]', pan)",
      '<input name="cardnumber" />',
      '<TextField autoComplete="cc-number" />',
      'const cvc = body.cvc',
      'const cvv = body.cvv',
      'const securityCode = body.securityCode',
    ].join('\n')
    for (const { pattern } of COLLECTS_CARD_DATA) {
      // Not every pattern matches every bait line, but every pattern must
      // match at least one — otherwise it is decoration.
      expect(
        `${pattern}: ${pattern.test(bait) ? 'live' : 'INERT'}`,
      ).toBe(`${pattern}: live`)
    }
  })

  it('has no file that collects a card', () => {
    const violations: string[] = []
    for (const file of SWEPT_FILES) {
      const source = stripTypeScriptComments(readFileSync(file, 'utf8'))
      for (const { pattern, what } of COLLECTS_CARD_DATA) {
        if (pattern.test(source)) {
          violations.push(`${relative(REPO_ROOT, file)} — ${what}`)
        }
      }
    }
    if (violations.length) {
      throw new Error(
        'These billing files collect card data. Card entry must happen inside ' +
          "Stripe's own iframe (the embedded checkout dialog), so that a PAN " +
          'never reaches our DOM, our request bodies or our logs:\n\n' +
          `${violations.map((line) => `  • ${line}`).join('\n')}`,
      )
    }
  })

  it('renders card entry only through Stripe’s own components', () => {
    // The positive statement. The one place a card can be typed is the
    // embedded checkout dialog, and the only thing that dialog renders is
    // Stripe's own React components.
    const dialog = readFileSync(
      join(CONSOLE_ROOT, 'components', 'embedded-checkout-dialog.component.tsx'),
      'utf8',
    )
    expect(dialog).toContain('@stripe/react-stripe-js')
    expect(dialog).toContain('EmbeddedCheckout')

    // And the payment-methods card reaches card entry through that dialog
    // rather than by growing a form of its own.
    const card = readFileSync(
      join(
        CONSOLE_ROOT,
        'components',
        'billing',
        'billing-payment-methods-card.component.tsx',
      ),
      'utf8',
    )
    expect(card).toContain('EmbeddedCheckoutDialogComponent')
  })

  it('reads Stripe’s description of a saved card without re-deriving it', () => {
    // The allow-list's other side: displaying `last4` and an expiry is fine
    // and is what a native list is for. It goes through the shared shaper, so
    // a wallet or Link method — which has no `.card` at all — does not render
    // as "No payment method" (AGL-940).
    const route = readFileSync(
      join(CONSOLE_ROOT, 'app', 'api', 'billing', 'profile', 'route.ts'),
      'utf8',
    )
    expect(route).toContain('describeStripePaymentMethod')
  })
})

/**
 * The behavioural half. The source sweep proves no form exists; this proves
 * the action that opens Stripe's form hands back a client secret and nothing
 * that could be mistaken for card data.
 */
describe('begin-card-setup', () => {
  const mockVerifyIdToken = jest.fn()
  const mockReadOrgBilling = jest.fn()
  let calls: Array<{ url: string; method: string; body: URLSearchParams | null }> = []

  const CLEAN_ENV = (() => {
    const clean = { ...process.env }
    for (const key of Object.keys(clean)) {
      if (key.startsWith('STRIPE_') || key.startsWith('NEXT_PUBLIC_STRIPE_')) {
        delete clean[key]
      }
    }
    return clean
  })()
  const ORIGINAL_ENV = process.env

  beforeEach(() => {
    jest.resetModules()
    jest.doMock('@aglyn/tenant-data-admin', () => ({
      __esModule: true,
      firebaseAdmin: {
        app: () => ({
          auth: () => ({
            verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
          }),
          firestore: () => ({ collection: () => ({ doc: () => ({ set: async () => undefined }) }) }),
        }),
        firestore: { FieldValue: { serverTimestamp: () => 'ts' } },
      },
      isImpersonationSession: () => false,
      emailUnverifiedResponse: () =>
        Response.json({ error: 'Verify your email' }, { status: 403 }),
      memberHasOrgPermission: async () => true,
      readOrgBilling: (...args: unknown[]) => mockReadOrgBilling(...args),
      resolveOrgMembership: async () => ({ orgId: 'org-1', member: { id: 'm-1' } }),
      readOrgBillingCustomerModes: async () => ({ live: false, test: false }),
      logOrgActivity: async () => undefined,
    }))
    jest.doMock('@aglyn/aglyn/server', () => ({
      __esModule: true,
      normalizeAddress: jest.requireActual(
        '@aglyn/aglyn/foundation/definitions/contact.types',
      ).normalizeAddress,
      pluginRequestFromWeb: async (request: Request) => ({
        method: request.method,
        body: await request.json(),
        headers: {
          authorization: request.headers.get('authorization') ?? undefined,
          origin: 'https://app.aglyn.com',
          host: 'app.aglyn.com',
        },
      }),
    }))
    calls = []
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u-1',
      email: 'owner@example.com',
      email_verified: true,
    })
    mockReadOrgBilling.mockResolvedValue({ stripeCustomerId: 'cus_test_1' })
    process.env = {
      ...CLEAN_ENV,
      STRIPE_SECRET_KEY: 'sk_test_fake',
    } as NodeJS.ProcessEnv
    global.fetch = jest.fn(async (url: unknown, init: any) => {
      calls.push({
        url: String(url),
        method: String(init?.method ?? 'GET'),
        body: init?.body ? new URLSearchParams(String(init.body)) : null,
      })
      return {
        ok: true,
        status: 200,
        json: async () => ({ client_secret: 'cs_test_secret_123' }),
      }
    }) as never
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    jest.restoreAllMocks()
    jest.dontMock('@aglyn/tenant-data-admin')
    jest.dontMock('@aglyn/aglyn/server')
  })

  it('opens a Stripe setup session and returns only its client secret', async () => {
    const handler = require('../app/api/billing/profile/route').POST
    const response = await handler(
      new Request('https://app.aglyn.com/api/billing/profile', {
        method: 'POST',
        headers: {
          authorization: 'Bearer tok',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ orgId: 'org-1', action: 'begin-card-setup' }),
      }),
    )
    expect(response.status).toBe(200)
    const session = calls.find((call) => call.url.includes('checkout/sessions'))
    // `mode=setup`, not `subscription`: this attaches a card, it does not sell
    // anything, so there are no line items and nothing is charged.
    expect(session?.body?.get('mode')).toBe('setup')
    expect(session?.body?.get('ui_mode')).toBe('embedded')
    expect(session?.body?.get('customer')).toBe('cus_test_1')
    // The customer stays on the settings page: there is no purchase to return
    // from, so a redirect would be a detour with nothing at the end of it.
    expect(session?.body?.get('redirect_on_completion')).toBe('never')
    // Nothing card-shaped is sent TO Stripe by us — Stripe collects it.
    expect(String(session?.body ?? '')).not.toMatch(/card|cvc|number/i)

    const payload = await response.json()
    expect(payload).toEqual({ clientSecret: 'cs_test_secret_123' })
  })

  it('refuses when the org has no Stripe customer to attach a card to', async () => {
    // An org that has never checked out has no customer. The empty state says
    // so rather than offering a button that could only fail.
    mockReadOrgBilling.mockResolvedValue({})
    const handler = require('../app/api/billing/profile/route').POST
    const response = await handler(
      new Request('https://app.aglyn.com/api/billing/profile', {
        method: 'POST',
        headers: {
          authorization: 'Bearer tok',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ orgId: 'org-1', action: 'begin-card-setup' }),
      }),
    )
    const payload = await response.json()
    expect(payload.customer).toBeNull()
    expect(payload.clientSecret).toBeUndefined()
    expect(calls.some((call) => call.url.includes('checkout/sessions'))).toBe(false)
  })
})
