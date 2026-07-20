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

// Seeds the aglyn-marketing site host's "Changelog" (AGL-614) as ordinary
// platform CONTENT — a content collection + published entries — so it renders
// through the blog/collections feature (built-in themed list + article, no
// host-unique components) and paginates via the collection page sets shipped
// in AGL-620. Nothing here is specific to the marketing host; any host id works.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/seed-changelog.mjs [--host DXnRbPH4CQ]
//
// Against the emulator, point the Admin SDK at it and pass any seeded host:
//   FIRESTORE_EMULATOR_HOST=localhost:8082 FIREBASE_PROJECT_ID=aglyn-main \
//     node tools/scripts/seed-changelog.mjs --host demo
//
// Idempotent: the collection and every entry has a deterministic doc id, so
// re-runs converge instead of duplicating. Only the target host is touched.

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'

const args = process.argv.slice(2)
const hostArgIndex = args.indexOf('--host')
// Default: the aglyn-marketing site host inside the aglyn org.
const hostTarget = hostArgIndex !== -1 ? args[hostArgIndex + 1] : 'DXnRbPH4CQ'

const projectId = process.env.FIREBASE_PROJECT_ID
const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
if (!projectId) {
  console.error('Missing FIREBASE_PROJECT_ID env var')
  process.exit(1)
}
if (!getApps().length) {
  if (usingEmulator) {
    // The emulator ignores credentials; a bare projectId is enough.
    initializeApp({ projectId })
  } else {
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    if (!clientEmail || !privateKey) {
      console.error(
        'Missing FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars',
      )
      process.exit(1)
    }
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
  }
}
const firestore = getFirestore()

// ── Resolve the host by id or subdomain ─────────────────────────────────────
let hostRef = firestore.collection('hosts').doc(hostTarget)
if (!(await hostRef.get()).exists) {
  const bySubdomain = await firestore
    .collection('hosts')
    .where('subdomain', '==', hostTarget)
    .limit(1)
    .get()
  if (bySubdomain.empty) {
    console.error(`No host with id or subdomain "${hostTarget}"`)
    process.exit(1)
  }
  hostRef = bySubdomain.docs[0].ref
}
console.log(`Seeding changelog into host ${hostRef.id}…`)
const now = FieldValue.serverTimestamp()
let written = 0
const put = async (ref, data) => {
  await ref.set({ ...data, updatedAt: now }, { merge: true })
  written += 1
}

// A published entry dated to a specific day; `publishedAt` both orders the
// list (newest first) and is the date the built-in article/meta line shows.
const at = (isoDate) => Timestamp.fromDate(new Date(`${isoDate}T15:00:00Z`))

// ── The Changelog collection + its category taxonomy (AGL-582) ──────────────
const changelog = hostRef.collection('collections').doc('changelog')
await put(changelog, {
  displayName: 'Changelog',
  slug: 'changelog',
  // Stable category ids; renaming a name later never rewrites entries.
  categories: [
    { id: 'platform', name: 'Platform' },
    { id: 'content', name: 'Content' },
    { id: 'commerce', name: 'Commerce' },
    { id: 'design', name: 'Design' },
    { id: 'marketing', name: 'Marketing' },
  ],
  createdAt: now,
})

