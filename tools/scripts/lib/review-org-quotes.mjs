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
 * The store-review workspace's quotes and invoices (AGL-4093..4100): one of
 * each state a business meets, for the CRM's own people, so the bakery's
 * Quotes card, its Orders list and a contact's quotes are populated.
 *
 * A quote is an order document on the `quote` channel with a `quote`
 * section (`libs/plugins/commerce/src/lib/model/commerce-quotes.ts`); an
 * invoice a business composes is a draft order (`channel: 'draft'`,
 * `commerce-invoices.ts`). These are written in the shapes the console's own
 * routes write, with what the model's rules require:
 *
 * - an UNPAID quote carries no `createdAtMs`, no list fields and no
 *   top-level customer, which is what keeps it out of every order list
 *   (`isUnpaidQuote`); the plan's list-field pass skips it for that reason;
 * - a PAID quote is the same document turned into an order, as the webhook's
 *   `paidQuoteOrder` turns it: paid time as `createdAtMs`, the customer on
 *   top, `quote.paidAtMs`, and the list fields;
 * - totals are `computeQuoteTotals`' (the discount before tax, the store's
 *   rate on the taxable lines, nothing for an included line);
 * - nothing that would send or charge anything: no Stripe session, no pay
 *   link token (the console mints one when someone asks), no proof (a proof
 *   is a Storage object, which this seed never writes), message ids under
 *   `example.com`.
 *
 * Numbers are fixed (1057–1063), above the native store's #1041–1056 and the
 * docs bakery's #1039. The order counter is never touched: it meters nothing
 * here, but a seed does not write counters.
 */

import { createHash } from 'node:crypto'

const DAY_MS = 24 * 60 * 60 * 1000

/** A CRM person's fixture key, as `seed-native/people.mjs` mints it: sha256 of the normalized email. */
const personKey = (email) => createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex')

/** The bakery's store rate, as `seed-native/store.mjs` sets it. */
export const BAKERY_TAX = { kind: 'rate', pct: 8.25, label: 'TX sales tax' }

/** The catalog products the quotes price, by the ids the review plan gives them. */
const PRODUCTS = {
  cookies: { id: 'seed-review-p-cookies', name: 'Holiday Cookie Tin', sku: 'COOK-TIN', cents: 2800 },
  cinnamon: { id: 'seed-review-p-cinnamon', name: 'Cinnamon Roll Box (6)', sku: 'ROLL-06', cents: 2200 },
  beans: { id: 'seed-review-p-beans', name: 'House Blend Coffee Beans', sku: 'BEAN-12', cents: 1650 },
  cake: { id: 'seed-review-p-cake', name: 'Birthday Cake, 8 inch', sku: 'CAKE-08', cents: 4800 },
  concentrate: { id: 'seed-review-p-concentrate', name: 'Cold Brew Concentrate', sku: 'CB-32', cents: 1400 },
  sourdough: { id: 'seed-review-sourdough', name: 'Sourdough loaf', cents: 900 },
  croissant: { id: 'seed-review-croissant', name: 'Butter croissant', cents: 395 },
  muffin: { id: 'seed-review-muffin', name: 'Blueberry muffin', cents: 350 },
  houseBlend: { id: 'seed-review-crm-product-house-blend', name: 'House blend, 5 lb bag', cents: 4500 },
}

/** The catalog product ids the fixtures name, for the plan's reference check. */
export const QUOTE_PRODUCT_IDS = Object.values(PRODUCTS).map((product) => product.id)

/** A catalog line, priced from the product as `priceQuoteCatalogLine` prices one. */
function catalogLine(key, quantity, extra = {}) {
  const product = PRODUCTS[key]
  return {
    productId: product.id,
    name: product.name,
    ...(product.sku ? { sku: product.sku } : {}),
    productType: 'physical',
    quantity,
    unitAmountCents: extra.included ? 0 : product.cents,
    ...extra,
  }
}

/** A typed line, as `priceQuoteCustomLine` writes one. */
function customLine(name, quantity, unitAmountCents, { ships = true, included = false, description } = {}) {
  return {
    productId: '',
    custom: true,
    name,
    productType: ships ? 'physical' : 'service',
    quantity,
    unitAmountCents: included ? 0 : unitAmountCents,
    ...(included ? { included: true } : {}),
    ...(description ? { description } : {}),
  }
}

