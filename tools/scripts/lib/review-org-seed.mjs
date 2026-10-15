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
 * The store-review workspace's data (AGL-3812): what App Store and Google
 * Play reviewers see when they sign in as the reviewer account.
 *
 * The reviewer's workspace is a REAL production org, so nothing here is new
 * fixture data. It is the emulator fixtures the apps and the docs are already
 * shot from, adapted to land safely in one live org:
 *
 * - the native apps' "Juniper Street Co." areas (`tools/scripts/seed-native/*`),
 *   which shape the CRM, inbox, forms, store, POS, bookings, events,
 *   marketing, email, automations, notifications and blog the apps show;
 * - the e2e bakery's CRM book (`libs/plugins/crm/scripts/fixtures/crm-fixtures.mjs`)
 *   for tasks, custom fields, a second pipeline and the lead-routing forms;
 * - the docs bakery's builders (`docs-fixture-builders.mjs`) for the API-key
 *   list, a charged-back order, sixty days of traffic, the business profile
 *   and AI memory;
 * - an About and a Contact page, so the published site is more than a home.
 *
 * Each source is recorded against placeholder ids, then run through one
 * policy ({@link classifyRecord}) that decides what may reach a live org,
 * re-keyed under `seed-review-…` ids with every reference re-pointed, scrubbed
 * of every address that is not `example.com`/`example.org`, and re-stamped
 * with the list fields the console's queries read. {@link assertPlanSafe} then
 * refuses the plan if anything forbidden survived.
 *
 * What never reaches the org, and why:
 *
 * - teammates, member rows and invites: there are no Auth users behind the
 *   fixtures' people, and a member row is an authorization grant;
 * - the org document's subscription, plan, entitlements, counters and usage:
 *   billing belongs to the staff override, not to a seed;
 * - media: a library document without its Storage object is a broken
 *   thumbnail, and a document with one moves the storage counter;
 * - page trees, layouts, templates, themes and email templates with no
 *   designed nodes: on a published site they are blank pages and blank
 *   receipts;
 * - the host document's look, analytics tag, search-console token and
 *   favicon: a fixture value there changes what the live site serves.
 *
 * And what is written disarmed: a scheduled send is moved decades out so the
 * campaign cron never finds it due, every booking and CRM task carries the
 * stamp its reminder cron writes after sending, and webhooks are off.
 */

import { seedCrmFixtures } from '../../../libs/plugins/crm/scripts/fixtures/crm-fixtures.mjs'
import { orderListFieldsOf } from '../backfill-orders-list-fields.mjs'
import { buildHomeNodes, CANVAS_ROOT_ID } from './demo-brands.mjs'
import {
  aiMemoryFixtures,
  apiKeyFixtures,
  businessProfileFixtures,
  chargebackOrder,
  trafficDays,
} from './docs-fixture-builders.mjs'
import { emailSearchTokens, listMemberSearchTokens } from './email-search-tokens.mjs'
import { hostMembershipSearchTokens } from './host-membership-search-tokens.mjs'
import { messageSearchFields } from './message-search.mjs'
import { displayNameSearchFields, nameSearchKey } from './name-search-tokens.mjs'
import { withCrmListFields } from './org-record-list-fields.mjs'
import { datasetFilterFields, effectiveModel } from './record-filter-keys.mjs'
import { productListFields } from './seed-demo.mjs'

/** The one workspace this seeds: the reviewer account's. */
export const REVIEW_ORG_ID = '9A5fJ_zEoH'
/** The site the feature data lands on: the reviewer org's bakery. */
export const REVIEW_HOST_ID = 'review-bakery'

/** Every document this seed mints has an id with this prefix. */
export const REVIEW_ID_PREFIX = 'seed-review-'
/** The field that marks a document as this seed's, read by the prune. */
export const REVIEW_SEED_SOURCE = 'review-org'

/** The names the native apps were shot with (the "Juniper Street Co." workspace). */
export const JUNIPER = {
  orgName: 'Juniper Street Co.',
  siteName: 'Juniper Street Bakery',
  /** The workspace's two other sites, as new hosts beside the bakery. */
  siblings: [
    {
      hostId: 'review-juniper-cafe',
      subdomain: 'review-juniper-cafe',
      displayName: 'Juniper Street Cafe',
      // The native fixture's second site is in maintenance mode, which is
      // the state the apps' site settings screen shows a switch for.
      maintenance: true,
      sections: [
        {
          type: 'heroCentered',
          eyebrow: 'Opening soon · Juniper Street',
          title: 'Coffee and a slice, two doors down',
          body: 'The bakery’s cafe is getting its espresso bar fitted. Pour-overs and pastries from 7 a.m. when we open.',
          cta: { label: 'Visit the bakery', href: '/' },
        },
        {
          type: 'featureGrid',
          heading: 'On the counter',
          items: [
            { title: 'House blend', body: 'Roasted for us in small batches, brewed every hour.' },
            { title: 'Morning pastries', body: 'Walked over from the bakery ovens at dawn.' },
            { title: 'Quiet tables', body: 'Wi-Fi, outlets and no rush.' },
          ],
        },
      ],
    },
    {
      hostId: 'review-juniper-catering',
      subdomain: 'review-juniper-catering',
      displayName: 'Juniper Street Catering',
      maintenance: false,
      sections: [
        {
          type: 'heroCentered',
          eyebrow: 'Weddings · Offices · Celebrations',
          title: 'Juniper Street, catered',
          body: 'Pastry tables, sandwich platters and celebration cakes, delivered and set up across Portland.',
          cta: { label: 'Request a quote', href: '/contact' },
        },
        {
          type: 'featureGrid',
          heading: 'Popular orders',
          items: [
            { title: 'Breakfast for twenty', body: 'Croissants, fruit and two airpots of coffee.' },
            { title: 'Office lunch', body: 'Sandwiches on our sourdough, salads and cookies.' },
            { title: 'Dessert table', body: 'Tarts, macarons and a cake to cut.' },
          ],
        },
      ],
    },
  ],
}

/**
 * The native areas, in the order `seed-native-emulator.mjs` runs them, by
 * file and export. `workspace` is absent on purpose: everything it writes is
 * a teammate, a site created by its own rules, or a media document.
 */
