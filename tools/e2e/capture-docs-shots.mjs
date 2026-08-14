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

// Captures the screenshots for the apps/docs GUIDES section (AGL-554)
// into apps/docs/static/img/guides/ — the walkthroughs' images stay
// reproducible instead of hand-made.
//
// Unlike tools/e2e/capture-docs-screenshots.mjs (static console pages),
// this script (1) seeds guide-specific fixtures on top of seed-e2e.mjs
// (a typed survey dataset, a designed+published survey screen, storefront
// products/orders/subscriptions, a site member), then (2) WALKS the four
// guide flows — including a real survey submission and a real member
// sign-up on the tenant site — capturing labeled PNGs along the way.
//
// Prerequisites — the standard emulator stack (docs/E2E_LOCAL.md):
//   1. cd cloud && npx -y firebase-tools@13 emulators:start \
//        --config firebase.e2e.json --project aglyn-main --only auth,firestore
//   2. npm run seed:e2e
//   3. npm run serve:console:emulated     # console on :4200
//   4. npm run serve:tenant:emulated      # tenant on :4500 (resolves host
//                                         # `demo` natively on that port)
//   5. FIRESTORE_EMULATOR_HOST=localhost:8082 \
//      FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
//        node tools/e2e/capture-docs-shots.mjs [--only=a,b,…]
//
// `--only=` matches shot filenames and the two walk names, `survey-walk`
// and `member-signup-walk`.
//
// Same conventions as the sibling capture script: 1440×900 viewport,
// sign-in through the real /signin UI, emulator banner + dev overlay
// stripped, `--only=` filter, per-shot failure reporting (exit 1 if any
// shot failed, captured files are still kept).

import { scryptSync, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import {
  assertNoStaffOnlyChrome,
  installStaffOnlyChromeStyles,
  preflightStaffOnlyChrome,
} from './lib/staff-only-chrome.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const IMG_ROOT = join(repoRoot, 'apps/docs/static/img/guides')

const CONSOLE_BASE = process.env.E2E_BASE_URL ?? 'http://localhost:4200'
const TENANT_BASE = process.env.E2E_TENANT_URL ?? 'http://localhost:4500'
const HOST_ID = process.env.E2E_HOST ?? 'demo'
// The console routes by ORG SLUG since AGL-621 (`/[orgSlug]/…`), which is not
// the host subdomain. Kept in sync with E2E_ORG_SLUG in seed-e2e.mjs.
const ORG_SLUG = process.env.E2E_ORG_SLUG ?? 'e2e-bakery'
// Host-scoped pages live UNDER the org (AGL-796): `/[orgSlug]/hosts/[host]/…`.
// Every console shot here used to address `/demo/…` — the bare host subdomain,
// which is what those routes looked like before AGL-621 and is now a 404 that
// the harness happily photographed. Same shape as the sibling
// capture-docs-screenshots.mjs.
const HOST_BASE = `${ORG_SLUG}/hosts/${HOST_ID}`
const EMAIL = process.env.E2E_EMAIL ?? 'e2e@aglyn.test'
const PASSWORD = process.env.E2E_PASSWORD ?? 'E2e-Password-1'
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 60_000)

// `--only=` takes a comma-separated list of substrings, matched against a
// shot's output filename and against the two walk names below — so the
// end-to-end walks can be re-run on their own instead of only ever as part
// of a full 28-image capture.
const only = process.argv
  .find((arg) => arg.startsWith('--only='))
  ?.slice('--only='.length)
  .split(',')
  .map((part) => part.trim())
  .filter(Boolean)
const selected = (name) => !only?.length || only.some((part) => name.includes(part))
const skipSeed = process.argv.includes('--no-seed')

// ── 1. Seed the guide fixtures ─────────────────────────────────────────────
// Reuses the seed-e2e.mjs patterns: deterministic `seed-guide-…` ids,
// merge-set writes (idempotent), and THE INVARIANT — every doc carries
// the fields the console pages orderBy/where on.

