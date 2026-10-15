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

// The store-review workspace's plan (AGL-3812) and the docs bakery builders
// it shares with `tools/e2e/seed-docs-fixtures.mjs`.
//
//   node --test tools/scripts/lib/review-org-seed.test.mjs

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  aiMemoryFixtures,
  apiKeyFixtures,
  chargebackOrder,
  trafficDays,
} from './docs-fixture-builders.mjs'
import {
  ABOUT_SCREEN_ID,
  BRAND_BLOG_ID,
  BRAND_HOME_SCREEN_ID,
  CONTACT_SCREEN_ID,
  JUNIPER,
  REVIEW_ID_PREFIX,
  REVIEW_SEED_SOURCE,
  SHOP_SCREEN_ID,
  assertPlanSafe,
  buildReviewOrgPlan,
  classifyRecord,
  emailsIn,
  fakeRef,
  neverDue,
  publicImageUrl,
  recordCrmFixtures,
  recordNativeAreas,
  reserveDomains,
} from './review-org-seed.mjs'

const NOW = Date.UTC(2026, 9, 14, 15, 0, 0)
const TARGET = {
  orgId: '9A5fJ_zEoH',
  hostId: 'review-bakery',
  orgSlug: 'agl-app-demo',
  ownerUid: 'owner-uid-1',
  ownerName: 'Review Owner',
}
const HOST_IDS = [TARGET.hostId, ...JUNIPER.siblings.map((site) => site.hostId)]
const SCOPE = { orgId: TARGET.orgId, hostIds: HOST_IDS, ownerUid: TARGET.ownerUid }

const records = [
  ...(await recordNativeAreas((file) => import(`../seed-native/${file}.mjs`), NOW)),
  ...(await recordCrmFixtures(NOW)),
]
const plan = buildReviewOrgPlan({ records, target: TARGET, nowMs: NOW, siblings: true })
const byPath = new Map(plan.docs.map((doc) => [doc.path, doc.data]))
const ids = (prefix) =>
  new Set(plan.docs.filter((doc) => doc.path.startsWith(prefix)).map((doc) => doc.path.split('/').pop()))

describe('reserveDomains', () => {
  it('moves every address a reader could own under example.com', () => {
    assert.equal(reserveDomains('maya@littlefoxcafe.com'), 'maya@littlefoxcafe.example.com')
    assert.equal(reserveDomains('priya.raman@gmail.com'), 'priya.raman@mail.example.com')
    assert.equal(reserveDomains('linus@example.test'), 'linus@example.com')
    assert.equal(reserveDomains('hello@demo-site.example.test'), 'hello@demo-site.example.com')
    assert.equal(reserveDomains('grace@northwind.example'), 'grace@northwind.example.com')
    assert.equal(reserveDomains('hello@mobile-demo.test'), 'hello@mobile-demo.example.com')
    assert.equal(reserveDomains('https://contoso.example/shop'), 'https://contoso.example.com/shop')
  })

  it('leaves example.com, example.org and ordinary prose alone', () => {
    for (const text of ['ada@example.com', 'a@b.example.org', 'https://hooks.example.com/x', 'Order #1041 — $31.20']) {
      assert.equal(reserveDomains(text), text)
    }
  })
})

describe('emailsIn', () => {
  it('reads addresses but not search-token prefixes of one', () => {
    assert.deepEqual(emailsIn({ email: 'a@b.example.com', searchTokens: ['a@b.ex'], nested: [{ to: 'c@d.com' }] }), [
      'a@b.example.com',
      'c@d.com',
    ])
  })
})

describe('publicImageUrl', () => {
  it('turns a screenshot run’s local photo into a public one', () => {
    assert.equal(publicImageUrl('http://127.0.0.1:8765/cake.jpg'), 'https://picsum.photos/id/1080/800/800')
    assert.equal(publicImageUrl('http://127.0.0.1:8765/other.jpg'), 'https://picsum.photos/seed/juniper-other/800/800')
    assert.equal(publicImageUrl('https://picsum.photos/seed/x/800/800'), 'https://picsum.photos/seed/x/800/800')
  })
})