export const NATIVE_AREAS = [
  ['people', 'seedCrm'],
  ['submissions', 'seedForms'],
  ['inbox', 'seedInbox'],
  ['marketing', 'seedMarketing'],
  ['email', 'seedEmail'],
  ['store', 'seedCommerce'],
  ['insights', 'seedInsights'],
  ['site-rules', 'seedAutomation'],
  ['pos', 'seedPos'],
  ['notifications', 'seedNotifications'],
  ['content', 'seedContent'],
  ['account', 'seedAccount'],
]

/**
 * The ids the sources are recorded against. Distinctive on purpose: the
 * remap replaces them wherever they appear, inside strings too (a link, a
 * `host:` scope token, a facet key), which is only safe for a string no
 * fixture could contain by accident.
 */
export const PLACEHOLDER = {
  orgId: 'zz-review-org-zz',
  hostId: 'zz-review-host-zz',
  uid: 'zz-review-owner-zz',
  ownerName: 'zz-review-owner-name-zz',
}

/** The About and Contact pages this seed publishes. */
export const ABOUT_SCREEN_ID = `${REVIEW_ID_PREFIX}page-about`
export const CONTACT_SCREEN_ID = `${REVIEW_ID_PREFIX}page-contact`
export const SHOP_SCREEN_ID = `${REVIEW_ID_PREFIX}page-order`
export const PRODUCT_SCREEN_ID = `${REVIEW_ID_PREFIX}page-product`
/** The home screen `seedBrand` publishes on every demo site. */
export const BRAND_HOME_SCREEN_ID = 'seed-home'
/** The blog `seedBrand` writes; the native entries join it rather than a second blog. */
export const BRAND_BLOG_ID = 'seed-blog'

const DAY_MS = 24 * 60 * 60 * 1000
/** How far out a seeded scheduled send is moved, so the campaign cron never finds it due. */
export const NEVER_DUE_YEARS = 75

/* ------------------------------------------------------------------------ */
/* Refs a seed can be recorded through                                      */
/* ------------------------------------------------------------------------ */

/**
 * A document reference shaped like the Admin SDK's, as far as the list-field
 * helpers read one (`id`, `path`, and `parent` up the chain), without a
 * Firestore behind it.
 *
 * @param {string} path
 */
export function fakeRef(path) {
  const segments = path.split('/')
  const docAt = (end) => {
    const docPath = segments.slice(0, end).join('/')
    return {
      id: segments[end - 1],
      path: docPath,
      get parent() {
        return collectionAt(end - 1)
      },
      collection: (name) => collectionFrom(`${docPath}/${name}`),
    }
  }
  const collectionAt = (end) => ({
    id: segments[end - 1],
    path: segments.slice(0, end).join('/'),
    get parent() {
      return end > 1 ? docAt(end - 1) : null
    },
  })
  return docAt(segments.length)
}

const collectionFrom = (path) => ({
  id: path.split('/').pop(),
  path,
  doc: (id) => fakeRef(`${path}/${id}`),
})

/** A `firestore` stand-in whose refs are {@link fakeRef}s; for seeders that build refs. */
export const recordingFirestore = () => ({ collection: (name) => collectionFrom(name) })

/* ------------------------------------------------------------------------ */
/* Recording the sources                                                    */
/* ------------------------------------------------------------------------ */

/** `nameSearchFields` (libs/aglyn/src/lib/app-utils/name-search.ts), `name` included. */
export const nameSearchFields = (name) => ({ name, ...displayNameSearchFields(name) })

/**
 * Runs every native area against a recording `put`.
 *
 * @param {(file: string) => Promise<Record<string, Function>>} loadArea
 * @param {number} nowMs
 * @returns {Promise<Array<{ path: string, data: object, source: string }>>}
 */
export async function recordNativeAreas(loadArea, nowMs) {
  const records = []
  for (const [file, exportName] of NATIVE_AREAS) {
    const area = await loadArea(file)
    const put = async (path, data) => {
      records.push({ path, data, source: file })
    }
    // No `auth`/`project`: the account area returns before it touches the
    // Auth emulator, which is the only network call any area makes.
    await area[exportName]({
      put,
      uid: PLACEHOLDER.uid,
      orgId: PLACEHOLDER.orgId,
      hostId: PLACEHOLDER.hostId,
      now: new Date(nowMs),
      nameSearchFields,
    })
  }
  return records
}

/**
 * The e2e bakery's CRM book, recorded. The teammate is the owner: a second
 * uid would be a person who does not exist assigned to real records.
 *
 * @param {number} nowMs
 */
export async function recordCrmFixtures(nowMs) {
  const records = []
  await seedCrmFixtures({
    firestore: recordingFirestore(),
    orgId: PLACEHOLDER.orgId,
    hostId: PLACEHOLDER.hostId,
    ownerUid: PLACEHOLDER.uid,
    ownerName: PLACEHOLDER.ownerName,
    teammateUid: PLACEHOLDER.uid,
    nowMs,
    write: async (ref, data) => {
      records.push({ path: ref.path, data, source: 'crm-e2e' })
    },
  })
  return records
}

/* ------------------------------------------------------------------------ */
/* Plain-data helpers                                                       */
/* ------------------------------------------------------------------------ */

const isPlain = (value) =>
  value !== null && typeof value === 'object' && (value.constructor === Object || value.constructor === undefined)

/** Deep map over strings (keys included), leaving Dates, Timestamps and sentinels alone. */
function mapStrings(value, fn) {
  if (typeof value === 'string') return fn(value)
  if (Array.isArray(value)) return value.map((entry) => mapStrings(entry, fn))
  if (isPlain(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [fn(key), mapStrings(entry, fn)]))
  }
  return value
}

/** Deep merge of plain objects; arrays and non-plain values are replaced. */
export function deepMerge(base, patch) {
  if (!isPlain(base) || !isPlain(patch)) return patch
  const out = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlain(out[key]) && isPlain(value) ? deepMerge(out[key], value) : value
  }
  return out
}

/** `FieldValue.arrayUnion`, as data, for the writer to turn into the real thing. */
export const arrayUnion = (...values) => ({ __reviewSeedArrayUnion: values })
export const isArrayUnion = (value) => isPlain(value) && Array.isArray(value.__reviewSeedArrayUnion)