async function seedGuideFixtures() {
  if (
    !process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.FIREBASE_AUTH_EMULATOR_HOST
  ) {
    console.error(
      'Refusing to seed: FIRESTORE_EMULATOR_HOST and ' +
        'FIREBASE_AUTH_EMULATOR_HOST must both point at local emulators ' +
        '(pass --no-seed to capture against already-seeded data).',
    )
    process.exit(1)
  }
  const { getApps, initializeApp } = await import('firebase-admin/app')
  const { FieldValue, getFirestore, Timestamp } = await import(
    'firebase-admin/firestore'
  )
  if (!getApps().length) {
    initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'aglyn-main' })
  }
  const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)
  const orgId = 'e2e-owner' // Org doc id = owner uid (seed-e2e.mjs).
  const orgRef = firestore.collection('orgs').doc(orgId)
  const hostRef = firestore.collection('hosts').doc(HOST_ID)
  const now = FieldValue.serverTimestamp()
  let written = 0
  const put = async (ref, data) => {
    await ref.set({ ...data, updatedAt: now }, { merge: true })
    written += 1
  }

  // Survey dataset with a TYPED model (guide 1 + 2). `displayName` is what
  // the Form element's "Write to dataset" matches; field ids are the
  // stable record keys.
  const survey = orgRef.collection('datasets').doc('seed-guide-survey')
  await put(survey, {
    name: 'Survey responses',
    displayName: 'Survey responses',
    singularName: 'Survey response',
    fields: ['satisfaction', 'visit', 'topics', 'comments'],
    model: {
      fields: {
        satisfaction: { name: 'Satisfaction', type: 'int32' },
        visit: { name: 'Visit', type: 'text' },
        topics: { name: 'Topics', type: 'text' },
        comments: { name: 'Comments', type: 'text' },
      },
      order: ['satisfaction', 'visit', 'topics', 'comments'],
    },
    createdAt: now,
  })
  // Converge on re-runs: drop records left by previous walk-throughs so
  // the "records after submit" shot always shows exactly one live
  // submission on top of the two seeded rows.
  const staleRecords = await survey.collection('records').get()
  for (const record of staleRecords.docs) {
    if (!record.id.startsWith('seed-guide-')) await record.ref.delete()
  }
  const surveyRows = [
    [5, 'Weekly', 'Products', 'Great pastries, friendly staff.'],
    [4, 'First time', 'Products, Pricing', 'Found you through the market.'],
  ]
  for (const [index, [satisfaction, visit, topics, comments]] of surveyRows.entries()) {
    await put(survey.collection('records').doc(`seed-guide-${index}`), {
      values: { satisfaction, visit, topics, comments },
      order: index,
      createdAt: now,
    })
  }

  // Designed screens. Node-tree invariants (seed-e2e.mjs): canvas root id
  // is `_@_` with componentId 'root'; non-mui elements carry pluginId.
  const putScreen = async (screenId, screen, nodes) => {
    const screenRef = hostRef.collection('screens').doc(screenId)
    const versionId = `${screenId}-v1`
    await put(screenRef, { ...screen, versionId, createdAt: now })
    await put(screenRef.collection('versions').doc(versionId), {
      screenId,
      nodes,
      createdAt: now,
    })
    if (screen.slug) {
      // Publishing = the slug registered in the host's routing map.
      await put(hostRef, { screens: { [screenId]: screen.slug } })
    }
  }

  // Guide 1: the survey screen — a Form writing to the dataset, with the
  // AGL-544 field types (rating / radio / checkbox / multiline).
  await putScreen(
    'seed-guide-survey-screen',
    { displayName: 'Survey', slug: 'survey' },
    {
      '_@_': { $id: '_@_', componentId: 'root', nodes: ['wrap'] },
      wrap: {
        $id: 'wrap',
        componentId: 'muiContainer',
        parentId: '_@_',
        nodes: ['stack'],
        props: { maxWidth: 'sm' },
      },
      stack: {
        $id: 'stack',
        componentId: 'muiStack',
        parentId: 'wrap',
        nodes: ['title', 'form'],
        props: { spacing: 3 },
        sx: { py: 8 },
      },
      title: {
        $id: 'title',
        componentId: 'muiTypography',
        parentId: 'stack',
        props: { children: 'Tell us how we did', variant: 'h4' },
      },
      form: {
        $id: 'form',
        componentId: 'form',
        pluginId: 'mui',
        parentId: 'stack',
        nodes: ['f1', 'f2', 'f3', 'f4'],
        props: {
          formName: 'Visitor survey',
          datasetName: 'Survey responses',
          submitLabel: 'Send my feedback',
          successMessage: 'Thanks — your feedback helps us improve!',
        },
      },
      f1: {
        $id: 'f1',
        componentId: 'formField',
        pluginId: 'mui',
        parentId: 'form',
        props: {
          fieldName: 'satisfaction',
          label: 'How satisfied are you?',
          fieldType: 'rating',
        },
      },
      f2: {
        $id: 'f2',
        componentId: 'formField',
        pluginId: 'mui',
        parentId: 'form',
        props: {
          fieldName: 'visit',
          label: 'How often do you visit?',
          fieldType: 'radio',
          options: 'First time, Monthly, Weekly',
        },
      },
      f3: {
        $id: 'f3',
        componentId: 'formField',
        pluginId: 'mui',
        parentId: 'form',
        props: {
          fieldName: 'topics',
          label: 'What should we improve?',
          fieldType: 'checkbox',
          options: 'Products, Support, Pricing',
        },
      },
      f4: {
        $id: 'f4',
        componentId: 'formField',
        pluginId: 'mui',
        parentId: 'form',
        props: {
          fieldName: 'comments',
          label: 'Anything else?',
          fieldType: 'textarea',
        },
      },
    },
  )

  // Guide 2: a screen with a repeatable stack bound to the dataset.
  await putScreen(
    'seed-guide-results',
    { displayName: 'Survey results' },
    {
      '_@_': { $id: '_@_', componentId: 'root', nodes: ['wrap'] },
      wrap: {
        $id: 'wrap',
        componentId: 'muiContainer',
        parentId: '_@_',
        nodes: ['stack'],
        props: { maxWidth: 'md' },
      },
      stack: {
        $id: 'stack',
        componentId: 'muiStack',
        parentId: 'wrap',
        nodes: ['quote', 'meta'],
        props: { spacing: 1, repeatDataset: 'seed-guide-survey' },
        sx: { py: 6 },
      },
      quote: {
        $id: 'quote',
        componentId: 'muiTypography',
        parentId: 'stack',
        props: { children: '“{{item.comments}}”', variant: 'h6' },
      },
      meta: {
        $id: 'meta',
        componentId: 'muiTypography',
        parentId: 'stack',
        props: {
          children: '{{item.satisfaction}} stars · visits {{item.visit}}',
          variant: 'body2',
        },
      },
    },
  )

  // Guide 3: storefront screens — grid + inline cart, and the PDP template.
  await putScreen(
    'seed-guide-shop',
    { displayName: 'Shop', slug: 'shop' },
    {
      '_@_': { $id: '_@_', componentId: 'root', nodes: ['wrap'] },
      wrap: {
        $id: 'wrap',
        componentId: 'muiContainer',
        parentId: '_@_',
        nodes: ['stack'],
        props: { maxWidth: 'lg' },
      },
      stack: {
        $id: 'stack',
        componentId: 'muiStack',
        parentId: 'wrap',
        nodes: ['title', 'grid', 'cart'],
        props: { spacing: 4 },
        sx: { py: 6 },
      },
      title: {
        $id: 'title',
        componentId: 'muiTypography',
        parentId: 'stack',
        props: { children: 'Shop the bakery', variant: 'h4' },
      },
      grid: {
        $id: 'grid',
        componentId: 'product-grid',
        pluginId: 'commerce',
        parentId: 'stack',
        props: { columns: 3, showFilters: true },
      },
      cart: {
        $id: 'cart',
        componentId: 'cart',
        pluginId: 'commerce',
        parentId: 'stack',
        props: { variant: 'inline' },
      },
    },
  )
  await putScreen(
    'seed-guide-pdp',
    { displayName: 'Product page' },
    {
      '_@_': { $id: '_@_', componentId: 'root', nodes: ['wrap'] },
      wrap: {
        $id: 'wrap',
        componentId: 'muiContainer',
        parentId: '_@_',
        nodes: ['detail'],
        props: { maxWidth: 'md' },
      },
      detail: {
        $id: 'detail',
        componentId: 'product-detail',
        pluginId: 'commerce',
        parentId: 'wrap',
        props: {},
        sx: { py: 6 },
      },
    },
  )
  // Template wiring (AGL-295): /products/{slug} renders the PDP screen.
  await put(hostRef.collection('settings').doc('store'), {
    pdpScreenId: 'seed-guide-pdp',
  })

  // Guide 4: the account screen with the customer-account block.
  await putScreen(
    'seed-guide-account',
    { displayName: 'Account', slug: 'account' },
    {
      '_@_': { $id: '_@_', componentId: 'root', nodes: ['wrap'] },
      wrap: {
        $id: 'wrap',
        componentId: 'muiContainer',
        parentId: '_@_',
        nodes: ['account'],
        props: { maxWidth: 'sm' },
      },
      account: {
        $id: 'account',
        componentId: 'customer-account',
        pluginId: 'commerce',
        parentId: 'wrap',
        props: { signedOutHeading: 'Your account' },
        sx: { py: 6 },
      },
    },
  )

  // Products across the three billing modes (AGL-545). Variants carry the
  // canonical prices; the flat priceUsd/inventory/imageUrl legacy fields
  // stay denormalized like the product editor writes them.
  const products = [
    {
      id: 'seed-guide-candle',
      doc: {
        name: 'Hand-poured candle',
        slug: 'hand-poured-candle',
        description: 'Beeswax, 40-hour burn, bakery-scented.',
        type: 'physical',
        status: 'active',
        tags: ['home'],
        variants: [
          { id: 'default', priceUsd: 24, compareAtPriceUsd: 32, inventory: 12 },
        ],
        mediaUrls: ['https://picsum.photos/seed/candle/600/600'],
        priceUsd: 24,
        inventory: 12,
        imageUrl: 'https://picsum.photos/seed/candle/600/600',
      },
    },
    {
      id: 'seed-guide-course',
      doc: {
        name: 'Sourdough course',
        slug: 'sourdough-course',
        description: 'Monthly video lessons and recipe drops.',
        type: 'digital',
        status: 'active',
        variants: [{ id: 'default', priceUsd: 12, inventory: null }],
        subscription: { interval: 'month', trialDays: 14 },
        digitalFiles: [
          {
            url: 'https://picsum.photos/seed/course/600/400',
            fileName: 'starter-guide.pdf',
          },
        ],
        mediaUrls: ['https://picsum.photos/seed/course/600/400'],
        priceUsd: 12,
        imageUrl: 'https://picsum.photos/seed/course/600/400',
      },
    },
    {
      id: 'seed-guide-coffee-club',
      doc: {
        name: 'Coffee club',
        slug: 'coffee-club',
        description: 'A fresh bag every month — or just one, your call.',
        type: 'physical',
        status: 'active',
        variants: [{ id: 'default', priceUsd: 18, inventory: null }],
        subscription: { interval: 'month' },
        subscriptionOptional: true,
        mediaUrls: ['https://picsum.photos/seed/coffeeclub/600/600'],
        priceUsd: 18,
        imageUrl: 'https://picsum.photos/seed/coffeeclub/600/600',
      },
    },
  ]
  for (const { id, doc } of products) {
    await put(hostRef.collection('products').doc(id), {
      ...doc,
      createdAtMs: Date.now(),
    })
  }

  // A site member (AGL-546) with real orders + a subscription, so the
  // Users page and the member drawer have content. The scrypt hash is a
  // REAL hash — the member can sign in with the password below.
  const memberEmail = 'maya@example.com'
  const salt = randomBytes(16).toString('hex')
  const memberPassword = 'Maya-Demo-Pass-1'
  await put(hostRef.collection('siteMembers').doc('seed-guide-member'), {
    email: memberEmail,
    displayName: 'Maya Member',
    passwordScrypt: `${salt}:${scryptSync(memberPassword, salt, 64).toString('hex')}`,
    createdAt: Timestamp.now(),
  })

  const dayMs = 86_400_000
  const orders = [
    {
      id: 'seed-guide-order-1001',
      doc: {
        number: 1001,
        status: 'paid',
        channel: 'online',
        customerEmail: memberEmail,
        customerName: 'Maya Member',
        lineItems: [
          {
            productId: 'seed-guide-candle',
            variantId: 'default',
            name: 'Hand-poured candle',
            quantity: 2,
            unitAmountCents: 2400,
          },
        ],
        totals: {
          itemsCents: 4800,
          shippingCents: 500,
          taxCents: 0,
          discountCents: 0,
          feeCents: 96,
          totalCents: 5300,
        },
        paymentIntentId: 'pi_seed_demo_1001',
        timeline: [
          { atMs: Date.now() - dayMs, event: 'paid', detail: 'Payment received' },
        ],
        createdAtMs: Date.now() - dayMs,
      },
    },
    {
      id: 'seed-guide-order-1002',
      doc: {
        number: 1002,
        status: 'fulfilled',
        channel: 'online',
        customerEmail: memberEmail,
        customerName: 'Maya Member',
        lineItems: [
          {
            productId: 'seed-guide-candle',
            variantId: 'default',
            name: 'Hand-poured candle',
            quantity: 1,
            unitAmountCents: 2400,
            fulfillmentId: 'f1',
          },
        ],
        totals: {
          itemsCents: 2400,
          shippingCents: 500,
          taxCents: 0,
          discountCents: 0,
          feeCents: 48,
          totalCents: 2900,
        },
        fulfillments: [
          {
            id: 'f1',
            lineItemIds: [0],
            carrier: 'UPS',
            trackingNumber: '1Z999AA10123456784',
            atMs: Date.now() - 2 * dayMs,
          },
        ],
        paymentIntentId: 'pi_seed_demo_1002',
        timeline: [
          { atMs: Date.now() - 3 * dayMs, event: 'paid', detail: 'Payment received' },
          { atMs: Date.now() - 2 * dayMs, event: 'fulfilled', detail: 'Shipped via UPS' },
        ],
        createdAtMs: Date.now() - 3 * dayMs,
      },
    },
  ]
  for (const { id, doc } of orders) {
    await put(hostRef.collection('orders').doc(id), doc)
  }

  await put(hostRef.collection('subscriptions').doc('seed-guide-sub-1'), {
    productId: 'seed-guide-course',
    customerEmail: memberEmail,
    customerName: 'Maya Member',
    status: 'active',
    currentPeriodEndMs: Date.now() + 30 * dayMs,
    createdAtMs: Date.now() - 5 * dayMs,
  })

  // Mega-menu walkthrough fixture (AGL-580): a nav-bar screen with a
  // composed Mega Menu, so the besigner shots show the walkthrough's
  // exact state without automating the insert flow. Columns mirror the
  // element's starter preset.
  const navColumn = (prefix, title, links) => ({
    [prefix]: {
      $id: prefix,
      componentId: 'muiStack',
      parentId: 'mmrow',
      nodes: [`${prefix}t`, ...links.map((_, index) => `${prefix}l${index}`)],
      props: { spacing: 0.5, sx: { minWidth: 180, alignItems: 'flex-start' } },
    },
    [`${prefix}t`]: {
      $id: `${prefix}t`,
      componentId: 'muiTypography',
      parentId: prefix,
      props: { variant: 'overline', color: 'text.secondary', children: title },
    },
    ...Object.fromEntries(
      links.map((label, index) => [
        `${prefix}l${index}`,
        {
          $id: `${prefix}l${index}`,
          componentId: 'muiScreenLink',
          parentId: prefix,
          props: { children: label, color: 'inherit' },
        },
      ]),
    ),
  })
  const navCols = {
    ...navColumn('nc1', 'Coffee', ['Shop beans', 'Brew guides']),
    ...navColumn('nc2', 'Learn', ['Blog', 'About us']),
    ...navColumn('nc3', 'Get in touch', ['Contact', 'Visit us']),
  }
  // Converge on re-runs: the dropdown-panel shot inserts through the real
  // add-element flow, which persists two host actions each run — drop the
  // strays so the fixture stays clean (staleRecords pattern above).
  const staleActions = await hostRef.collection('actions').get()
  for (const action of staleActions.docs) {
    if (!action.id.startsWith('seed-')) await action.ref.delete()
  }

  await putScreen(
    'seed-guide-nav',
    { displayName: 'Nav bar' },
    {
      '_@_': { $id: '_@_', componentId: 'root', nodes: ['bar'] },
      bar: {
        $id: 'bar',
        componentId: 'muiStack',
        parentId: '_@_',
        nodes: ['brand', 'mm'],
        props: {
          direction: 'row',
          spacing: 2,
          sx: { alignItems: 'center', px: 3, py: 1.5, bgcolor: 'background.paper' },
        },
      },
      brand: {
        $id: 'brand',
        componentId: 'muiTypography',
        parentId: 'bar',
        props: { children: 'Northwind Coffee', variant: 'h6', sx: { mr: 'auto' } },
      },
      mm: {
        $id: 'mm',
        componentId: 'muiMegaMenu',
        parentId: 'bar',
        nodes: ['mmrow'],
        props: { label: 'Explore', panelWidth: 'wide' },
      },
      mmrow: {
        $id: 'mmrow',
        componentId: 'muiStack',
        parentId: 'mm',
        nodes: ['nc1', 'nc2', 'nc3'],
        props: { direction: 'row', spacing: 4, sx: { flexWrap: 'wrap' } },
      },
      ...navCols,
    },
  )

  // ── Marketplace fixtures (AGL-782) ──────────────────────────────────────
  // The org marketplace shots need a publisher identity plus listings that
  // actually appear in Browse — an empty grid documents nothing. Two artifact
  // types so the screenshot shows the org-level IA carrying more than
  // components: a reusable component and a dataset schema (AGL-657).
  await put(firestore.collection('publisherProfiles').doc(orgId), {
    handle: 'northwind',
    displayName: 'Northwind Coffee',
    bio: 'Sample publisher for the Aglyn marketplace guides.',
  })
  await put(orgRef, {
    // The Publish tab needs the selling entitlement to render its form.
    'entitlements.features.marketplaceSelling': true,
  })

  // The reusable component the footer listing is published FROM. Also what
  // the Publish tab's source picker lists — without it that shot documents an
  // empty state.
  await put(hostRef.collection('components').doc('seed-guide-footer'), {
    name: 'Site footer',
    displayName: 'Site footer',
    rootId: '_@_',
    nodes: {
      '_@_': { $id: '_@_', componentId: 'div', parentId: null, nodes: ['t'] },
      t: {
        $id: 't',
        componentId: 'muiTypography',
        parentId: '_@_',
        props: { children: '© Northwind Coffee' },
      },
    },
    createdAt: now,
  })

  const listing = async (id, data, version) => {
    const ref = firestore.collection('marketplaceListings').doc(id)
    await put(ref, {
      profileId: orgId,
      priceUsd: 0,
      latestVersion: 1,
      installCount: data.installCount ?? 0,
      deletedAt: null,
      createdAt: now,
      ...data,
    })
    await put(ref.collection('versions').doc('1'), version)
  }

  await listing(
    'seed-listing-footer',
    {
      artifactType: 'component',
      displayName: 'Site footer',
      description:
        'A reusable footer with navigation links and social icons.',
      category: 'design',
      sourceComponentId: 'seed-guide-footer',
      installCount: 12,
    },
    {
      rootId: '_@_',
      nodes: {
        '_@_': { $id: '_@_', componentId: 'div', parentId: null, nodes: ['t'] },
        t: {
          $id: 't',
          componentId: 'muiTypography',
          parentId: '_@_',
          props: { children: '© Northwind Coffee' },
        },
      },
      publishedAt: now,
    },
  )
  await listing(
    'seed-listing-survey-schema',
    {
      artifactType: 'datasetSchema',
      displayName: 'Customer survey schema',
      description:
        'Field model for a customer satisfaction survey. Structure only, no records.',
      category: 'forms',
      sourceDatasetId: 'seed-guide-survey',
      fieldCount: 4,
      installCount: 5,
    },
    {
      datasetSchema: {
        fields: {
          satisfaction: { name: 'Satisfaction', type: 'text' },
          visit: { name: 'Visit', type: 'text' },
          topics: { name: 'Topics', type: 'text' },
          comments: { name: 'Comments', type: 'text' },
        },
        order: ['satisfaction', 'visit', 'topics', 'comments'],
      },
      publishedAt: now,
    },
  )

  console.log(`seeded ${written} guide fixture docs`)
}

