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
 * That distance got SHORTER when card entry moved from a Stripe-hosted modal
 * to inline Elements. Elements are deliberately indistinguishable from our
 * own inputs — that is the entire point of styling them from our theme — so
 * the visual cue that used to mark "this part is Stripe's" is gone. A
 * hand-rolled card field added beside them would look correct. This guard is
 * the only thing left that can tell the difference, which makes it more
 * load-bearing after the change than before it.
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

/**
 * The checkout panel sits outside `components/billing`, so the directory
 * sweep would miss it — and it is the other surface that renders a payment
 * form. Named explicitly rather than by widening the sweep to all of
 * `components/`, which would drag in every unrelated dialog in the console.
 */
const SWEPT_FILES_EXTRA = [
  join(CONSOLE_ROOT, 'components', 'embedded-checkout-panel.component.tsx'),
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

const SWEPT_FILES = [
  ...SWEPT_ROOTS.flatMap((root) => walk(root)),
  ...SWEPT_FILES_EXTRA,
]

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
    expect(joined).toContain('create-setup-intent')
    expect(joined).toContain('BillingCardFormComponent')
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
          "Stripe's own iframes — the inline Elements fields, or the checkout " +
          'panel — so that a PAN never reaches our DOM, our request bodies or ' +
          'our logs:\n\n' +
          `${violations.map((line) => `  • ${line}`).join('\n')}`,
      )
    }
  })

  it('renders card entry only through Stripe’s own components', () => {
    // The positive statement, and the one that had to be rewritten when the
    // modal became inline Elements.
    //
    // Adding a card is a SETTINGS action, so it renders in our card: the form
    // mounts `PaymentElement`, whose every field is its own cross-origin
    // iframe on Stripe's domain. It has no input of its own — the sweep above
    // proves that; this proves the Stripe component is actually there, which
    // the sweep alone cannot (a file containing no card fields and no Stripe
    // component would pass it).
    const form = readFileSync(
      join(
        CONSOLE_ROOT,
        'components',
        'billing',
        'billing-card-form.component.tsx',
      ),
      'utf8',
    )
    expect(form).toContain('@stripe/react-stripe-js')
    expect(form).toContain('PaymentElement')
    expect(form).toContain('confirmSetup')

    // And the payment-methods card reaches card entry through that form
    // rather than by growing one of its own.
    const card = readFileSync(
      join(
        CONSOLE_ROOT,
        'components',
        'billing',
        'billing-payment-methods-card.component.tsx',
      ),
      'utf8',
    )
    expect(card).toContain('BillingCardFormComponent')

    // The plan PURCHASE keeps Stripe's own checkout — it carries automatic
    // tax, tax id collection, promotion codes, wallets and 3DS, which are
    // load-bearing for a tax position rather than for a layout. It no longer
    // opens over the page, but it is still Stripe rendering the payment step.
    const panel = readFileSync(
      join(CONSOLE_ROOT, 'components', 'embedded-checkout-panel.component.tsx'),
      'utf8',
    )
    expect(panel).toContain('@stripe/react-stripe-js')
    expect(panel).toContain('EmbeddedCheckout')
  })

  it('opens nothing over the page — neither surface is a modal', () => {
    // The owner's actual objection was presentation: an unfamiliar interface
    // that appears and then asks for payment details. Both payment surfaces
    // now render in the flow of the billing page, so a `Dialog` reappearing
    // in either is the regression worth naming.
    for (const file of [
      join(CONSOLE_ROOT, 'components', 'embedded-checkout-panel.component.tsx'),
      join(CONSOLE_ROOT, 'components', 'billing', 'billing-card-form.component.tsx'),
    ]) {
      const source = stripTypeScriptComments(readFileSync(file, 'utf8'))
      expect(`${relative(REPO_ROOT, file)}: ${/<Dialog[\s>]/.test(source) ? 'MODAL' : 'in place'}`).toBe(
        `${relative(REPO_ROOT, file)}: in place`,
      )
    }
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
describe('create-setup-intent', () => {
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

  it('opens a Stripe SetupIntent and returns only its client secret', async () => {
    const handler = require('../app/api/billing/profile/route').POST
    const response = await handler(
      new Request('https://app.aglyn.com/api/billing/profile', {
        method: 'POST',
        headers: {
          authorization: 'Bearer tok',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ orgId: 'org-1', action: 'create-setup-intent' }),
      }),
    )
    expect(response.status).toBe(200)
    const intent = calls.find((call) => call.url.includes('setup_intents'))
    expect(intent?.method).toBe('POST')
    expect(intent?.body?.get('customer')).toBe('cus_test_1')
    // `off_session` is not decoration. The card is being saved to be charged
    // on renewals with nobody present, and saying so at setup time is what
    // lets the issuer authenticate it NOW rather than decline the first
    // unattended renewal months later.
    expect(intent?.body?.get('usage')).toBe('off_session')
    // A SetupIntent, NOT a checkout session: a session renders Stripe's whole
    // checkout UI, which is the second visual language this replaced.
    expect(calls.some((call) => call.url.includes('checkout/sessions'))).toBe(
      false,
    )
    // Nothing card-shaped is sent TO Stripe by us — Stripe collects it.
    expect(String(intent?.body ?? '')).not.toMatch(/card|cvc|number/i)

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
        body: JSON.stringify({ orgId: 'org-1', action: 'create-setup-intent' }),
      }),
    )
    const payload = await response.json()
    expect(payload.customer).toBeNull()
    expect(payload.clientSecret).toBeUndefined()
    expect(calls.some((call) => call.url.includes('setup_intents'))).toBe(false)
  })
})