/* ------------------------------------------------------------------------ */
/* Addresses                                                                */
/* ------------------------------------------------------------------------ */

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const ALLOWED_EMAIL_DOMAIN = /(^|\.)example\.(com|org)$/i

/**
 * Moves every hostname a reader could own onto `example.com` (RFC 2606):
 * `example.test` → `example.com`, `*.example` / `*.test` → `*.example.com`,
 * and a real-looking `*.com` (the e2e CRM book's café and Gmail addresses)
 * → `*.example.com`. A hostname already under `example.com`/`example.org`
 * is left alone.
 *
 * @param {string} text
 */
export function reserveDomains(text) {
  return text
    .replace(/@gmail\.com\b/gi, '@mail.example.com')
    .replace(/\b((?:[a-z0-9-]+\.)*)example\.test\b/gi, (_, sub) => `${sub}example.com`)
    .replace(/\b((?:[a-z0-9-]+\.)*[a-z0-9-]+)\.(example|test)\b(?!\.[a-z])/gi, (match, host, tld) =>
      tld.toLowerCase() === 'example' && /(^|\.)example$/i.test(host) ? match : `${host}.example.com`,
    )
    .replace(/\b((?:[a-z0-9-]+\.)*[a-z0-9-]+)\.com\b/gi, (match, host) =>
      /(^|\.)example$/i.test(host) ? match : `${host}.example.com`,
    )
}

/** Every email address in a value, for the safety check. */
export function emailsIn(value) {
  const found = []
  const walk = (entry, key = '') => {
    // Search tokens are prefixes of an address (`tim@web.ex`), not addresses.
    if (/tokens$|^facetKeys$/i.test(key)) return
    if (typeof entry === 'string') found.push(...(entry.match(EMAIL_PATTERN) ?? []))
    else if (Array.isArray(entry)) entry.forEach((item) => walk(item, key))
    else if (isPlain(entry)) for (const [name, item] of Object.entries(entry)) walk(item, name)
  }
  walk(value)
  return found
}

/* ------------------------------------------------------------------------ */
/* The policy                                                               */
/* ------------------------------------------------------------------------ */

/** Host subcollections whose documents only render with designed nodes this seed does not have. */
const UNDESIGNED_HOST_COLLECTIONS = new Set([
  'components',
  'layouts',
  'templates',
  'themes',
  'emailTemplates',
  'media',
  'mediaFolders',
])

/** Of the native host document's fields, the ones that change nothing the live site serves. */
const HOST_FIELDS_KEPT = ['business', 'timeZone']
const HOST_SEO_FIELDS_KEPT = ['title', 'description', 'entity']

/**
 * What may reach the live org, record by record.
 *
 * @param {{ path: string, data: Record<string, any>, source: string }} record
 * @returns {{ keep: true, data: Record<string, any> } | { keep: false, reason: string }}
 */
export function classifyRecord(record) {
  const { path, data, source } = record
  const segments = path.split('/')
  const [root, , collection] = segments
  const depth = segments.length
  const skip = (reason) => ({ keep: false, reason })
  const keep = (next = data) => ({ keep: true, data: next })

  if (source === 'account') {
    // The account area is the workspace's identity: its subscription, the
    // owner's profile, member rows and a collaborator. Only the site's
    // activity log is data the reviewer should see.
    return root === 'hosts' && collection === 'activity' ? keep() : skip('account identity, members and subscription')
  }
  if (root === 'users') {
    if (collection !== 'notifications') return skip('a user profile is the account holder’s own')
    if (data.type === 'billing.invoice') return skip('an invoice notice for a comped plan')
    return keep()
  }
  if (depth === 2 && root === 'orgs') return skip('the org document carries billing and ownership')
  if (collection === 'members' || collection === 'invites') return skip('member rows are authorization grants')
  if (collection === 'counters') return skip('usage counters meter the plan')

  if (root === 'orgs' && (collection === 'media' || collection === 'mediaFolders')) {
    return skip('a library document with no Storage object')
  }
  if (root === 'orgs' && collection === 'pipelines' && segments[3] === 'seed-crm-pipeline-sales') {
    return skip('a second default Sales pipeline (its deals join the native one)')
  }

  if (root === 'hosts') {
    if (depth === 2) {
      const next = {}
      for (const field of HOST_FIELDS_KEPT) if (data[field] !== undefined) next[field] = data[field]
      if (isPlain(data.seo)) {
        const seo = {}
        for (const field of HOST_SEO_FIELDS_KEPT) if (data.seo[field] !== undefined) seo[field] = data.seo[field]
        if (Object.keys(seo).length) next.seo = seo
      }
      return Object.keys(next).length ? keep(next) : skip('host look, routing and tracking fields')
    }
    if (UNDESIGNED_HOST_COLLECTIONS.has(collection)) return skip('no designed nodes or Storage object')
    if (collection === 'analytics') return skip('replaced by the sixty-day traffic curve')
    if (collection === 'screens') {
      // The email designs carry nodes and are kept; the page tree's versions
      // carry none, and a published page with no nodes is a blank page.
      if (source !== 'email') return skip('a page version with no designed nodes')
      if (segments[3] === 'seed-email-welcome') return skip('the brand pack already seeds this design')
      return keep()
    }
    if (collection === 'screenAnalytics') {
      return SCREEN_ANALYTICS_SCREENS[data.screenId] ? keep() : skip('per-page traffic for a page this site does not have')
    }
    if (collection === 'collections' && depth === 4) {
      // The native blog joins the brand pack's blog: its categories, not a second blog.
      if (!isPlain(data) || !Array.isArray(data.categories)) return skip('a second blog')
      return keep({ categories: data.categories, schemaType: data.schemaType })
    }
  }
  return keep()
}

/** Per-page traffic is kept for the pages this site has, under their real screen ids. */
const SCREEN_ANALYTICS_SCREENS = { home: BRAND_HOME_SCREEN_ID, about: ABOUT_SCREEN_ID }

/* ------------------------------------------------------------------------ */
/* Ids and references                                                       */
/* ------------------------------------------------------------------------ */