if (!skipSeed) await seedGuideFixtures()

// ── 2. Browser setup (same conventions as capture-docs-screenshots.mjs) ────

function chromeExecutable() {
  if (process.env.E2E_CHROME_PATH) {
    return { executablePath: process.env.E2E_CHROME_PATH }
  }
  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
    for (const executablePath of candidates) {
      try {
        readFileSync(executablePath)
        return { executablePath }
      } catch {
        // Not installed — try the next flavor.
      }
    }
  }
  return { channel: 'chrome' }
}

const browser = await chromium.launch({ headless: true, ...chromeExecutable() })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
})
// Without this, only the explicit waits below honoured E2E_TIMEOUT_MS and
// every fill/click sat on Playwright's 30s default — which is what a
// mis-targeted selector burned before the walk gave up.
context.setDefaultTimeout(TIMEOUT_MS)
context.setDefaultNavigationTimeout(TIMEOUT_MS)

// The AGL-663 pre-permission prompt arms itself 2.5s after mount, on every
// console page, and re-arms on every remount — so dismissing it per shot
// with a click (as this script used to) only covered the shots someone
// remembered to annotate. Write the dismissal the component persists for
// itself instead, before any app code runs, so the dialog never mounts.
// Key and value mirror apps/console/components/notification-prompt.
await context.addInitScript(() => {
  try {
    window.localStorage.setItem('aglyn:notification-prompt-dismissed', 'never')
  } catch {
    // Storage blocked — the prompt may appear; the shot is still taken.
  }
})