// ── Entries — real, user-facing platform updates, newest first ──────────────
// Twelve entries so the built-in list paginates (10/page → two pages).
const entries = [
  {
    slug: 'rest-api-and-api-keys',
    date: '2026-07-20',
    categoryId: 'platform',
    tags: ['api', 'developers'],
    title: 'The Aglyn REST API is here',
    excerpt:
      'Read and write your site content programmatically with a versioned REST API and scoped API keys.',
    body:
      'Automate your site with the new **Aglyn REST API**. A stable `/v1` surface lets ' +
      'you list, create, and update your content from anywhere.\n\n' +
      '- **API keys** — mint `aglyn_sk_` keys in **Settings → API keys**, each with ' +
      'the scopes it needs and nothing more.\n' +
      '- **Cursor pagination** and a consistent error envelope across every resource.\n' +
      '- **Rate-limit headers** and **idempotency keys** so integrations stay safe to retry.\n\n' +
      'See the new [API reference](/docs) for endpoints and examples. Available on the ' +
      '**Business** plan.',
  },
  {
    slug: 'in-console-help-and-docs-hub',
    date: '2026-07-19',
    categoryId: 'platform',
    tags: ['docs', 'help'],
    title: 'Contextual help, everywhere you work',
    excerpt:
      'A new documentation hub plus unobtrusive help tips woven through the console.',
    body:
      'Learning Aglyn just got easier.\n\n' +
      '- **In-console help tips** — a small **?** next to fields, styles, and settings ' +
      'gives you a one-line explanation and a click-through to the full docs.\n' +
      '- **A reorganized docs hub** with **Docs**, **API**, **Learn**, and **Help** ' +
      'sections, so you can go from a how-to to a deep reference without losing your place.\n' +
      '- **Docs open in a new tab** from the account menu, so your work stays put.',
  },
  {
    slug: 'rich-media-in-the-blog-editor',
    date: '2026-07-18',
    categoryId: 'content',
    tags: ['blog', 'editor', 'media'],
    title: 'Richer writing: media picker & paste-to-format',
    excerpt:
      'Insert images from your media library and paste formatted text straight into posts.',
    body:
      'The blog editor now meets you where you write.\n\n' +
      '- **Choose from media** — the image dialog opens your **media library** so you ' +
      'pick an existing upload instead of hunting for a URL.\n' +
      '- **Paste rich text** from a web page or Google Docs and keep the formatting — ' +
      'bold, italics, links, headings, lists, and images all carry over.\n' +
      '- Everything still round-trips to clean Markdown, so nothing is stored as HTML.',
  },
  {
    slug: 'blog-categories-seo-and-rss',
    date: '2026-07-17',
    categoryId: 'content',
    tags: ['blog', 'seo'],
    title: 'Blogging upgrades: categories, SEO controls & RSS',
    excerpt:
      'Organize posts by category, fine-tune search snippets, and syndicate with RSS.',
    body:
      'Your blog grew up.\n\n' +
      '- **Categories** are managed per collection and referenced by a stable id, so ' +
      'renaming one updates every post instantly.\n' +
      '- **SEO title & description** overrides per entry, falling back to the title and ' +
      'excerpt when blank.\n' +
      '- **RSS** feeds and automatic **sitemap** inclusion so readers and search engines ' +
      'keep up.\n\n' +
      'Learn how in [Build a blog](/docs).',
  },
  {
    slug: 'self-serve-add-ons-and-billing',
    date: '2026-07-16',
    categoryId: 'platform',
    tags: ['billing', 'plans'],
    title: 'Self-serve add-ons & a new billing portal',
    excerpt:
      'Add capacity and features to your plan yourself, and manage billing in one place.',
    body:
      'Grow on your own terms.\n\n' +
      '- **Add-ons** — top up seats and capabilities right from the console, no sales ' +
      'call required.\n' +
      '- A refreshed **billing portal** to view invoices, update payment methods, and ' +
      'change plans.\n' +
      '- Clear entitlements so you always know what your plan includes.',
  },
  {
    slug: 'point-of-sale',
    date: '2026-07-14',
    categoryId: 'commerce',
    tags: ['commerce', 'pos'],
    title: 'Sell in person with Point of Sale',
    excerpt:
      'Ring up in-person sales against the same catalog and inventory as your online store.',
    body:
      'Your storefront now works at the counter.\n\n' +
      '- A fast **POS** view that shares your products, variants, and **inventory by ' +
      'location** with the online store.\n' +
      '- Take payment, apply discounts, and email receipts.\n' +
      '- Orders land in the same place, so reporting stays unified.',
  },
  {
    slug: 'digital-products-and-subscriptions',
    date: '2026-07-13',
    categoryId: 'commerce',
    tags: ['commerce', 'digital', 'subscriptions'],
    title: 'Digital products & subscriptions',
    excerpt:
      'Sell downloads, gated content, and recurring plans alongside physical goods.',
    body:
      'Sell more than boxes.\n\n' +
      '- **Digital files** with secure, tokenized download links and versioning.\n' +
      '- **Gated videos** for members-only content.\n' +
      '- **Subscriptions** with intervals and trial periods, billed automatically.',
  },
  {
    slug: 'gift-cards-discounts-and-reviews',
    date: '2026-07-11',
    categoryId: 'commerce',
    tags: ['commerce', 'discounts', 'reviews'],
    title: 'Gift cards, discounts & product reviews',
    excerpt:
      'Run promotions, sell gift cards, and collect verified customer reviews.',
    body:
      'A fuller commerce toolkit.\n\n' +
      '- **Automatic & code discounts**, plus **coupons** with usage tracking.\n' +
      '- **Gift cards** with balances your customers can redeem at checkout.\n' +
      '- **Product reviews** with ratings, moderation, and a verified-buyer badge.',
  },
  {
    slug: 'email-designer-and-campaigns',
    date: '2026-07-09',
    categoryId: 'marketing',
    tags: ['email', 'marketing'],
    title: 'Design emails and send campaigns',
    excerpt:
      'A drag-and-drop email designer and audience campaigns, built into your site.',
    body:
      'Reach your audience without leaving Aglyn.\n\n' +
      '- An **email designer** that uses the same blocks and theme as your site.\n' +
      '- **Campaigns** to leads, contacts, and lists, with open and click stats.\n' +
      '- Personalize with `{{contact.*}}` tokens.',
  },
  {
    slug: 'interactions-no-code-behavior',
    date: '2026-07-07',
    categoryId: 'design',
    tags: ['besigner', 'interactions'],
    title: 'Interactions: no-code element behavior',
    excerpt:
      'Add open, toggle, hover, and dismiss behavior to any element — no code required.',
    body:
      'Make your pages move.\n\n' +
      '- Wire up **click, hover, and toggle** behavior visually in the besigner.\n' +
      '- Presets for common patterns like dropdown panels and dismissible banners.\n' +
      '- Per-step controls such as delays and dismiss triggers.',
  },
  {
    slug: 'plugin-marketplace',
    date: '2026-07-04',
    categoryId: 'platform',
    tags: ['plugins', 'marketplace'],
    title: 'Extend your site from the plugin marketplace',
    excerpt:
      'Browse, install, and configure plugins that add blocks and capabilities.',
    body:
      'Aglyn is now extensible.\n\n' +
      '- A **plugin marketplace** with listings, details, and reviews.\n' +
      '- One-click **install** that syncs the plugin into your org.\n' +
      '- A configuration framework so plugins have proper settings, not guesswork.',
  },
  {
    slug: 'team-accounts-and-staff-tools',
    date: '2026-07-01',
    categoryId: 'platform',
    tags: ['teams', 'orgs'],
    title: 'Team accounts, roles & staff tools',
    excerpt:
      'Invite teammates with roles, and manage everything from a multi-tenant org.',
    body:
      'Built for teams.\n\n' +
      '- **Organizations** that own multiple sites, with shared contacts and data.\n' +
      '- **Roles & permissions** so teammates get exactly the access they need.\n' +
      '- **Staff tools** and run logs for support and observability behind the scenes.',
  },
]

for (const entry of entries) {
  await put(changelog.collection('entries').doc(`cl-${entry.slug}`), {
    title: entry.title,
    slug: entry.slug,
    excerpt: entry.excerpt,
    body: entry.body,
    categoryId: entry.categoryId,
    tags: entry.tags,
    status: 'published',
    publishedAt: at(entry.date),
    createdAt: at(entry.date),
  })
}

console.log(
  `Done — ${written} documents written to ${hostRef.id} ` +
    `(1 collection + ${entries.length} entries).`,
)