/** Collections whose document ids are keys (a day, a singleton), not fixture names. */
const KEYED_COLLECTIONS = new Set(['analytics', 'businessProfile', 'settings', 'pluginSettings', 'reports'])

/** `seed-review-` + the fixture id, without doubling a `seed-` the fixture already carried. */
export const reviewId = (id) => `${REVIEW_ID_PREFIX}${String(id).replace(/^seed-/, '')}`

/** Reference fields, by the collection their value is a document id in. */
const REFERENCE_FIELDS = {
  contactId: 'contacts',
  contactRoleContactIds: 'contacts',
  companyId: 'companies',
  dealId: 'deals',
  leadId: 'leads',
  pipelineId: 'pipelines',
  formId: 'forms',
  productId: 'products',
  productIds: 'products',
  categoryIds: 'productCategories',
  serviceId: 'services',
  workflowId: 'workflows',
  functionId: 'functions',
  authorId: 'authors',
  listId: 'lists',
  listIds: 'lists',
  emailCampaignId: 'emailCampaigns',
  screenId: 'screens',
  versionId: 'versions',
  refId: 'orders',
}

/** Activity rows name what ran by `target.id`; these are the collections it can be in. */
const TARGET_COLLECTIONS = ['workflows', 'actions', 'automations']

/**
 * Where a fixture id lands when it should be an EXISTING document rather than
 * a new one: the e2e CRM's Sales pipeline is the native one, its order #1041
 * is the native store's #1041, the native blog is the brand pack's, and the
 * campaigns' "newsletter" list is the email area's.
 */
const ALIASES = {
  pipelines: { 'seed-crm-pipeline-sales': 'default' },
  orders: { 'seed-order-1041': 'o-1041' },
  lists: { newsletter: 'seed-list-newsletter' },
}
const FIXED_IDS = {
  collections: { blog: BRAND_BLOG_ID },
  screens: { home: BRAND_HOME_SCREEN_ID, about: ABOUT_SCREEN_ID },
}

/**
 * The id map: every fixture document id, by collection, to its id in the
 * review org.
 *
 * @param {Array<{ path: string }>} records
 */
export function buildIdMap(records) {
  const map = {}
  const set = (collection, from, to) => {
    map[collection] ??= {}
    map[collection][from] = to
  }
  for (const { path } of records) {
    const segments = path.split('/')
    for (let at = 3; at < segments.length; at += 2) {
      const collection = segments[at - 1]
      if (KEYED_COLLECTIONS.has(collection) || collection === 'screenAnalytics') continue
      const id = segments[at]
      set(collection, id, FIXED_IDS[collection]?.[id] ?? reviewId(id))
    }
  }
  for (const [collection, aliases] of Object.entries(ALIASES)) {
    for (const [from, to] of Object.entries(aliases)) {
      const target = map[collection]?.[to]
      if (target) set(collection, from, target)
    }
  }
  for (const [collection, fixed] of Object.entries(FIXED_IDS)) {
    for (const [from, to] of Object.entries(fixed)) set(collection, from, to)
  }
  return map
}

/** A record's path in the review org. */
export function remapPath(path, idMap, target) {
  const segments = path.split('/')
  const out = segments.map((segment, at) => {
    if (at % 2 === 0) return segment
    if (at === 1) return replacePlaceholders(segment, target)
    const collection = segments[at - 1]
    if (KEYED_COLLECTIONS.has(collection)) return segment
    if (collection === 'screenAnalytics') {
      const [screenId, day] = segment.split(':')
      return `${SCREEN_ANALYTICS_SCREENS[screenId] ?? screenId}:${day}`
    }
    return idMap[collection]?.[segment] ?? reviewId(segment)
  })
  return out.join('/')
}

/** Re-points every reference field (at any depth) at the review org's ids. */
function remapReferences(value, idMap) {
  if (Array.isArray(value)) return value.map((entry) => remapReferences(entry, idMap))
  if (!isPlain(value)) return value
  const out = {}
  for (const [key, entry] of Object.entries(value)) {
    const collection = REFERENCE_FIELDS[key]
    if (collection && typeof entry === 'string') {
      out[key] = idMap[collection]?.[entry] ?? entry
    } else if (collection && Array.isArray(entry)) {
      out[key] = entry.map((id) => (typeof id === 'string' ? (idMap[collection]?.[id] ?? id) : id))
    } else if (key === 'target' && isPlain(entry) && typeof entry.id === 'string') {
      const mapped = TARGET_COLLECTIONS.map((name) => idMap[name]?.[entry.id]).find(Boolean)
      out[key] = { ...remapReferences(entry, idMap), id: mapped ?? entry.id }
    } else if ((key === 'source' || key === 'sources') && entry !== undefined) {
      // A lead's source names the form it came in through: `form:<formId>`.
      out[key] = mapStrings(entry, (text) =>
        text.replace(/^form:(.+)$/, (match, id) => (idMap.forms?.[id] ? `form:${idMap.forms[id]}` : match)),
      )
    } else {
      out[key] = remapReferences(entry, idMap)
    }
  }
  return out
}

/* ------------------------------------------------------------------------ */
/* Names                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * The placeholder ids, and the generic names the fixtures were shot with,
 * in the review org's terms.
 */
function replacePlaceholders(text, target) {
  return text
    .split(PLACEHOLDER.orgId)
    .join(target.orgId)
    .split(PLACEHOLDER.hostId)
    .join(target.hostId)
    .split(PLACEHOLDER.uid)
    .join(target.ownerUid)
    .split(PLACEHOLDER.ownerName)
    .join(target.ownerName)
}

/** The native fixture's generic names, as the Juniper Street ones. */
const NAME_REPLACEMENTS = [
  ['Mobile Demo Bakery', JUNIPER.siteName],
  ['Demo Coffee Co.', JUNIPER.siteName],
  ['Demo Site', JUNIPER.siteName],
  ['Demo Workspace', JUNIPER.orgName],
]