// The capture account is STAFF (see the account shape in
// apps/docs/CONTRIBUTING.md), so its console keeps release-flagged-OFF tabs,
// badged with a ⚑ no customer ever sees. Hide them from the first paint and
// refuse any shot that still shows one (AGL-1600).
await installStaffOnlyChromeStyles(context)

// Sign in to the console through the real UI once (a synthetic
// localStorage session races connectAuthEmulator — see console.e2e.mjs).
{
  const page = await context.newPage()
  await page.goto(`${CONSOLE_BASE}/signin`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[type="email"], input[name="email"]', EMAIL)
  await page.fill('input[type="password"], input[name="password"]', PASSWORD)
  await page.click('button[type="submit"], button:has-text("Next")')
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'), {
    timeout: TIMEOUT_MS,
  })
  await page.close()
}

// Prove the guard still sees what it hides, before shooting anything: a
// guard that matches nothing reports exactly what a clean page does.
{
  // Warmed first — a cold compile of this route is a minute of navigation
  // timeout that reads as the guard failing.
  await fetch(`${CONSOLE_BASE}/${HOST_BASE}`).catch(() => undefined)
  const page = await context.newPage()
  const hidden = await preflightStaffOnlyChrome(page, {
    url: `${CONSOLE_BASE}/${HOST_BASE}`,
    waitFor: 'Demo Bakery',
    timeout: TIMEOUT_MS,
  }).catch((error) => error)
  await page.close()
  if (hidden instanceof Error) {
    console.error(String(hidden.message))
    await browser.close()
    process.exit(1)
  }
  console.log(`GUARD staff-only chrome hidden: ${hidden.join(', ')}`)
}