/** `computeQuoteTotals`, restated for a seed that cannot import the TypeScript model. */
export function quoteTotals({ lines, discount = null, shippingCents = 0, tax = BAKERY_TAX }) {
  const gross = lines.map((line) => (line.included ? 0 : line.unitAmountCents * line.quantity))
  const itemsCents = gross.reduce((sum, cents) => sum + cents, 0)
  const discountCents = !discount
    ? 0
    : discount.kind === 'amount'
      ? Math.min(itemsCents, discount.amountCents)
      : Math.min(itemsCents, Math.round((itemsCents * discount.pct) / 100))
  // The discount spreads over the charged lines by weight; every line here is
  // taxable, so the taxable amount is simply what is left.
  const taxableCents = itemsCents - discountCents
  const taxCents = tax.kind === 'rate' && taxableCents > 0 ? Math.round((taxableCents * tax.pct) / 100) : 0
  return {
    itemsCents,
    discountCents,
    shippingCents,
    taxCents,
    feeCents: 0,
    totalCents: itemsCents - discountCents + shippingCents + taxCents,
  }
}

/** The fee a card payment of `totalCents` leaves, as the native store fixture charges it. */
const cardFeeCents = (totalCents) => Math.round(totalCents * 0.029) + 30

/** A `Message-ID` under a reserved domain, deterministic per fixture. */
const messageId = (kind, key) => `<${kind}.${key}@mail.example.com>`

/**
 * The people the quotes are for: the CRM's own contacts. `fixtureEmail` is
 * the address `seed-native/people.mjs` keys the contact by, before the plan
 * moves it under example.com; `email` is the address the org holds.
 */
export const QUOTE_PEOPLE = {
  isabel: {
    fixtureEmail: 'isabel.moreno@cedaroak.example',
    name: 'Isabel Moreno',
    company: 'Cedar & Oak Catering',
    email: 'isabel.moreno@cedaroak.example.com',
    phone: '+1 555 0113',
  },
  amelia: {
    fixtureEmail: 'amelia.wright@cedaroak.example',
    name: 'Amelia Wright',
    company: 'Cedar & Oak Catering',
    email: 'amelia.wright@cedaroak.example.com',
    phone: '+1 555 0119',
  },
  daniel: {
    fixtureEmail: 'daniel.kim@harbormarket.example',
    name: 'Daniel Kim',
    company: 'Harbor Market Co-op',
    email: 'daniel.kim@harbormarket.example.com',
    phone: '+1 555 0110',
  },
  renee: {
    fixtureEmail: 'renee.fournier@fernhill.example',
    name: 'Renee Fournier',
    company: 'Fernhill Events',
    email: 'renee.fournier@fernhill.example.com',
  },
  marcus: {
    fixtureEmail: 'marcus.hale@larkspur.example',
    name: 'Marcus Hale',
    company: 'Larkspur Cafe',
    email: 'marcus.hale@larkspur.example.com',
    phone: '+1 555 0111',
  },
  naomi: {
    fixtureEmail: 'naomi.brooks@brightside.example',
    name: 'Naomi Brooks',
    company: 'Brightside Dental',
    email: 'naomi.brooks@brightside.example.com',
    phone: '+1 555 0115',
  },
}

/** Delivery addresses, all on reserved example streets. */
const ADDRESSES = {
  cedarOak: { name: 'Cedar & Oak Catering', line1: '1200 Cedar Ave', city: 'Austin', state: 'TX', postalCode: '78702', country: 'US' },
  harbor: { name: 'Harbor Market Co-op', line1: '48 Harbor St', city: 'Austin', state: 'TX', postalCode: '78704', country: 'US' },
  fernhill: { name: 'Fernhill Events', line1: '9 Fernhill Rd', city: 'Austin', state: 'TX', postalCode: '78731', country: 'US' },
  larkspur: { name: 'Larkspur Cafe', line1: '310 Larkspur Ln', city: 'Austin', state: 'TX', postalCode: '78703', country: 'US' },
  brightside: { name: 'Brightside Dental', line1: '75 Brightside Blvd', city: 'Austin', state: 'TX', postalCode: '78705', country: 'US' },
}