/**
 * The server does not take the browser's word that a card was saved.
 *
 * `finalize-card-setup` receives a SetupIntent id from the page. That id is
 * the only thing the browser supplies, and it is checked against Stripe before
 * anything is done with it — because a client that supplied SOMEONE ELSE'S
 * intent id would otherwise attach a stranger's card to this workspace's
 * billing, and the next renewal would charge it.
 */
describe('finalize-card-setup verifies the intent server-side', () => {
  const mockVerifyIdToken = jest.fn()
  const mockReadOrgBilling = jest.fn()
  let calls: Array<{ url: string; method: string; body: URLSearchParams | null }> = []
  let intentPayload: Record<string, unknown> = {}
  let customerPayload: Record<string, unknown> = {}

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

  function finalize(setupIntentId = 'seti_1') {
    const handler = require('../app/api/billing/profile/route').POST
    return handler(
      new Request('https://app.aglyn.com/api/billing/profile', {
        method: 'POST',
        headers: {
          authorization: 'Bearer tok',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          orgId: 'org-1',
          action: 'finalize-card-setup',
          setupIntentId,
        }),
      }),
    )
  }

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    jest.doMock('@aglyn/tenant-data-admin', () => ({
      __esModule: true,
      firebaseAdmin: {
        app: () => ({
          auth: () => ({
            verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
          }),
          firestore: () => ({
            collection: () => ({ doc: () => ({ set: async () => undefined }) }),
          }),
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
    intentPayload = {
      id: 'seti_1',
      status: 'succeeded',
      customer: 'cus_test_1',
      payment_method: 'pm_new',
    }
    customerPayload = { email: 'a@example.com', invoice_settings: {} }
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
      const href = String(url)
      const method = String(init?.method ?? 'GET')
      calls.push({
        url: href,
        method,
        body: init?.body ? new URLSearchParams(String(init.body)) : null,
      })
      if (href.includes('setup_intents')) {
        return { ok: true, status: 200, json: async () => intentPayload }
      }
      if (/\/customers\/[^/]+$/.test(href)) {
        return { ok: true, status: 200, json: async () => customerPayload }
      }
      return { ok: true, status: 200, json: async () => ({ data: [] }) }
    }) as never
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    jest.restoreAllMocks()
    jest.dontMock('@aglyn/tenant-data-admin')
    jest.dontMock('@aglyn/aglyn/server')
  })

  it('makes a FIRST card the default, because Stripe does not', () => {
    // A customer whose only card is not the default has a subscription that
    // renews against nothing — surfacing weeks later as a failed payment
    // rather than now as a visible mistake.
    return finalize().then(async (response: Response) => {
      expect(response.status).toBe(200)
      const write = calls.find(
        (call) => call.method === 'POST' && /\/customers\//.test(call.url),
      )
      expect(write?.body?.get('invoice_settings[default_payment_method]')).toBe(
        'pm_new',
      )
    })
  })

  it('leaves an EXISTING default alone', async () => {
    // Adding a second card must not silently re-point the renewal at it.
    customerPayload = { invoice_settings: { default_payment_method: 'pm_old' } }
    await finalize()
    const write = calls.find(
      (call) => call.method === 'POST' && /\/customers\//.test(call.url),
    )
    expect(write).toBeUndefined()
  })

  it('refuses an intent belonging to a different customer', async () => {
    // The security boundary. The browser supplies this id.
    intentPayload = { ...intentPayload, customer: 'cus_someone_else' }
    const response = await finalize()
    expect(response.status).toBe(400)
    const write = calls.find(
      (call) => call.method === 'POST' && /\/customers\//.test(call.url),
    )
    expect(write).toBeUndefined()
  })

  it('refuses an intent that has not succeeded', async () => {
    intentPayload = { ...intentPayload, status: 'requires_payment_method' }
    const response = await finalize()
    expect(response.status).toBe(400)
  })

  it('keeps ids out of the refusal log', async () => {
    intentPayload = { ...intentPayload, customer: 'cus_someone_else' }
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    await finalize('seti_secret_id')
    const logged = JSON.stringify(errorSpy.mock.calls)
    expect(logged).not.toContain('seti_secret_id')
    expect(logged).not.toContain('cus_someone_else')
    // CONTROL for the redaction: the route DID log the refusal, so the
    // absences above are redaction and not silence.
    expect(logged).toContain('setup intent not usable')
  })

  it('CONTROL — the happy path really does reach Stripe and write', async () => {
    // Three cases above assert that no customer write happened. Each is
    // worthless if the wiring made writes impossible.
    await finalize()
    expect(calls.some((call) => call.url.includes('setup_intents'))).toBe(true)
    expect(
      calls.some(
        (call) => call.method === 'POST' && /\/customers\//.test(call.url),
      ),
    ).toBe(true)
  })
})