const stripDevChrome = (page) =>
  page.evaluate(() => {
    for (const selector of [
      '.firebase-emulator-warning',
      'nextjs-portal',
      '#__next-build-watcher',
      '[data-nextjs-toast]',
    ]) {
      document.querySelectorAll(selector).forEach((el) => el.remove())
    }
  })

let failures = 0

/**
 * Navigate, wait, run actions, screenshot. Actions: { click | clickXY |
 * fill: [selector, value] | check | scroll | waitFor | settleMs;
 * optional: true } — optional actions log a warning instead of failing
 * the shot (used for selection niceties like highlighting a node).
 */
async function shot({ out, base, path, waitFor, actions = [], settleMs, clip }) {
  if (!selected(out)) return
  const page = await context.newPage()
  try {
    await page.goto(`${base}${path}`, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT_MS,
    })
    if (waitFor) {
      await page.waitForSelector(`text=${waitFor}`, { timeout: TIMEOUT_MS })
    }
    await stripDevChrome(page)
    for (const action of actions) {
      try {
        if (action.scroll) {
          await page.locator(action.scroll).first().scrollIntoViewIfNeeded()
        }
        if (action.clickXY) {
          await page.mouse.click(action.clickXY[0], action.clickXY[1])
        }
        if (action.click) await page.locator(action.click).first().click()
        if (action.fill) await page.fill(action.fill[0], action.fill[1])
        if (action.check) await page.locator(action.check).first().check()
        if (action.waitFor) {
          await page.waitForSelector(`text=${action.waitFor}`, {
            timeout: TIMEOUT_MS,
          })
        }
        await page.waitForTimeout(action.settleMs ?? 800)
      } catch (error) {
        if (!action.optional) throw error
        console.warn(
          `  optional action skipped on ${out}: ${String(error?.message ?? error).split('\n')[0]}`,
        )
      }
    }
    await page.waitForTimeout(settleMs ?? 1500)
    await stripDevChrome(page)
    // Last gate before the shutter: nothing only staff can see (AGL-1600).
    // A no-op on the tenant shots, which have no console chrome at all.
    await assertNoStaffOnlyChrome(page, out)
    const outPath = join(IMG_ROOT, out)
    mkdirSync(dirname(outPath), { recursive: true })
    await page.screenshot({ path: outPath, ...(clip ? { clip } : {}) })
    console.log(`SHOT  ${out}`)
  } catch (error) {
    failures += 1
    console.error(
      `FAIL  ${out}: ${String(error?.message ?? error).split('\n')[0]}`,
    )
  } finally {
    await page.close()
  }
}