/** The deal-sized catering quote, line for line: the Cedar & Oak deal's products. */
export function cedarOakHolidayLines() {
  return [
    catalogLine('cookies', 30, { description: 'One tin for each of the team, wrapped and tagged' }),
    catalogLine('cinnamon', 20),
    customLine('Holiday pastry platter (serves 25)', 6, 9500, {
      description: 'Croissants, muffins and morning buns; two platters for each location',
    }),
    customLine('Delivery and setup, three locations', 1, 30000, { ships: false }),
    catalogLine('beans', 3, { included: true, description: 'A bag of house beans for each location, on us' }),
  ]
}

/**
 * The Cedar & Oak deal's line items, matching the holiday quote: what the
 * deal's Products card lists and what its amount adds up to (215000, the
 * amount the deal already carries).
 */
export function cedarOakDealLineItems() {
  return cedarOakHolidayLines().map((line) => ({
    ...(line.productId ? { productId: line.productId } : {}),
    name: line.name,
    quantity: line.quantity,
    unitAmountCents: line.unitAmountCents,
    currency: 'usd',
  }))
}

/**
 * Every quote and invoice document, with the review plan's final paths.
 *
 * @param {{ hostId: string, nowMs: number, ownerUid: string, ownerName: string,
 *   contactId: (fixtureKey: string) => string | undefined }} input
 *   `contactId` maps a person's fixture key (`personKey`) to the contact's id in the org,
 *   so every quote names the CRM record it is for.
 * @returns {Array<{ path: string, data: Record<string, any> }>}
 */