function renameText(text, target) {
  let out = replacePlaceholders(text, target)
  for (const [from, to] of NAME_REPLACEMENTS) out = out.split(from).join(to)
  // The fixture's owner is the reviewer account here.
  out = out.replace(/^(Mobile Owner|Hannah Reyes)$/, target.ownerName)
  // Console links name the workspace by slug.
  out = out.replace(/^\/(demo-workspace|juniper-street)\//, `/${target.orgSlug}/`)
  out = publicImageUrl(out)
  return reserveDomains(out)
}

/** A screenshot run serves its photos from the machine it runs on (`SHOTS_IMAGE_BASE`). */
const LOCAL_IMAGE = /^https?:\/\/(?:localhost|127\.0\.0\.1|10\.0\.2\.2)(?::\d+)?\/(?:.*\/)?([A-Za-z0-9_-]+)\.(?:jpe?g|png|webp)$/

/**
 * A photo URL a published site can load: a local one becomes a picsum photo
 * seeded by its file name, the host the brand packs' photos already use.
 *
 * @param {string} text
 */
export function publicImageUrl(text) {
  return text.replace(LOCAL_IMAGE, (_, name) => `https://picsum.photos/seed/juniper-${name}/800/800`)
}

/* ------------------------------------------------------------------------ */
/* Disarming                                                                */
/* ------------------------------------------------------------------------ */

/** A time moved {@link NEVER_DUE_YEARS} years out, keeping its month, day and hour. */
export function neverDue(ms) {
  const at = new Date(ms)
  at.setUTCFullYear(at.getUTCFullYear() + NEVER_DUE_YEARS)
  return at.getTime()
}

/**
 * The fields that keep a document from setting off a cron that messages
 * someone, by collection.
 */
function disarm(collection, data, nowMs) {
  switch (collection) {
    case 'campaigns': {
      // `campaigns/process-scheduled` sends every `scheduled` row whose
      // `sendAtMs` has passed. Moved decades out, it is never due.
      if (data.status !== 'scheduled') return data
      const next = { ...data }
      // A send already held decades out (staff review's own far date) stays where it is.
      const soon = (ms) => typeof ms === 'number' && ms > 0 && ms < nowMs + 10 * 365 * DAY_MS
      if (soon(next.sendAtMs)) next.sendAtMs = neverDue(next.sendAtMs)
      if (isPlain(next.resume) && soon(next.resume.nextAtMs)) {
        next.resume = { ...next.resume, nextAtMs: neverDue(next.resume.nextAtMs) }
      }
      return next
    }
    case 'bookings':
      // `booking-reminders` mails a booking 24h out unless `reminderSentAt`
      // is set, which it stamps after sending.
      return { ...data, reminderSentAt: new Date(nowMs) }
    case 'crmTasks':
      // `crm-task-reminders` tells the assignee unless `reminderSentAtMs` is set.
      return { ...data, reminderSentAtMs: nowMs }
    case 'webhooks': {
      // An outbound hook would post captured leads to its URL; an inbound one
      // with a secret checked into the repo is a door anyone could open.
      const rest = { ...data, enabled: false }
      delete rest.secret
      return rest
    }
    default:
      return data
  }
}

/* ------------------------------------------------------------------------ */
/* List fields                                                              */
/* ------------------------------------------------------------------------ */

/**
 * The fields each console list queries, recomputed on the final document,
 * because the ids and addresses they were derived from have changed.
 *
 * @param {string} path the final path
 * @param {Record<string, any>} data
 * @param {Map<string, Record<string, any>>} byPath every final document, for a record's dataset
 */
function withListFields(path, data, byPath) {
  const segments = path.split('/')
  const collection = segments[segments.length - 2]
  const id = segments[segments.length - 1]
  if (segments[0] === 'orgs' && segments.length === 4) return withCrmListFields(fakeRef(path), data)
  switch (collection) {
    case 'products':
      return { ...data, ...productListFields(data) }
    case 'orders':
      return { ...data, ...orderListFieldsOf(data, id) }
    case 'formSubmissions':
      return isPlain(data.fields) ? { ...data, ...messageSearchFields(data.fields) } : data
    case 'members':
      return segments[2] === 'lists' ? { ...data, searchTokens: listMemberSearchTokens(data.email, data.name) } : data
    case 'suppressions':
      return { ...data, emailTokens: emailSearchTokens(data.email) }
    case 'records': {
      const dataset = byPath.get(segments.slice(0, -2).join('/'))
      if (!dataset || !isPlain(data.values)) return data
      return { ...data, ...datasetFilterFields(effectiveModel(dataset), data.values) }
    }
    default:
      return data
  }
}

/* ------------------------------------------------------------------------ */
/* This seed's own documents                                                */
/* ------------------------------------------------------------------------ */

/** A published page from section builders, plus extra nodes under the canvas root. */
function pageScreen({ hostId, screenId, name, slug, sections, extraNodes = {}, extraRootChildren = [], at }) {
  const versionId = `${screenId}-v1`
  const nodes = buildHomeNodes(sections)
  const root = nodes[CANVAS_ROOT_ID]
  root.nodes = [...root.nodes, ...extraRootChildren]
  return [
    {
      path: `hosts/${hostId}/screens/${screenId}`,
      data: {
        displayName: name,
        ...displayNameSearchFields(name),
        deletedAt: null,
        // A template (the product page) has no address of its own.
        ...(slug ? { slug, publishedAt: at } : {}),
        versionId,
        createdAt: at,
        updatedAt: at,
      },
    },
    {
      path: `hosts/${hostId}/screens/${screenId}/versions/${versionId}`,
      data: { screenId, nodes: { ...nodes, ...extraNodes }, createdAt: at, updatedAt: at },
    },
  ]
}

/** The Contact page's form, bound to the native "Contact us" form entity. */
function contactFormNodes(formId) {
  const field = (key, label, input) => ({
    [`${key}`]: {
      $id: key,
      componentId: 'muiFormControl',
      pluginId: 'mui',
      parentId: 'contactForm',
      nodes: [`${key}-label`, `${key}-input`],
      props: { fullWidth: true },
    },
    [`${key}-label`]: {
      $id: `${key}-label`,
      componentId: 'muiFormLabel',
      pluginId: 'mui',
      parentId: key,
      props: { children: label },
    },
    [`${key}-input`]: { $id: `${key}-input`, componentId: 'muiInput', pluginId: 'mui', parentId: key, props: input },
  })
  return {
    contactWrap: {
      $id: 'contactWrap',
      componentId: 'muiContainer',
      parentId: CANVAS_ROOT_ID,
      nodes: ['contactForm'],
      props: { maxWidth: 'sm' },
      sx: { pb: 10 },
    },
    contactForm: {
      $id: 'contactForm',
      componentId: 'form',
      pluginId: 'mui',
      parentId: 'contactWrap',
      nodes: ['cf-name', 'cf-email', 'cf-message'],
      props: {
        formId,
        formName: 'Contact us',
        submitLabel: 'Send message',
        successMessage: 'Thanks — we answer every message the same day.',
      },
    },
    ...field('cf-name', 'Your name', { name: 'name', type: 'text', fullWidth: true, required: true }),
    ...field('cf-email', 'Email', { name: 'email', type: 'email', fullWidth: true, required: true }),
    ...field('cf-message', 'How can we help?', {
      name: 'message',
      type: 'text',
      multiline: true,
      minRows: 4,
      fullWidth: true,
      required: true,
    }),
  }
}

/** The Order page's catalog and cart, as the docs storefront shot builds them. */
function storefrontNodes() {
  return {
    shopWrap: {
      $id: 'shopWrap',
      componentId: 'muiContainer',
      parentId: CANVAS_ROOT_ID,
      nodes: ['shopGrid', 'shopCart'],
      props: { maxWidth: 'lg' },
      sx: { pb: 10 },
    },
    shopGrid: {
      $id: 'shopGrid',
      componentId: 'product-grid',
      pluginId: 'commerce',
      parentId: 'shopWrap',
      props: { columns: 3, showSearch: true, showCategories: true, showSort: true },
    },
    shopCart: { $id: 'shopCart', componentId: 'cart', pluginId: 'commerce', parentId: 'shopWrap', props: { variant: 'inline' } },
  }
}

/** The product template's one element. */
function productDetailNodes() {
  return {
    pdpWrap: {
      $id: 'pdpWrap',
      componentId: 'muiContainer',
      parentId: CANVAS_ROOT_ID,
      nodes: ['pdpDetail'],
      props: { maxWidth: 'md' },
    },
    pdpDetail: { $id: 'pdpDetail', componentId: 'product-detail', pluginId: 'commerce', parentId: 'pdpWrap', props: {}, sx: { py: 6 } },
  }
}

/**
 * The documents this seed writes itself: the Juniper Street names, the About
 * and Contact pages, the docs bakery's API keys, chargeback, traffic, business
 * profile and AI memory, and the two sibling sites' home pages.
 */
function ownDocuments({ target, nowMs, idMap, siblings }) {
  const at = new Date(nowMs)
  const { orgId, hostId, ownerUid } = target
  const docs = []
  const push = (path, data, options = {}) => docs.push({ path, data, ...options })

  // ── Names ────────────────────────────────────────────────────────────────
  push(`orgs/${orgId}`, { name: JUNIPER.orgName, ...displayNameSearchFields(JUNIPER.orgName) }, { existing: true })
  push(`users/${ownerUid}/orgs/${orgId}`, { orgName: JUNIPER.orgName }, { existing: true })
  push(
    `hosts/${hostId}`,
    {
      displayName: JUNIPER.siteName,
      // The brand pack's product photos and the native products' are picsum
      // URLs, which the tenant's `img-src` blocks until the site approves the
      // host (Admin → Security), as a merchant using an image CDN does.
      approvedImageHosts: arrayUnion('picsum.photos', 'fastly.picsum.photos'),
      screens: { [ABOUT_SCREEN_ID]: 'about', [CONTACT_SCREEN_ID]: 'contact', [SHOP_SCREEN_ID]: 'order' },
    },
    { existing: true },
  )
  push(
    `users/${ownerUid}/hostMemberships/${hostId}`,
    {
      displayName: JUNIPER.siteName,
      nameLower: nameSearchKey(JUNIPER.siteName),
      searchTokens: hostMembershipSearchTokens({ displayName: JUNIPER.siteName, subdomain: hostId }),
      updatedAt: at,
    },
    { existing: true },
  )
  push(`hosts/${hostId}/variables/seed-site-name`, { value: JUNIPER.siteName }, { existing: true })

  // ── Pages ────────────────────────────────────────────────────────────────
  docs.push(
    ...pageScreen({
      hostId,
      screenId: ABOUT_SCREEN_ID,
      name: 'Our story',
      slug: 'about',
      at,
      sections: [
        {
          type: 'heroCentered',
          eyebrow: 'Since 2014',
          title: 'A neighborhood bakery on Juniper Street',
          body: 'We bake sourdough, pastries and celebration cakes every morning, and sell out most days by noon.',
          cta: { label: 'Visit us', href: '/contact' },
        },
        {
          type: 'featureGrid',
          heading: 'How we bake',
          items: [
            { title: 'Slow dough', body: 'Every loaf ferments for three days before it sees the oven.' },
            { title: 'Local flour', body: 'Milled an hour away from wheat grown in the valley.' },
            { title: 'Small batches', body: 'Baked through the morning, so the shelves stay warm.' },
          ],
        },
      ],
    }),
  )
  const contactFormId = idMap.forms?.contact
  docs.push(
    ...pageScreen({
      hostId,
      screenId: CONTACT_SCREEN_ID,
      name: 'Contact',
      slug: 'contact',
      at,
      sections: [
        {
          type: 'heroCentered',
          eyebrow: '12 Main St · Open daily from 7',
          title: 'Say hello',
          body: 'Questions about an order, a cake or catering? Send us a note and we will write back the same day.',
          cta: { label: 'See the menu', href: '/' },
        },
      ],
      extraNodes: contactFormId ? contactFormNodes(contactFormId) : {},
      extraRootChildren: contactFormId ? ['contactWrap'] : [],
    }),
  )
  // The home page's "Order now" goes to /order: the storefront, as a page,
  // since the commerce plugin serves no catalog route of its own.
  docs.push(
    ...pageScreen({
      hostId,
      screenId: SHOP_SCREEN_ID,
      name: 'Order',
      slug: 'order',
      at,
      sections: [
        {
          type: 'heroCentered',
          eyebrow: 'Pickup from 7 a.m. · Local delivery',
          title: 'Order ahead',
          body: 'Loaves, pastries, coffee and gifts from the counter. Order by 9 p.m. for tomorrow.',
          cta: { label: 'Questions? Write to us', href: '/contact' },
        },
      ],
      extraNodes: storefrontNodes(),
      extraRootChildren: ['shopWrap'],
    }),
  )
  // `/products/{slug}` renders the store's product template (AGL-295).
  docs.push(
    ...pageScreen({
      hostId,
      screenId: PRODUCT_SCREEN_ID,
      name: 'Product page',
      slug: null,
      at,
      sections: [],
      extraNodes: productDetailNodes(),
      extraRootChildren: ['pdpWrap'],
    }),
  )
  push(`hosts/${hostId}/settings/store`, { pdpScreenId: PRODUCT_SCREEN_ID })
  // The old menu address, which the traffic curve still shows visits to.
  push(`hosts/${hostId}/redirects/${REVIEW_ID_PREFIX}redir-menu`, {
    source: '/menu',
    destination: '/order',
    statusCode: 301,
    kind: 'exact',
    priority: 20,
    enabled: true,
    createdAt: at,
  })

  // ── The docs bakery's fixtures ──────────────────────────────────────────
  for (const day of trafficDays(nowMs)) push(`hosts/${hostId}/analytics/${day.id}`, day.data)
  for (const key of apiKeyFixtures({
    orgId,
    createdBy: ownerUid,
    nowMs,
    idFor: (keyId) => `${REVIEW_ID_PREFIX}apikey-${keyId.replace(/^key_docs/, '').toLowerCase()}`,
  })) {
    push(`apiKeys/${key.id}`, key.data)
  }
  const sourdough = idMap.products?.sourdough
  if (sourdough) {
    push(
      `hosts/${hostId}/orders/${REVIEW_ID_PREFIX}order-chargeback`,
      chargebackOrder({ number: 1039, nowMs, productId: sourdough, productName: 'Sourdough loaf', unitAmountCents: 900 }),
    )
  }
  for (const row of aiMemoryFixtures({ nowMs, idFor: reviewId })) push(`hosts/${hostId}/aiMemory/${row.id}`, row.data)
  const profile = businessProfileFixtures({
    at,
    whatYouDo: 'A neighborhood bakery and cafe baking sourdough, pastries and celebration cakes every morning',
    services: ['Sourdough loaves', 'Morning pastries', 'Custom celebration cakes', 'Catering and wholesale'],
    audience: 'Neighbors who want fresh bread, offices ordering breakfast, and families planning a celebration',
    serviceArea: 'Portland, Oregon',
  })
  push(`hosts/${hostId}/businessProfile/profile`, profile.profile)
  push(`orgs/${orgId}/businessProfile/defaults`, profile.defaults)

  // ── The sibling sites ───────────────────────────────────────────────────
  if (siblings) {
    for (const site of JUNIPER.siblings) {
      const homeId = `${REVIEW_ID_PREFIX}home`
      push(
        `hosts/${site.hostId}`,
        {
          approvedImageHosts: arrayUnion('picsum.photos', 'fastly.picsum.photos'),
          screens: { [homeId]: '/' },
          ...(site.maintenance ? { maintenance: true } : {}),
        },
        { existing: true },
      )
      push(
        `users/${ownerUid}/hostMemberships/${site.hostId}`,
        { searchTokens: hostMembershipSearchTokens(site), hasCustomDomain: false, updatedAt: at },
        { existing: true },
      )
      docs.push(
        ...pageScreen({ hostId: site.hostId, screenId: homeId, name: 'Home', slug: '/', at, sections: site.sections }),
      )
    }
  }
  // ── The live sites' caches ──────────────────────────────────────────────
  // The published site caches its pages and rule sets for an hour, and a
  // direct write announces nothing. A site-wide publish outbox entry is what
  // a console save leaves when its tab cannot announce the drop itself
  // (`site-wide-outbox.ts`); the console's drain fires it within fifteen
  // minutes and deletes it.
  for (const id of [hostId, ...(siblings ? JUNIPER.siblings.map((site) => site.hostId) : [])]) {
    push(`publishOutbox/${REVIEW_ID_PREFIX}outbox-${id}`, {
      hostId: id,
      paths: ['/'],
      createdAt: at,
      attempts: 0,
      entireHost: true,
    })
  }
  return docs
}

/* ------------------------------------------------------------------------ */
/* The plan                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Every document the seed writes, final.
 *
 * @param {{
 *   records: Array<{ path: string, data: object, source: string }>,
 *   target: { orgId: string, hostId: string, orgSlug: string, ownerUid: string, ownerName: string },
 *   nowMs: number,
 *   siblings?: boolean,
 * }} input
 * @returns {{ docs: Array<{ path: string, data: Record<string, any>, existing?: boolean }>,
 *   skipped: Array<{ path: string, source: string, reason: string }> }}
 */
export function buildReviewOrgPlan({ records, target, nowMs, siblings = false }) {
  const skipped = []
  const kept = []
  for (const record of records) {
    const verdict = classifyRecord(record)
    if (verdict.keep) kept.push({ ...record, data: verdict.data })
    else skipped.push({ path: record.path, source: record.source, reason: verdict.reason })
  }
  const idMap = buildIdMap(kept)

  /** @type {Map<string, { path: string, data: Record<string, any>, existing?: boolean }>} */
  const byPath = new Map()
  const add = ({ path, data, existing }) => {
    const prior = byPath.get(path)
    byPath.set(path, {
      path,
      data: prior ? deepMerge(prior.data, data) : data,
      ...((prior?.existing ?? existing) ? { existing: true } : {}),
    })
  }

  for (const record of kept) {
    const path = remapPath(record.path, idMap, target)
    const segments = path.split('/')
    const collection = segments[segments.length - 2]
    let data = remapReferences(record.data, idMap)
    data = mapStrings(data, (text) => renameText(text, target))
    // The notification deep link to a submission names it by id.
    if (typeof data.link === 'string') {
      data.link = data.link.replace(/submission=([^&]+)/, (match, id) =>
        idMap.formSubmissions?.[id] ? `submission=${idMap.formSubmissions[id]}` : match,
      )
    }
    data = disarm(collection, data, nowMs)
    // A root document (the host) and a keyed one (a day, a singleton) are not this seed's to claim.
    const id = segments[segments.length - 1]
    if (id.startsWith(REVIEW_ID_PREFIX)) data = { ...data, seedSource: REVIEW_SEED_SOURCE }
    add({ path, data, existing: segments.length === 2 })
  }

  for (const doc of ownDocuments({ target, nowMs, idMap, siblings })) {
    const id = doc.path.split('/').pop()
    add({ ...doc, data: id.startsWith(REVIEW_ID_PREFIX) ? { ...doc.data, seedSource: REVIEW_SEED_SOURCE } : doc.data })
  }

  const dataOf = new Map([...byPath].map(([path, doc]) => [path, doc.data]))
  const docs = [...byPath.values()].map((doc) => ({ ...doc, data: withListFields(doc.path, doc.data, dataOf) }))
  docs.sort((left, right) => left.path.localeCompare(right.path))
  return { docs, skipped }
}

/* ------------------------------------------------------------------------ */
/* The safety check                                                         */
/* ------------------------------------------------------------------------ */

/** Collections no seed may write in a live org. */
const FORBIDDEN_COLLECTIONS = new Set([
  'members',
  'invites',
  'counters',
  'usage',
  'billing',
  'subscriptions',
  'entitlements',
  'credits',
  'aiCredits',
  'aiUsage',
  'quotas',
  'legalAcceptances',
])
/** Fields no seed may write on the org or a host. */
const FORBIDDEN_ROOT_FIELDS = [
  'plan',
  'subscription',
  'entitlements',
  'stripeCustomerId',
  'billing',
  'seatAddons',
  'releaseFlags',
  'ownerUid',
  'memberRoles',
  'suspended',
  'cname',
]

/**
 * Throws unless every document stays inside the review org, its sites, the
 * owner's own rows and the org's API keys; writes nothing billing-shaped;
 * names only the owner; and prints only `example.com`/`example.org` addresses.
 *
 * @param {Array<{ path: string, data: Record<string, any> }>} docs
 * @param {{ orgId: string, hostIds: string[], ownerUid: string }} scope
 */
export function assertPlanSafe(docs, { orgId, hostIds, ownerUid }) {
  const problems = []
  const hosts = new Set(hostIds)
  for (const { path, data } of docs) {
    const segments = path.split('/')
    const [root, rootId] = segments
    const inScope =
      (root === 'orgs' && rootId === orgId) ||
      (root === 'hosts' && hosts.has(rootId)) ||
      (root === 'users' && rootId === ownerUid && ['orgs', 'hostMemberships', 'notifications'].includes(segments[2])) ||
      (root === 'apiKeys' && data.orgId === orgId && rootId.startsWith(REVIEW_ID_PREFIX)) ||
      (root === 'publishOutbox' && hosts.has(data.hostId) && rootId.startsWith(REVIEW_ID_PREFIX))
    if (!inScope) problems.push(`${path}: outside the review org`)
    // A root's own `members` is its authorization roster; a list's members are an audience.
    if (FORBIDDEN_COLLECTIONS.has(segments[2]) && root !== 'users') {
      problems.push(`${path}: ${segments[2]} is not a seed's to write`)
    }
    for (let at = 4; at < segments.length; at += 2) {
      if (FORBIDDEN_COLLECTIONS.has(segments[at]) && segments[at] !== 'members') {
        problems.push(`${path}: ${segments[at]} is not a seed's to write`)
      }
    }
    if (segments.length === 2) {
      for (const field of FORBIDDEN_ROOT_FIELDS) {
        if (data[field] !== undefined) problems.push(`${path}: writes ${field}`)
      }
    }
    const id = segments[segments.length - 1]
    const keyed = KEYED_COLLECTIONS.has(segments[segments.length - 2]) || segments[segments.length - 2] === 'screenAnalytics'
    const existing = segments.length === 2 || ['orgs', 'hostMemberships'].includes(segments[2]) || id.startsWith('seed-')
    if (!keyed && !existing) problems.push(`${path}: a new document without a seed- id`)
    for (const email of emailsIn(data)) {
      const domain = email.split('@').pop()
      if (!ALLOWED_EMAIL_DOMAIN.test(domain)) problems.push(`${path}: address ${email}`)
    }
    for (const field of ['uid', 'byUid', 'ownerUid', 'assigneeUid', 'createdByUid', 'createdBy', 'sentByUid', 'invitedBy', 'actorId', 'uploadedBy']) {
      const value = data[field]
      if (typeof value === 'string' && value && value !== ownerUid) problems.push(`${path}: ${field} names ${value}`)
    }
    if (segments[2] === 'campaigns' && segments.length === 4 && data.status === 'scheduled') {
      if (typeof data.sendAtMs === 'number' && data.sendAtMs < Date.now() + 365 * DAY_MS) {
        problems.push(`${path}: a scheduled send that will come due`)
      }
    }
    if (segments[2] === 'bookings' && !data.reminderSentAt) problems.push(`${path}: a booking its reminder cron would mail`)
    if (segments[2] === 'crmTasks' && typeof data.reminderSentAtMs !== 'number') {
      problems.push(`${path}: a task its reminder cron would mail`)
    }
    if (segments[2] === 'webhooks' && data.enabled !== false) problems.push(`${path}: an enabled webhook`)
    const text = JSON.stringify(data, (key, value) => (isArrayUnion(value) ? value.__reviewSeedArrayUnion : value))
    if (text.includes('zz-review-')) problems.push(`${path}: an unreplaced placeholder`)
    if (/https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)\b/.test(text)) problems.push(`${path}: a URL on a local machine`)
  }
  if (problems.length) {
    throw new Error(`The review-org plan is unsafe:\n  ${problems.slice(0, 40).join('\n  ')}`)
  }
}

/** Documents per collection (`orgs/*`-relative), for the run's summary. */
export function countByCollection(docs) {
  const counts = {}
  for (const { path } of docs) {
    const segments = path.split('/')
    const key = segments.length === 2 ? segments[0] : segments.filter((_, at) => at % 2 === 0).join('/')
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}