// Pre-warm the dev-server routes so compiles don't eat navigation waits.
for (const path of [
  `/${HOST_BASE}/data`,
  `/${HOST_BASE}/products`,
  `/${HOST_BASE}/users`,
  `/${HOST_BASE}/screens/seed-guide-survey-screen/versions/seed-guide-survey-screen-v1/besigner`,
  `/${HOST_BASE}/screens/seed-guide-nav/versions/seed-guide-nav-v1/besigner`,
]) {
  await fetch(`${CONSOLE_BASE}${path}`).catch(() => undefined)
}
for (const path of ['/signup', '/signin', '/survey', '/shop', '/products/coffee-club']) {
  await fetch(`${TENANT_BASE}${path}`).catch(() => undefined)
}

// Selects the survey dataset in the Data page's Dataset dropdown.
const pickSurveyDataset = [
  { click: 'role=combobox[name="Dataset"]', optional: true },
  { click: 'role=option[name="Survey responses"]', optional: true, settleMs: 1200 },
]

// ── 3. Guide 1+2 — console: dataset, schema, import, besigner ──────────────

await shot({
  out: 'survey-data-page.png',
  base: CONSOLE_BASE,
  path: `/${HOST_BASE}/data`,
  waitFor: 'Add dataset',
  actions: [...pickSurveyDataset, { waitFor: 'Great pastries' }],
})
await shot({
  out: 'survey-schema-dialog.png',
  base: CONSOLE_BASE,
  path: `/${HOST_BASE}/data`,
  waitFor: 'Add dataset',
  actions: [
    ...pickSurveyDataset,
    { click: 'role=button[name="Schema"]', waitFor: 'Save schema' },
  ],
})
await shot({
  out: 'datasets-schema-field-editor.png',
  base: CONSOLE_BASE,
  path: `/${HOST_BASE}/data`,
  waitFor: 'Add dataset',
  actions: [
    ...pickSurveyDataset,
    { click: 'role=button[name="Schema"]', waitFor: 'Save schema' },
    { click: 'role=button[name="Edit"]', waitFor: 'Display name' },
  ],
})
await shot({
  out: 'datasets-import-dialog.png',
  base: CONSOLE_BASE,
  path: `/${HOST_BASE}/data`,
  waitFor: 'Add dataset',
  actions: [
    ...pickSurveyDataset,
    { click: 'role=button[name="Import"]', waitFor: 'Match on field' },
  ],
})

const surveyBesigner = `/${HOST_BASE}/screens/seed-guide-survey-screen/versions/seed-guide-survey-screen-v1/besigner`
await shot({
  out: 'survey-besigner-form.png',
  base: CONSOLE_BASE,
  path: surveyBesigner,
  waitFor: 'Properties',
  settleMs: 8000,
  actions: [
    // Select the Form in the hierarchy so its props (Write to dataset…)
    // show in the inspector. Canvas clicks can't reach the closed shadow
    // root, so go through the tree panel, expanding a level at a time.
    { click: 'text=Document', optional: true, settleMs: 1000 },
    { click: 'text=Container', optional: true, settleMs: 1000 },
    { click: 'text=Stack', optional: true, settleMs: 1000 },
    { click: 'text=Form', optional: true, settleMs: 1500 },
    // The Write to dataset / Form name props live on the Attributes tab.
    {
      click: 'role=tab[name="Attributes"]',
      optional: true,
      waitFor: 'Write to dataset',
    },
  ],
})
await shot({
  out: 'survey-element-picker-forms.png',
  base: CONSOLE_BASE,
  path: surveyBesigner,
  waitFor: 'Properties',
  settleMs: 6000,
  actions: [
    { click: 'role=tab[name="Elements"]', settleMs: 1500 },
    // Groups start expanded — scroll the Forms group into view (a click
    // would collapse it).
    { scroll: 'text=Forms', optional: true, settleMs: 1200 },
  ],
  clip: { x: 0, y: 88, width: 290, height: 780 },
})
await shot({
  out: 'datasets-repeat-binding.png',
  base: CONSOLE_BASE,
  path: `/${HOST_BASE}/screens/seed-guide-results/versions/seed-guide-results-v1/besigner`,
  waitFor: 'Properties',
  settleMs: 8000,
  actions: [
    { click: 'text=Document', optional: true, settleMs: 1000 },
    { click: 'text=Container', optional: true, settleMs: 1000 },
    { click: 'text=Stack', optional: true, settleMs: 1500 },
    // The repeat notice + Repeat over dataset props are on Attributes.
    {
      click: 'role=tab[name="Attributes"]',
      optional: true,
      waitFor: 'Repeats over dataset',
    },
  ],
})

// ── 3b. Mega-menu walkthrough — besigner nav shots (AGL-580) ───────────────

const navBesigner = `/${HOST_BASE}/screens/seed-guide-nav/versions/seed-guide-nav-v1/besigner`