export function quoteAndInvoiceFixtures({ hostId, nowMs, ownerUid, ownerName, contactId }) {
  const daysAgo = (days, hour = 10) => {
    const at = new Date(nowMs - days * DAY_MS)
    // The hour in Central time (UTC-6 in winter); a day or more back is always in the past.
    at.setUTCHours(hour + 6, 0, 0, 0)
    return at.getTime()
  }
  const by = ownerUid
  const orders = `hosts/${hostId}/orders`
  const docs = []
  const customerOf = (person) => {
    const id = contactId(personKey(person.fixtureEmail))
    return {
      ...(id ? { record: { kind: 'contact', id } } : {}),
      name: person.name,
      company: person.company,
      email: person.email,
      emailLower: person.email.toLowerCase(),
      ...(person.phone ? { phone: person.phone } : {}),
    }
  }
  const sendOf = ({ revision, person, subject, atMs, key, linkVersion }) => ({
    revision,
    to: person.email,
    subject,
    atMs,
    by,
    messageId: messageId('quote', key),
    providerId: null,
    linkVersion,
  })
  const event = (atMs, name, detail) => ({ atMs, event: name, detail })

  // ── #1060 · Cedar & Oak holiday catering · sent, revision 2 ───────────────
  // The deal's own quote. Revision 1 had 20 cookie tins; the customer asked
  // for one per person, and revision 2 went out with 30.
  function cedarOakHoliday() {
    const id = 'seed-review-quote-cedar-oak-holiday'
    const person = QUOTE_PEOPLE.isabel
    const lines = cedarOakHolidayLines()
    const firstLines = lines.map((line) => (line.productId === PRODUCTS.cookies.id ? { ...line, quantity: 20 } : line))
    const created = daysAgo(9, 9)
    const firstSent = daysAgo(9, 11)
    const asked = daysAgo(6, 15)
    const revised = daysAgo(2, 9)
    const secondSent = daysAgo(2, 10)
    const subject = `Your holiday catering quote from Juniper Street Bakery`
    const customer = customerOf(person)
    const notes =
      'Holiday breakfast for Cedar & Oak’s three locations, delivered and set up by 8 a.m. on Friday, December 11. Platters come on reusable boards we collect the next week.'
    const terms = 'Prices hold through December 31. Pay online to book your delivery date.'
    const firstTotals = quoteTotals({ lines: firstLines })
    docs.push({
      path: `${orders}/${id}`,
      data: {
        number: 1060,
        status: 'pending',
        channel: 'quote',
        lineItems: lines,
        totals: quoteTotals({ lines }),
        taxMode: 'manual',
        timeline: [
          event(created, 'quote', `Quote created by ${ownerName}`),
          event(firstSent, 'quote-sent', `Revision 1 emailed to ${person.email} by ${ownerName}`),
          event(asked, 'quote-changes-requested', 'The customer asked for changes to Quote #1060 revision 1'),
          event(revised, 'quote-revision-started', `Revision 2 started by ${ownerName}; revision 1 is kept with its proofs and answers`),
          event(secondSent, 'quote-link-replaced', 'Pay link replaced to send revision 2; the earlier email’s link no longer opens the quote'),
          event(secondSent, 'quote-sent', `Revision 2 emailed to ${person.email} by ${ownerName}`),
        ],
        quote: {
          stage: 'sent',
          revision: 2,
          customer,
          billTo: ADDRESSES.cedarOak,
          shipTo: ADDRESSES.cedarOak,
          notes,
          terms,
          discount: null,
          shipping: null,
          tax: BAKERY_TAX,
          requireProofApproval: false,
          proofs: [],
          responses: [],
          approval: null,
          approvedRevision: null,
          linkVersion: 2,
          sends: [
            sendOf({ revision: 1, person, subject, atMs: firstSent, key: 'cedar-oak-holiday-1', linkVersion: 1 }),
            sendOf({ revision: 2, person, subject, atMs: secondSent, key: 'cedar-oak-holiday-2', linkVersion: 2 }),
          ],
          emailThread: {
            messageId: messageId('quote', 'cedar-oak-holiday-2'),
            references: [messageId('quote', 'cedar-oak-holiday-1'), messageId('quote', 'cedar-oak-holiday-2')],
            subject,
          },
          createdAtMs: created,
          updatedAtMs: secondSent,
          createdBy: by,
          updatedBy: by,
        },
      },
    })
    docs.push({
      path: `${orders}/${id}/revisions/1`,
      data: {
        revision: 1,
        stage: 'changes_requested',
        lineItems: firstLines,
        totals: firstTotals,
        taxMode: 'manual',
        tax: BAKERY_TAX,
        discount: null,
        shipping: null,
        notes,
        terms,
        customer,
        billTo: ADDRESSES.cedarOak,
        shipTo: ADDRESSES.cedarOak,
        proofs: [],
        responses: [
          {
            action: 'changes',
            revision: 1,
            atMs: asked,
            comment: 'This looks great. Could we make it 30 cookie tins, one for each of our staff?',
            ip: null,
            userAgent: null,
          },
        ],
        approval: null,
        updatedAtMs: firstSent,
        closedAtMs: revised,
        closedBy: by,
      },
    })
  }

  // ── #1057 · Cedar & Oak fall open house · approved, paid, now an order ───
  function cedarOakOpenHouse() {
    const id = 'seed-review-quote-cedar-oak-open-house'
    const person = QUOTE_PEOPLE.amelia
    const lines = [
      catalogLine('cinnamon', 10),
      customLine('Pumpkin loaf, sliced (serves 12)', 8, 3200),
      catalogLine('cookies', 1, { included: true, description: 'A thank-you tin for the front desk' }),
    ]
    const stored = quoteTotals({ lines })
    const created = daysAgo(24, 9)
    const sent = daysAgo(24, 13)
    const approved = daysAgo(23, 10)
    const paid = daysAgo(23, 10)
    const receipt = daysAgo(23, 11)
    const subject = 'Your open house pastries quote from Juniper Street Bakery'
    const customer = customerOf(person)
    const totals = { ...stored, feeCents: cardFeeCents(stored.totalCents) }
    docs.push({
      path: `${orders}/${id}`,
      data: {
        number: 1057,
        status: 'paid',
        channel: 'quote',
        lineItems: lines,
        totals,
        taxMode: 'manual',
        customerEmail: person.email,
        customerName: person.name,
        customerPhone: person.phone,
        ...(customer.record ? { customerRecord: customer.record } : {}),
        shippingAddress: ADDRESSES.cedarOak,
        billingAddress: ADDRESSES.cedarOak,
        paymentIntentId: 'pi_demo_1057',
        checkoutSessionId: 'cs_demo_1057',
        livemode: true,
        requiresShipping: true,
        createdAtMs: paid,
        updatedAtMs: receipt,
        timeline: [
          event(created, 'quote', `Quote created by ${ownerName}`),
          event(sent, 'quote-sent', `Revision 1 emailed to ${person.email} by ${ownerName}`),
          event(approved, 'quote-approved', `Quote #1057 revision 1 approved by the customer as ${person.name}`),
          event(paid, 'paid', 'Order #1057 paid through its pay link'),
          event(receipt, 'invoice-sent', `Invoice emailed to the customer by ${ownerName}`),
        ],
        invoiceSends: [
          {
            to: person.email,
            subject,
            atMs: receipt,
            by,
            messageId: messageId('invoice', 'cedar-oak-open-house'),
            providerId: null,
            paid: true,
            linkVersion: null,
            totalCents: totals.totalCents,
          },
        ],
        quote: {
          stage: 'approved',
          revision: 1,
          customer,
          billTo: ADDRESSES.cedarOak,
          shipTo: ADDRESSES.cedarOak,
          notes: 'Pastries for the Cedar & Oak open house, delivered to the front office by 9 a.m.',
          terms: 'Pay online to confirm the order.',
          discount: null,
          shipping: null,
          tax: BAKERY_TAX,
          requireProofApproval: false,
          proofs: [],
          responses: [{ action: 'approve', revision: 1, atMs: approved, name: person.name, ip: null, userAgent: null }],
          approval: { revision: 1, name: person.name, atMs: approved, ip: null, userAgent: null },
          approvedRevision: 1,
          linkVersion: 1,
          sends: [sendOf({ revision: 1, person, subject, atMs: sent, key: 'cedar-oak-open-house-1', linkVersion: 1 })],
          emailThread: {
            messageId: messageId('invoice', 'cedar-oak-open-house'),
            references: [messageId('quote', 'cedar-oak-open-house-1'), messageId('invoice', 'cedar-oak-open-house')],
            subject,
          },
          paidAtMs: paid,
          createdAtMs: created,
          updatedAtMs: approved,
          createdBy: by,
          updatedBy: by,
        },
      },
    })
  }

  // ── #1058 · Harbor Market weekly bread · changes requested ───────────────
  function harborMarket() {
    const id = 'seed-review-quote-harbor-market'
    const person = QUOTE_PEOPLE.daniel
    const lines = [
      catalogLine('sourdough', 120, { description: 'Thirty loaves a week, delivered Monday to Thursday' }),
      catalogLine('croissant', 160),
      catalogLine('muffin', 80),
    ]
    const discount = { kind: 'percent', pct: 10, label: 'Wholesale' }
    const created = daysAgo(5, 9)
    const sent = daysAgo(5, 10)
    const asked = daysAgo(1, 16)
    const subject = 'Your wholesale bread quote from Juniper Street Bakery'
    docs.push({
      path: `${orders}/${id}`,
      data: {
        number: 1058,
        status: 'pending',
        channel: 'quote',
        lineItems: lines,
        totals: quoteTotals({ lines, discount }),
        taxMode: 'manual',
        timeline: [
          event(created, 'quote', `Quote created by ${ownerName}`),
          event(sent, 'quote-sent', `Revision 1 emailed to ${person.email} by ${ownerName}`),
          event(asked, 'quote-changes-requested', 'The customer asked for changes to Quote #1058 revision 1'),
        ],
        quote: {
          stage: 'changes_requested',
          revision: 1,
          customer: customerOf(person),
          billTo: ADDRESSES.harbor,
          shipTo: ADDRESSES.harbor,
          notes: 'The first month of Harbor Market’s standing bread order, at the wholesale price.',
          terms: 'Wholesale pricing for orders of 25 loaves or more a week.',
          discount,
          shipping: null,
          tax: BAKERY_TAX,
          requireProofApproval: false,
          proofs: [],
          responses: [
            {
              action: 'changes',
              revision: 1,
              atMs: asked,
              comment: 'Could we move sourdough to Monday, Wednesday and Friday, and add ten cinnamon roll boxes on Fridays?',
              ip: null,
              userAgent: null,
            },
          ],
          approval: null,
          approvedRevision: null,
          linkVersion: 1,
          sends: [sendOf({ revision: 1, person, subject, atMs: sent, key: 'harbor-market-1', linkVersion: 1 })],
          emailThread: { messageId: messageId('quote', 'harbor-market-1'), references: [messageId('quote', 'harbor-market-1')], subject },
          createdAtMs: created,
          updatedAtMs: sent,
          createdBy: by,
          updatedBy: by,
        },
      },
    })
  }

  // ── #1059 · Fernhill wedding dessert table · approved, not yet paid ──────
  function fernhillWedding() {
    const id = 'seed-review-quote-fernhill-wedding'
    const person = QUOTE_PEOPLE.renee
    const lines = [
      customLine('Three-tier wedding cake (serves 120)', 1, 65000, { description: 'Vanilla bean and raspberry, buttercream finish' }),
      customLine('Dessert table, 120 guests', 1, 48000, { description: 'Mini tarts, macarons and cookies' }),
      customLine('Cake tasting for two', 1, 0, { ships: false, included: true }),
    ]
    const shipping = { amountCents: 7500, label: 'Delivery and setup' }
    const created = daysAgo(4, 9)
    const sent = daysAgo(4, 12)
    const approved = daysAgo(3, 18)
    const subject = 'Your wedding dessert quote from Juniper Street Bakery'
    docs.push({
      path: `${orders}/${id}`,
      data: {
        number: 1059,
        status: 'pending',
        channel: 'quote',
        lineItems: lines,
        totals: quoteTotals({ lines, shippingCents: shipping.amountCents }),
        taxMode: 'manual',
        timeline: [
          event(created, 'quote', `Quote created by ${ownerName}`),
          event(sent, 'quote-sent', `Revision 1 emailed to ${person.email} by ${ownerName}`),
          event(approved, 'quote-approved', `Quote #1059 revision 1 approved by the customer as ${person.name}`),
        ],
        quote: {
          stage: 'approved',
          revision: 1,
          customer: customerOf(person),
          billTo: ADDRESSES.fernhill,
          shipTo: ADDRESSES.fernhill,
          notes: 'For the Fernhill Events wedding on Saturday, May 15, delivered and set up by 3 p.m.',
          terms: 'Pay online to hold the date.',
          discount: null,
          shipping,
          tax: BAKERY_TAX,
          requireProofApproval: false,
          proofs: [],
          responses: [{ action: 'approve', revision: 1, atMs: approved, name: person.name, ip: null, userAgent: null }],
          approval: { revision: 1, name: person.name, atMs: approved, ip: null, userAgent: null },
          approvedRevision: 1,
          linkVersion: 1,
          sends: [sendOf({ revision: 1, person, subject, atMs: sent, key: 'fernhill-wedding-1', linkVersion: 1 })],
          emailThread: { messageId: messageId('quote', 'fernhill-wedding-1'), references: [messageId('quote', 'fernhill-wedding-1')], subject },
          createdAtMs: created,
          updatedAtMs: approved,
          createdBy: by,
          updatedBy: by,
        },
      },
    })
  }

  // ── #1061 · Larkspur Cafe wholesale coffee · draft, not sent ─────────────
  function larkspurCoffee() {
    const id = 'seed-review-quote-larkspur-coffee'
    const person = QUOTE_PEOPLE.marcus
    const lines = [catalogLine('houseBlend', 20), catalogLine('concentrate', 24)]
    const discount = { kind: 'amount', amountCents: 5000, label: 'First order' }
    const created = daysAgo(1, 8)
    docs.push({
      path: `${orders}/${id}`,
      data: {
        number: 1061,
        status: 'pending',
        channel: 'quote',
        lineItems: lines,
        totals: quoteTotals({ lines, discount }),
        taxMode: 'manual',
        timeline: [event(created, 'quote', `Quote created by ${ownerName}`)],
        quote: {
          stage: 'draft',
          revision: 1,
          customer: customerOf(person),
          billTo: ADDRESSES.larkspur,
          shipTo: ADDRESSES.larkspur,
          notes: 'A month of house blend and cold brew for Larkspur Cafe.',
          terms: '',
          discount,
          shipping: null,
          tax: BAKERY_TAX,
          requireProofApproval: false,
          proofs: [],
          responses: [],
          approval: null,
          approvedRevision: null,
          createdAtMs: created,
          updatedAtMs: created,
          createdBy: by,
          updatedBy: by,
        },
      },
    })
  }

  // ── #1062 · Cedar & Oak tasting box · invoice sent, unpaid ───────────────
  function cedarOakTastingInvoice() {
    const id = 'seed-review-invoice-cedar-oak-tasting'
    const person = QUOTE_PEOPLE.isabel
    const lines = [catalogLine('cookies', 1), catalogLine('cinnamon', 2), catalogLine('cake', 1)]
    const totals = quoteTotals({ lines })
    const created = daysAgo(8, 14)
    const sent = daysAgo(8, 15)
    docs.push({
      path: `${orders}/${id}`,
      data: {
        number: 1062,
        status: 'pending',
        channel: 'draft',
        lineItems: lines,
        totals,
        taxMode: 'manual',
        customerEmail: person.email,
        draftShipping: { countries: [], options: [] },
        payLink: { version: 1 },
        requiresShipping: true,
        timeline: [
          event(created, 'draft', `Draft created by ${ownerName}`),
          event(sent, 'invoice-sent', `Invoice emailed to the customer by ${ownerName}`),
        ],
        invoiceSends: [
          {
            to: person.email,
            subject: 'Invoice #1062 from Juniper Street Bakery',
            atMs: sent,
            by,
            messageId: messageId('invoice', 'cedar-oak-tasting'),
            providerId: null,
            paid: false,
            linkVersion: 1,
            totalCents: totals.totalCents,
          },
        ],
        createdAtMs: created,
        updatedAtMs: sent,
      },
    })
  }

  // ── #1063 · Brightside Dental office breakfast · invoice paid ────────────
  function brightsideInvoice() {
    const id = 'seed-review-invoice-brightside'
    const person = QUOTE_PEOPLE.naomi
    const lines = [
      catalogLine('croissant', 40),
      catalogLine('muffin', 40),
      catalogLine('concentrate', 4),
      customLine('Office delivery', 1, 2500, { ships: false }),
    ]
    const stored = quoteTotals({ lines })
    const totals = { ...stored, feeCents: cardFeeCents(stored.totalCents) }
    const created = daysAgo(13, 9)
    const sent = daysAgo(13, 10)
    const paid = daysAgo(12, 8)
    const receipt = daysAgo(12, 9)
    const subject = 'Invoice #1063 from Juniper Street Bakery'
    docs.push({
      path: `${orders}/${id}`,
      data: {
        number: 1063,
        status: 'paid',
        channel: 'draft',
        lineItems: lines,
        totals,
        taxMode: 'manual',
        customerEmail: person.email,
        customerName: person.name,
        customerPhone: person.phone,
        shippingAddress: ADDRESSES.brightside,
        draftShipping: { countries: [], options: [] },
        payLink: { version: 1 },
        paymentIntentId: 'pi_demo_1063',
        checkoutSessionId: 'cs_demo_1063',
        livemode: true,
        requiresShipping: true,
        timeline: [
          event(created, 'draft', `Draft created by ${ownerName}`),
          event(sent, 'invoice-sent', `Invoice emailed to the customer by ${ownerName}`),
          event(paid, 'paid', 'Order #1063 paid through its pay link'),
          event(receipt, 'invoice-sent', `Invoice emailed to the customer by ${ownerName}`),
        ],
        invoiceSends: [
          {
            to: person.email,
            subject,
            atMs: sent,
            by,
            messageId: messageId('invoice', 'brightside-1'),
            providerId: null,
            paid: false,
            linkVersion: 1,
            totalCents: totals.totalCents,
          },
          {
            to: person.email,
            subject,
            atMs: receipt,
            by,
            messageId: messageId('invoice', 'brightside-2'),
            providerId: null,
            paid: true,
            linkVersion: null,
            totalCents: totals.totalCents,
          },
        ],
        // A draft keeps the time it was made; the paid event says when it was paid.
        createdAtMs: created,
        updatedAtMs: receipt,
      },
    })
  }

  cedarOakHoliday()
  cedarOakOpenHouse()
  harborMarket()
  fernhillWedding()
  larkspurCoffee()
  cedarOakTastingInvoice()
  brightsideInvoice()
  return docs
}