describe('fakeRef', () => {
  it('walks up the parents the list-field helpers read', () => {
    const ref = fakeRef('orgs/o1/contacts/c1')
    assert.equal(ref.id, 'c1')
    assert.equal(ref.parent.id, 'contacts')
    assert.equal(ref.parent.parent.parent.id, 'orgs')
    assert.equal(ref.collection('notes').doc('n1').path, 'orgs/o1/contacts/c1/notes/n1')
  })
})

describe('classifyRecord', () => {
  const verdict = (path, data = {}, source = 'people') => classifyRecord({ path, data, source })

  it('leaves out authorization, billing and identity documents', () => {
    assert.equal(verdict('orgs/o/members/u').keep, false)
    assert.equal(verdict('orgs/o/invites/i').keep, false)
    assert.equal(verdict('orgs/o/counters/workflowRuns').keep, false)
    assert.equal(verdict('orgs/o', { subscription: {} }).keep, false)
    assert.equal(verdict('users/u', { firstName: 'A' }).keep, false)
    assert.equal(verdict('users/u/notifications/n', { type: 'billing.invoice' }).keep, false)
    assert.equal(verdict('hosts/h/members/m', {}, 'account').keep, false)
  })

  it('leaves out what renders blank or broken on a live site', () => {
    assert.equal(verdict('hosts/h/media/m').keep, false)
    assert.equal(verdict('hosts/h/layouts/l').keep, false)
    assert.equal(verdict('hosts/h/emailTemplates/order-receipt').keep, false)
    assert.equal(verdict('hosts/h/screens/page-home', {}, 'content').keep, false)
  })

  it('keeps only the host fields that change nothing the site serves', () => {
    const kept = verdict(
      'hosts/h',
      {
        business: { address: '12 Main St' },
        screens: { home: '/' },
        analytics: { gaMeasurementId: 'G-1' },
        seo: { title: 'T', favicon: 'https://x', verification: { google: 't' } },
      },
      'content',
    )
    assert.deepEqual(kept, { keep: true, data: { business: { address: '12 Main St' }, seo: { title: 'T' } } })
  })
})