// The element picker's Navigation group — Mega Menu + the Dropdown Panel
// preset (AGL-589) both in frame.
await shot({
  out: 'mega-menu-elements-navigation.png',
  base: CONSOLE_BASE,
  path: navBesigner,
  waitFor: 'Properties',
  settleMs: 6000,
  actions: [
    { click: 'role=tab[name="Elements"]', settleMs: 1500 },
    // Deep enough that the menu rows (Dropdown Menu / Dropdown Panel /
    // Mega Menu / Drawer) sit inside the clip.
    { scroll: 'text=Dropdown Panel', optional: true, settleMs: 1200 },
  ],
  clip: { x: 0, y: 88, width: 290, height: 780 },
})

// The Mega Menu selected on canvas — its panel expands in place with the
// three link columns (canvas clicks can't reach the closed shadow root,
// so selection goes through the hierarchy tree).
await shot({
  out: 'mega-menu-canvas-panel.png',
  base: CONSOLE_BASE,
  path: navBesigner,
  waitFor: 'Properties',
  settleMs: 8000,
  actions: [
    { click: 'text=Document', optional: true, settleMs: 1000 },
    { click: 'text=Stack', optional: true, settleMs: 1000 },
    { click: 'text=Mega Menu', optional: true, settleMs: 2000 },
  ],
})

// The hover interaction configured in the builder dialog: When hovered →
// Open a menu (the walkthrough's step 3).
await shot({
  out: 'mega-menu-interaction-dialog.png',
  base: CONSOLE_BASE,
  path: navBesigner,
  waitFor: 'Properties',
  settleMs: 8000,
  actions: [
    { click: 'text=Document', optional: true, settleMs: 1000 },
    { click: 'text=Stack', optional: true, settleMs: 1000 },
    { click: 'text=Mega Menu', optional: true, settleMs: 1500 },
    {
      click: 'role=tab[name="Attributes"]',
      optional: true,
      waitFor: 'Interactions',
    },
    { click: 'role=combobox[name="Add interaction"]', settleMs: 1000 },
    { click: 'role=option[name="When hovered…"]', settleMs: 1500 },
    { click: 'role=combobox[name="Action"]', optional: true, settleMs: 800 },
    { click: 'role=option[name="Open a menu"]', optional: true, settleMs: 1200 },
  ],
})

// The Dropdown Panel preset (AGL-589) inserted through the real add-element
// flow — the snackbar + Interactions list prove the pre-wired hover
// choreography persisted. This shot exercises the feature end to end.
await shot({
  out: 'mega-menu-dropdown-panel-interactions.png',
  base: CONSOLE_BASE,
  path: navBesigner,
  waitFor: 'Properties',
  settleMs: 8000,
  actions: [
    { click: 'text=Document', optional: true, settleMs: 1000 },
    { click: 'text=Stack', optional: true, settleMs: 1000 },
    { click: 'text=Add Element', settleMs: 1500 },
    // Two-step picker: select the card, then confirm the footer.
    { click: 'text=Dropdown Panel', settleMs: 1000 },
    { click: 'text=CONFIRM', settleMs: 2500 },
    { waitFor: 'interactions wired and enabled', optional: true },
    {
      click: 'role=tab[name="Attributes"]',
      optional: true,
      waitFor: 'Interactions',
    },
    { scroll: 'text=Dropdown panel — open on hover', optional: true, settleMs: 1000 },
  ],
})

// ── 4. Guide 3 — console: products, editor, orders ─────────────────────────

await shot({
  out: 'commerce-products-hub.png',
  base: CONSOLE_BASE,
  path: `/${HOST_BASE}/products`,
  waitFor: 'Hand-poured candle',
  settleMs: 2500,
})
await shot({
  out: 'commerce-product-editor-billing.png',
  base: CONSOLE_BASE,
  path: `/${HOST_BASE}/products`,
  waitFor: 'Coffee club',
  actions: [
    {
      click: 'tr:has-text("Coffee club") button:has-text("Edit")',
      waitFor: 'Save product',
      settleMs: 1200,
    },
    // Open the Billing select so all four modes are visible in the shot.
    { click: 'role=combobox[name="Billing"]', optional: true, waitFor: 'Both — buyer chooses' },
  ],
})
await shot({
  out: 'commerce-element-picker.png',
  base: CONSOLE_BASE,
  path: `/${HOST_BASE}/screens/seed-guide-shop/versions/seed-guide-shop-v1/besigner`,
  waitFor: 'Properties',
  settleMs: 6000,
  actions: [
    { click: 'role=tab[name="Elements"]', settleMs: 1500 },
    { scroll: 'text=Commerce', optional: true, settleMs: 1200 },
  ],
  clip: { x: 0, y: 88, width: 290, height: 780 },
})
await shot({
  out: 'commerce-orders-tab.png',
  base: CONSOLE_BASE,
  path: `/${HOST_BASE}/products?tab=orders`,
  waitFor: '1001',
  settleMs: 2500,
})
await shot({
  out: 'commerce-order-detail.png',
  base: CONSOLE_BASE,
  path: `/${HOST_BASE}/products?tab=orders`,
  waitFor: '1001',
  actions: [{ click: 'text=1001', waitFor: 'Timeline', settleMs: 1500 }],
})

// ── 5. Guide 4 — console: users + member drawer; account besigner ──────────

await shot({
  out: 'members-users-tab.png',
  base: CONSOLE_BASE,
  path: `/${HOST_BASE}/users`,
  waitFor: 'maya@example.com',
  settleMs: 2000,
})
await shot({
  out: 'members-member-drawer.png',
  base: CONSOLE_BASE,
  path: `/${HOST_BASE}/users`,
  waitFor: 'maya@example.com',
  actions: [
    { click: 'text=maya@example.com', waitFor: 'Lifetime purchases', settleMs: 2000 },
  ],
})
await shot({
  out: 'members-account-screen.png',
  base: TENANT_BASE,
  path: '/account',
  waitFor: 'Your account',
  settleMs: 2500,
})