describe('buildReviewOrgPlan', () => {
  it('passes its own safety check', () => {
    assert.doesNotThrow(() => assertPlanSafe(plan.docs, SCOPE))
  })

  it('is deterministic for one clock', () => {
    const again = buildReviewOrgPlan({ records, target: TARGET, nowMs: NOW, siblings: true })
    assert.deepEqual(again.docs, plan.docs)
  })

  it('mints every new document under a seed-review id, marked as this seed’s', () => {
    for (const { path, data } of plan.docs) {
      const id = path.split('/').pop()
      if (id.startsWith(REVIEW_ID_PREFIX)) assert.equal(data.seedSource, REVIEW_SEED_SOURCE, path)
    }
    assert.ok(byPath.has(`orgs/${TARGET.orgId}/deals/${REVIEW_ID_PREFIX}deal-northwind`))
    assert.ok(byPath.has(`hosts/${TARGET.hostId}/products/${REVIEW_ID_PREFIX}p-mug`))
  })

  it('writes nothing outside the review org and nothing billing-shaped', () => {
    for (const { path } of plan.docs) {
      assert.match(
        path,
        /^(orgs\/9A5fJ_zEoH|hosts\/review-(bakery|juniper-cafe|juniper-catering)|users\/owner-uid-1|(apiKeys|publishOutbox)\/seed-review-)/,
      )
      assert.ok(!['members', 'invites', 'counters', 'billing', 'usage'].includes(path.split('/')[2]), path)
    }
    const org = byPath.get(`orgs/${TARGET.orgId}`)
    assert.deepEqual(Object.keys(org).sort(), ['name', 'nameLower', 'nameReversed', 'nameTokens'])
  })

  it('re-points every reference at a document the plan or the brand pack holds', () => {
    const contacts = ids(`orgs/${TARGET.orgId}/contacts/`)
    const companies = ids(`orgs/${TARGET.orgId}/companies/`)
    const deals = ids(`orgs/${TARGET.orgId}/deals/`)
    const pipelines = ids(`orgs/${TARGET.orgId}/pipelines/`)
    const products = ids(`hosts/${TARGET.hostId}/products/`)
    const forms = ids(`hosts/${TARGET.hostId}/forms/`)
    const services = ids(`hosts/${TARGET.hostId}/services/`)
    const check = (value, set, where) => {
      if (typeof value === 'string' && value) assert.ok(set.has(value), `${where} → ${value}`)
    }
    for (const { path, data } of plan.docs) {
      check(data.contactId, contacts, path)
      check(data.companyId, companies, path)
      check(data.dealId, deals, path)
      check(data.pipelineId, pipelines, path)
      check(data.formId, forms, path)
      check(data.serviceId, services, path)
      for (const line of data.lineItems ?? []) check(line.productId, products, path)
    }
    // The e2e CRM's Sales deals join the native pipeline rather than a second default one.
    assert.equal(pipelines.size, 2)
    const defaults = plan.docs.filter((doc) => doc.path.includes('/pipelines/') && doc.data.isDefault === true)
    assert.equal(defaults.length, 1)
  })

  it('writes the native blog into the brand pack’s blog', () => {
    const entries = plan.docs.filter((doc) => doc.path.startsWith(`hosts/${TARGET.hostId}/collections/`))
    assert.ok(entries.length > 1)
    for (const entry of entries) assert.ok(entry.path.startsWith(`hosts/${TARGET.hostId}/collections/${BRAND_BLOG_ID}`))
  })

  it('names only the owner and only reserved addresses', () => {
    for (const { path, data } of plan.docs) {
      for (const field of ['ownerUid', 'assigneeUid', 'byUid', 'createdByUid', 'createdBy']) {
        if (typeof data[field] === 'string') assert.equal(data[field], TARGET.ownerUid, `${path}.${field}`)
      }
      for (const email of emailsIn(data)) assert.match(email, /@([a-z0-9-]+\.)*example\.(com|org)$/i, path)
    }
  })

  it('disarms every cron that could message someone', () => {
    for (const { path, data } of plan.docs) {
      const collection = path.split('/').slice(-2)[0]
      if (collection === 'bookings') assert.ok(data.reminderSentAt, path)
      if (collection === 'crmTasks') assert.equal(typeof data.reminderSentAtMs, 'number', path)
      if (collection === 'webhooks') {
        assert.equal(data.enabled, false, path)
        assert.equal(data.secret, undefined, path)
      }
      if (collection === 'campaigns' && data.status === 'scheduled') {
        assert.ok(data.sendAtMs > NOW + 50 * 365 * 24 * 60 * 60 * 1000, path)
      }
    }
    assert.equal(new Date(neverDue(NOW)).getUTCFullYear(), 2101)
  })

  it('stamps the list fields each console list queries', () => {
    const contact = byPath.get(`orgs/${TARGET.orgId}/contacts/${REVIEW_ID_PREFIX}crm-contact-maya`)
    assert.ok(contact.searchTokens.includes('littlefox') && contact.searchTokens.includes('com'))
    assert.ok(contact.scopedSearchTokens.includes(`host:${TARGET.hostId}~maya`))
    assert.ok(contact.facetKeys.some((key) => key.startsWith(`${TARGET.hostId}:`)))
    const order = byPath.get(`hosts/${TARGET.hostId}/orders/${REVIEW_ID_PREFIX}o-1041`)
    assert.ok(order.searchTokens.includes('1041'))
    assert.deepEqual(order.productIds, [`${REVIEW_ID_PREFIX}p-mug`])
    const product = byPath.get(`hosts/${TARGET.hostId}/products/${REVIEW_ID_PREFIX}p-mug`)
    assert.equal(product.deletedAt, null)
    assert.ok(product.nameTokens.includes('mug'))
    const submission = byPath.get(`hosts/${TARGET.hostId}/formSubmissions/${REVIEW_ID_PREFIX}sub-priya`)
    assert.ok(submission.senderTokens.includes('priya'))
    const records = plan.docs.filter((doc) => doc.path.includes('/datasets/') && doc.path.includes('/records/'))
    assert.ok(records.length > 0)
    for (const record of records) assert.ok(Array.isArray(record.data.filterKeys), record.path)
  })

  it('patches an existing document without recomputing its list fields', () => {
    assert.deepEqual(Object.keys(byPath.get(`hosts/${TARGET.hostId}/products/seed-prod-1`)).sort(), ['imageUrl', 'mediaUrls'])
  })

  it('publishes the About and Contact pages, the contact form bound to the inbox form', () => {
    const host = byPath.get(`hosts/${TARGET.hostId}`)
    assert.deepEqual(host.screens, { [ABOUT_SCREEN_ID]: 'about', [CONTACT_SCREEN_ID]: 'contact', [SHOP_SCREEN_ID]: 'order' })
    assert.equal(host.displayName, JUNIPER.siteName)
    const version = byPath.get(`hosts/${TARGET.hostId}/screens/${CONTACT_SCREEN_ID}/versions/${CONTACT_SCREEN_ID}-v1`)
    assert.equal(version.nodes.contactForm.props.formId, `${REVIEW_ID_PREFIX}contact`)
    assert.ok(version.nodes['_@_'].nodes.includes('contactWrap'))
    const shop = byPath.get(`hosts/${TARGET.hostId}/screens/${SHOP_SCREEN_ID}/versions/${SHOP_SCREEN_ID}-v1`)
    assert.equal(shop.nodes.shopGrid.componentId, 'product-grid')
    assert.ok(byPath.get(`hosts/${TARGET.hostId}/settings/store`).pdpScreenId)
    const home = plan.docs.filter((doc) => doc.path.includes('/screenAnalytics/'))
    assert.ok(home.every((doc) => [BRAND_HOME_SCREEN_ID, ABOUT_SCREEN_ID].includes(doc.data.screenId)))
  })
})

describe('assertPlanSafe', () => {
  const doc = (path, data) => [{ path, data }]
  it('refuses a teammate, an address, a plan field, an armed booking and a stray path', () => {
    assert.throws(() => assertPlanSafe(doc('orgs/9A5fJ_zEoH/members/x', {}), SCOPE), /members/)
    assert.throws(() => assertPlanSafe(doc('hosts/review-bakery/forms/seed-review-f', { to: 'a@gmail.com' }), SCOPE), /address/)
    assert.throws(() => assertPlanSafe(doc('orgs/9A5fJ_zEoH', { plan: 'pro' }), SCOPE), /plan/)
    assert.throws(() => assertPlanSafe(doc('hosts/review-bakery/bookings/seed-review-b', {}), SCOPE), /booking/)
    assert.throws(() => assertPlanSafe(doc('hosts/another/products/seed-review-p', {}), SCOPE), /outside/)
    assert.throws(() => assertPlanSafe(doc('hosts/review-bakery/products/p-1', {}), SCOPE), /seed- id/)
    assert.throws(
      () => assertPlanSafe(doc('orgs/9A5fJ_zEoH/deals/seed-review-d', { ownerUid: 'someone-else' }), SCOPE),
      /ownerUid/,
    )
  })
})

describe('docs fixture builders', () => {
  it('draws sixty distinct days of traffic, newest first', () => {
    const days = trafficDays(NOW)
    assert.equal(days.length, 60)
    assert.equal(new Set(days.map((day) => day.id)).size, 60)
    assert.equal(days[0].id, '2026-10-14')
    assert.ok(days[0].data.utm && !days[59].data.utm)
  })

  it('lists two live API keys and one revoked, under the caller’s ids', () => {
    const keys = apiKeyFixtures({ orgId: 'o', createdBy: 'u', nowMs: NOW, idFor: (keyId) => `seed-${keyId}` })
    assert.deepEqual(
      keys.map((key) => [key.id, Boolean(key.data.revokedAt)]),
      [
        ['seed-key_docsZapierA', false],
        ['seed-key_docsFormsB', false],
        ['seed-key_docsRevokedC', true],
      ],
    )
    assert.equal(apiKeyFixtures({ orgId: 'o', createdBy: 'u', nowMs: NOW })[0].id, 'd0c5'.repeat(16))
  })

  it('builds a lost chargeback that refunds the whole order', () => {
    const order = chargebackOrder({ number: 7, nowMs: NOW, productId: 'p', productName: 'Loaf' })
    assert.equal(order.totals.totalCents, 6200)
    assert.equal(order.refundedCents, 6200)
    assert.equal(order.dispute.outcome, 'lost')
  })

  it('names AI memory rows through the caller', () => {
    assert.deepEqual(
      aiMemoryFixtures({ nowMs: NOW, idFor: (id) => `x-${id}` }).map((row) => row.id),
      ['x-copy-short', 'x-removes-testimonials', 'x-no-emoji'],
    )
  })
})