// ── 5b. Org marketplace (AGL-782) ─────────────────────────────────────────

// Replaces marketplace-page.png, which still showed the per-site Marketplace tab
// that AGL-775 deleted — and whose alt text had since been rewritten to
// describe tabs the picture didn't contain.

await shot({
  out: 'marketplace-browse.png',
  base: CONSOLE_BASE,
  path: `/${ORG_SLUG}/marketplace?tab=browse`,
  waitFor: 'Marketplace',
  // The grid is populated by Firestore subscriptions that settle after first
  // paint; wait for a seeded listing rather than the frame, or the shot
  // catches the empty state.
  actions: [{ waitFor: 'Site footer', settleMs: 1200 }],
})
await shot({
  out: 'marketplace-publish.png',
  base: CONSOLE_BASE,
  path: `/${ORG_SLUG}/marketplace?tab=publish`,
  waitFor: 'Publish to the marketplace',
  actions: [{ settleMs: 800 }],
})

// ── 6. Tenant flows: auth pages, storefront, live survey ───────────────────

await shot({
  out: 'members-signup.png',
  base: TENANT_BASE,
  path: '/signup',
  waitFor: 'Create your account',
})
await shot({
  out: 'members-signin.png',
  base: TENANT_BASE,
  path: '/signin',
  waitFor: 'Welcome back',
})
await shot({
  out: 'commerce-storefront-grid.png',
  base: TENANT_BASE,
  path: '/shop',
  waitFor: 'Hand-poured candle',
  settleMs: 3000,
})
await shot({
  out: 'commerce-product-detail.png',
  base: TENANT_BASE,
  path: '/products/coffee-club',
  waitFor: 'Add to cart',
  settleMs: 3000,
})
await shot({
  out: 'survey-live-form.png',
  base: TENANT_BASE,
  path: '/survey',
  waitFor: 'How satisfied are you?',
  settleMs: 2000,
})

// Walk the survey for real: fill it in and submit, so the records shot
// below shows a genuine end-to-end submission.
if (selected('survey-walk') || selected('survey-records-after-submit.png')) {
  const page = await context.newPage()
  try {
    await page.goto(`${TENANT_BASE}/survey`, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT_MS,
    })
    await page.waitForSelector('text=How satisfied are you?', {
      timeout: TIMEOUT_MS,
    })
    // Let hydration attach handlers first — the Rating is controlled, so
    // a pre-hydration star click is silently lost.
    await page.waitForTimeout(2000)
    // 4 stars — clicking the star label drives the controlled Rating,
    // which serializes into the field's hidden input at submit. Poll the
    // hidden input to confirm the click actually landed post-hydration.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.locator('.MuiRating-root label').nth(3).click()
      await page.waitForTimeout(400)
      const rating = await page
        .locator('input[name="satisfaction"]')
        .inputValue()
        .catch(() => '')
      if (rating === '4') break
    }
    await page.getByLabel('Monthly').check()
    await page.getByLabel('Products').check()
    await page.fill(
      'textarea[name="comments"]',
      'Love the new menu — more gluten-free, please!',
    )
    await page.click('button[type="submit"]')
    await page.waitForSelector('text=Thanks — your feedback helps us improve!', {
      timeout: TIMEOUT_MS,
    })
    console.log('WALK  survey submitted end-to-end')
  } catch (error) {
    failures += 1
    console.error(
      `FAIL  survey walk: ${String(error?.message ?? error).split('\n')[0]}`,
    )
  } finally {
    await page.close()
  }
}

// Walk the member sign-up for real (idempotent: an "already a member"
// rejection on re-runs is fine — the account exists).
if (selected('member-signup-walk')) {
  const page = await context.newPage()
  try {
    await page.goto(`${TENANT_BASE}/signup`, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT_MS,
    })
    await page.waitForSelector('text=Create your account', { timeout: TIMEOUT_MS })
    // Field names, not placeholders: the Members sign-up form is MUI
    // TextFields with floating labels and no placeholder attribute, so
    // `input[placeholder="Name"]` matched nothing and the walk spent the
    // default 30s action timeout before being skipped on every run.
    await page.fill('input[name="displayName"]', 'Walk Through')
    await page.fill('input[name="email"]', 'walkthrough@example.com')
    await page.fill('input[type="password"]', 'Walkthrough-Pass-1')
    await page.click('button[type="submit"]')
    const signedUp = await page
      .waitForURL((url) => !url.pathname.startsWith('/signup'), {
        timeout: 15_000,
      })
      .then(() => true)
      .catch(() => false)
    if (signedUp) {
      console.log('WALK  member signed up end-to-end')
    } else {
      // Staying on /signup is only OK for the one expected reason. The
      // previous version treated ANY failure to navigate as "already a
      // member", which is how a walk that never filled a field in the first
      // place still reported an ok-ish line. Assert the form's own 409 copy.
      const body = await page.locator('body').innerText()
      if (/already a member/i.test(body)) {
        console.log('WALK  member sign-up: already a member (ok)')
      } else {
        failures += 1
        console.error(
          `FAIL  member sign-up walk: stayed on /signup — ${body
            .replace(/\s+/g, ' ')
            .slice(0, 160)}`,
        )
      }
    }
  } catch (error) {
    failures += 1
    console.error(
      `FAIL  member sign-up walk: ${String(error?.message ?? error).split('\n')[0]}`,
    )
  } finally {
    await page.close()
  }
}

// The record written by the real submission, back on the Data page.
await shot({
  out: 'survey-records-after-submit.png',
  base: CONSOLE_BASE,
  path: `/${HOST_BASE}/data`,
  waitFor: 'Add dataset',
  actions: [...pickSurveyDataset, { waitFor: 'gluten-free' }],
})

await browser.close()
console.log(
  failures ? `\n${failures} shots failed` : '\nAll guide shots captured',
)
process.exit(failures ? 1 : 0)
