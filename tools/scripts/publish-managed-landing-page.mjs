#!/usr/bin/env node
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
 * Publishes `/managed` on aglyn.com: the landing page for the Managed offer
 * (a plan plus Site Care, one price), its form, and the campaign both are
 * filed under (AGL-3960).
 *
 *   node tools/scripts/publish-managed-landing-page.mjs           dry run
 *   node tools/scripts/publish-managed-landing-page.mjs --write   publish
 *
 * Reads `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` /
 * `FIREBASE_PRIVATE_KEY` from the environment, then from `.env` and
 * `apps/console/.env.production.local`.
 *
 * ## What it writes, in one batch
 *
 *  - the campaign container "Managed · Events and door to door" at
 *    `orgs/{org}/emailCampaigns/{id}`, declaring the `utm_campaign` label
 *    `managed-2026-10` (`docs/MANAGED_CAMPAIGN_UTM.md` has the per-event
 *    labels added to it before each QR code goes out);
 *  - the form "Managed" at `hosts/{host}/forms/{id}` and its first version,
 *    filed under that campaign, with `marketingOptIn` as its consent field
 *    and lead routing OFF (see "Lead routing" below);
 *  - the screen "Managed" and its first version, filed under the campaign,
 *    in the Landing Pages group, visibility PUBLIC (indexable, in the sitemap);
 *  - the route `managed` in the host's `screens` map, which is what makes the
 *    page reachable at all;
 *  - a site-wide publish outbox entry, which the console's scheduled drain
 *    turns into a tenant revalidate for `/managed`, the sitemap and every
 *    routed page.
 *
 * ## Where the page comes from
 *
 * The node tree is a copy of `/next-client-site`'s live version — the One job
 * landing page skeleton built to the `/product/*` standard: the Product
 * detail hero, the Capabilities band, the How it works band and the Marketing
 * CTA (all reusable components, so they stay in step with every other page
 * that uses them), three deep-dive rows with images, a fair-use list, a
 * prices section, the form and an FAQ. Every node gets a new id. Each slot the
 * copy replaces is found by its section and node names, and its current text
 * is asserted before it changes, so a template that has moved makes the run
 * refuse instead of pouring copy one slot out. After the pour, no text of the
 * template may survive anywhere on the page except what `KEPT_TEXT` names.
 *
 * ## The figures
 *
 * Site Care is `SITE_CARE_ADDON_MONTHLY_USD` ($49, $588 a year on a yearly
 * plan) and Starter is `PLAN_PRICING.starter` ($25, $16 a month billed
 * yearly), from `libs/aglyn/src/lib/app-utils/plan-entitlements.ts`, restated
 * here because a plain script cannot import the TypeScript module; Managed
 * Starter is their sum. Extra time ($79 per started hour) and the project
 * starting points ($249 / $749 / $349) are the 2026-10-19 entry of
 * `docs/DECISION_LOG.md`. `docs/PRICING_SURFACES.md` lists this page, so a
 * change to any of them owes it a republish.
 *
 * ## Lead routing
 *
 * The form is written with `routing.lead: false`. `/api/health/funnel` grades
 * an EXACT count of live lead forms against `AGLYN_FUNNEL_MIN_LEAD_FORMS` on
 * the tenant project (15 on 2026-10-19), so a 16th that routes leads turns the
 * check red until that variable says 16 and the tenant is redeployed — a
 * production config change that waits for the account owner's go. Until then
 * a submission still lands in the Inbox, alerts the site's recipients, files
 * the person as a contact and is credited to the campaign with its UTM
 * labels; it is not yet filed as a CRM lead. The flip is in
 * `docs/MANAGED_CAMPAIGN_UTM.md`.
 *
 * ## Safety
 *
 *  - dry run by default; `--write` is required to write anything;
 *  - refuses, writing nothing, when the route, the form slug or the campaign
 *    name already exists, or when the template does not have the shape the
 *    copy is poured into;
 *  - the revert is one field: delete `screens.<screenId>` from the host
 *    document (the page stops being routed), then drop the cache the same way.
 */

import { config as loadEnv } from 'dotenv'
import { decode, encode } from '@msgpack/msgpack'
import {
  mdiAccountPlusOutline,
  mdiBullhornOutline,
  mdiClockOutline,
  mdiImageOutline,
  mdiTagOutline,
  mdiViewAgendaOutline,
} from '@mdi/js'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore'
import { nameSearchKey, nameSearchTokens, displayNameSearchFields } from './lib/name-search-tokens.mjs'
import { createResourceUid } from './lib/resource-uid.mjs'
import { formListFields } from './lib/site-form-list-fields.mjs'

const HOST = 'DXnRbPH4CQ' // aglyn-marketing
const ORG = 'jWmGooWE3L' // Aglyn's own org
const TEMPLATE_SCREEN = '8NLz1g5vxG' // /next-client-site
const LANDING_PAGES_GROUP = 'VyIXiRVhaz'
const PRICING_SCREEN = 'v0clP6xQl-'
const ROUTE = 'managed'
const PUBLIC_VISIBILITY = 2

const SITE_CARE_MONTHLY_USD = 49
const SITE_CARE_YEARLY_USD = SITE_CARE_MONTHLY_USD * 12
const STARTER_MONTHLY_USD = 25
const STARTER_YEARLY_PER_MONTH_USD = 16
const MANAGED_MONTHLY_USD = STARTER_MONTHLY_USD + SITE_CARE_MONTHLY_USD
const MANAGED_YEARLY_PER_MONTH_USD = STARTER_YEARLY_PER_MONTH_USD + SITE_CARE_MONTHLY_USD
const EXTRA_HOUR_USD = 79
const LANDING_PAGE_FROM_USD = 249
const REDESIGN_FROM_USD = 749
const BRAND_FROM_USD = 349

const CAMPAIGN = {
  name: 'Managed · Events and door to door',
  utmCampaigns: ['managed-2026-10'],
  startAtMs: Date.UTC(2026, 9, 19),
}

const FORM_NAME = 'Managed'
const FORM_SLUG = 'managed'
const CONSENT_FIELD = 'marketingOptIn'

const SCREEN = {
  displayName: 'Managed',
  // The page's notes in the console: what it is, and the QR link convention.
  description:
    'Campaign landing page: Managed, a plan plus Site Care at one price. QR links: ' +
    'utm_source=event|door, utm_medium=qr, utm_campaign=<track>-<yyyy-mm-dd> or <town>, each label ' +
    'added to the campaign first. See docs/MANAGED_CAMPAIGN_UTM.md.',
  seo: {
    title: 'Managed websites: built and kept current for you | Aglyn',
    description:
      `Managed is an Aglyn plan with Site Care: our team builds your site and makes your changes ` +
      `every month, within 2 business days. $${MANAGED_MONTHLY_USD} a month, or ` +
      `$${MANAGED_YEARLY_PER_MONTH_USD} a month billed yearly.`,
  },
  versionName: 'Managed landing page (AGL-3960)',
}

const icon = (iconId, iconPath) => ({ iconId, iconPath })

/** Reusable component instances: the whole prop bag, keys asserted equal. */
const INSTANCES = {
  'Product detail hero': {
    eyebrow: 'MANAGED WEBSITES · ONE PRICE',
    headline: 'Your website, built and kept current by our team.',
    lede:
      'Managed is an Aglyn plan with Site Care on top. We build your site, you look it over, and ' +
      'from then on you email us what changed (new hours, prices, photos, a new face on the team) ' +
      `and we make the change for you. One price: $${MANAGED_MONTHLY_USD} a month, or ` +
      `$${MANAGED_YEARLY_PER_MONTH_USD} a month billed yearly.`,
    mockup: 'media:org:jWmGooWE3L/uQc5k6NyKH',
    mockupAlt: 'A small business website live on its own domain, built and published with Aglyn',
    primaryCtaLabel: 'Tell us about your business',
    primaryCtaHref: '#start',
    secondaryCtaLabel: 'See what it costs',
    secondaryCtaHref: '#cost',
  },
  'Capabilities band': {
    eyebrow: 'WHAT WE DO EACH MONTH',
    headline: 'Small changes, made for you, within 2 business days.',
    card1Icon: icon('clock-outline', mdiClockOutline),
    card1Title: 'Hours and holidays',
    card1Body:
      'New opening hours, a holiday closure or a seasonal schedule, updated everywhere it shows on your site.',
    card2Icon: icon('tag-outline', mdiTagOutline),
    card2Title: 'Prices, menus and services',
    card2Body: 'Change a price, add a dish, retire a service. Send us the new list and we update the page.',
    card3Icon: icon('image-outline', mdiImageOutline),
    card3Title: 'Photos',
    card3Body: 'Send us new photos of your work, your shop or your team, and we swap them in or add them.',
    card4Icon: icon('account-plus-outline', mdiAccountPlusOutline),
    card4Title: 'Your team',
    card4Body: 'Someone joins or leaves? We add them to your site or take them off it.',
    card5Icon: icon('bullhorn-outline', mdiBullhornOutline),
    card5Title: 'Banners and announcements',
    card5Body: 'A seasonal offer, an event or a notice across the top of the site, put up and taken down on time.',
    card6Icon: icon('view-agenda-outline', mdiViewAgendaOutline),
    card6Title: 'A new section, a quick fix',
    card6Body: 'A new section on a page you already have, or a typo, a link or a phone number fixed.',
  },
  'How it works band': {
    eyebrow: 'HOW IT STARTS',
    headline: 'We build it. You look. You pay on your phone.',
    step1Title: 'We build it',
    step1Body:
      'Tell us about your business and we build your site first, with your name, your services and your photos.',
    step2Title: 'You look',
    step2Body: 'We walk you through it and make the changes you ask for until it’s right.',
    step3Title: 'You pay on your phone',
    step3Body:
      'Happy with it? You subscribe on your own phone in a secure checkout. We never take your card.',
  },
  'Marketing CTA': {
    headline: 'A website that stays right, without the work.',
    lede: 'One price, our team on your changes, and a site that’s yours.',
    ctaPrimaryLabel: 'Tell us about your business',
    ctaPrimaryLink: '#start',
    secondaryLabel: 'See every plan',
    secondaryLink: '/pricing',
  },
}

/**
 * A deep-dive row: eyebrow, heading, lede, three bullets and an image. `was`
 * is the template heading this section must still carry before it is poured.
 */
const DEEP_DIVES = [
  {
    section: 'Deep-dive · describe it',
    rename: 'Deep-dive · who it is for',
    was: 'Review the plan before anything is built.',
    eyebrow: 'WHO IT IS FOR',
    heading: 'For owners who would rather run the business than the website.',
    lede:
      'Managed fits a local business that needs a good site on its own domain and changes it a few ' +
      'times a month, but has nobody whose job is the website.',
    bullets: [
      [
        'Trades and home services',
        'Plumbers, roofers, landscapers and contractors whose service areas, prices and photos change with the season.',
      ],
      [
        'Shops, studios and restaurants',
        'Hours, menus, class times and holiday notices that have to be right the day they change.',
      ],
      [
        'Owners short on time',
        'You already have a business to run. One email to us replaces an evening with a website builder.',
      ],
    ],
    image: ['media:org:jWmGooWE3L/v2sbemHaD1', 'A bakery website live on its own domain, built with Aglyn'],
  },
  {
    section: 'Deep-dive · finish it',
    rename: 'Deep-dive · how a change gets made',
    was: 'Your team’s craft, not a template’s.',
    eyebrow: 'HOW A CHANGE GETS MADE',
    heading: 'Send an email. We take it from there.',
    lede:
      'Email us, or reply to any message from us, and say what to change. Attach photos if there ' +
      'are any. Our team makes the change on your site and keeps a log of the minutes it took.',
    bullets: [
      ['Plain words are enough', 'No logins and no forms to learn. A sentence and a photo is a complete request.'],
      ['Done within 2 business days', 'Each small change is made within 2 business days of your request.'],
      [
        'Still yours to edit',
        'The site and the account are yours. Sign in whenever you like and change anything yourself.',
      ],
    ],
    image: ['media:org:jWmGooWE3L/CXOu4pQyGf', 'Aglyn’s visual editor, where our team makes your changes'],
  },
  {
    section: 'Deep-dive · hand it over',
    rename: 'Deep-dive · bigger jobs',
    was: 'A login for the client, scoped to their site.',
    eyebrow: 'BIGGER JOBS',
    heading: 'Something new? You get a flat price before we start.',
    lede:
      'Site Care keeps the site you have up to date. Anything that adds to it, like a new page, a ' +
      'redesign or brand work, is a project with one price agreed up front, never a running meter.',
    bullets: [
      [`Landing pages from $${LANDING_PAGE_FROM_USD}`, 'A new page for an offer, a service or an event, in your site’s style.'],
      [`Redesigns from $${REDESIGN_FROM_USD}`, 'A new look for one page or the whole site, built on the content you already have.'],
      [`Logo or brand kit from $${BRAND_FROM_USD}`, 'A logo, colors and fonts for your business, applied across your site.'],
    ],
    image: ['media:org:jWmGooWE3L/opiiHe6jgz', 'An outfitter’s website with a shop, live on its own domain'],
  },
]

/** The "Nothing else moves" list, poured as the fair-use section. */
const FAIR_USE = {
  section: 'Nothing else moves',
  rename: 'Fair use',
  was: 'Everything you run today stays where it is.',
  badge: 'Fair use',
  heading: 'About an hour of changes a month, included.',
  lede: 'Site Care is our time, spent on the site you already have. Here’s exactly where the line sits.',
  items: [
    ['About an hour a month', 'Small changes up to about an hour of our work each month. Unused time doesn’t roll over.'],
    [
      'Extra time only with your yes',
      `If a month needs more, we ask first. Extra time is $${EXTRA_HOUR_USD} for each started hour, and only once you’ve said yes.`,
    ],
    [
      'Plan limits still apply',
      'Site Care is our time, not more capacity. A page or a form past your plan’s limit still needs a plan upgrade.',
    ],
  ],
}

/** The plans section, poured as "what it costs"; `#cost` is its anchor. */
const COST = {
  section: 'Plans',
  rename: 'What it costs',
  anchor: 'cost',
  was: 'One client is one site.',
  badge: 'One price',
  heading: `$${MANAGED_MONTHLY_USD} a month. Or $${MANAGED_YEARLY_PER_MONTH_USD} a month, billed yearly.`,
  lede:
    'That’s Managed Starter: Aglyn’s Starter plan and Site Care together, for one site on your own ' +
    'domain. Already on a paid Aglyn plan? Add Site Care to any of them for ' +
    `$${SITE_CARE_MONTHLY_USD} a month, or $${SITE_CARE_YEARLY_USD} a year on yearly billing. No build fee.`,
  primaryCta: ['Tell us about your business', '#start'],
}

const FORM_SECTION = {
  section: 'Form',
  was: 'Draft one of your upcoming clients with us',
  heading: 'Tell us about your business',
  lede: 'Leave your details and we’ll get in touch to talk through your site. There’s no cost to talk, and no obligation.',
  bullets: [
    ['We get in touch', 'Usually within one business day, by phone or email.'],
    ['We build it first', 'You see your finished site before you pay anything.'],
    ['No obligation', 'If it isn’t right for you, you don’t pay.'],
  ],
  submitLabel: 'Get in touch',
  successMessage: 'Thanks. We’ll be in touch, usually within one business day.',
}

/** The form's fields, in order. `like` names the template control cloned. */
const FIELDS = [
  { like: 'name', fieldName: 'name', label: 'Your name', type: 'text', required: true, role: 'name' },
  { like: 'name', fieldName: 'company', label: 'Business name', type: 'text', required: true },
  { like: 'name', fieldName: 'phone', label: 'Phone', type: 'tel', required: true, role: 'phone' },
  { like: 'email', fieldName: 'email', label: 'Email', type: 'email', required: true, role: 'email' },
  { like: 'client', fieldName: 'work', label: 'What does your business do?', multiline: true },
]
const CONSENT_LABEL = 'Send me occasional updates from Aglyn'

const FAQ = [
  [
    'What counts as a small change?',
    'Updating your hours, prices, menu or services, swapping or adding photos, adding or removing a ' +
      'staff member, a seasonal banner, a new section on a page you already have, or fixing a typo, a ' +
      'link or a phone number.',
  ],
  [
    'What if a month needs more than an hour?',
    `We ask before going past it. Extra time is $${EXTRA_HOUR_USD} for each started hour, billed with ` +
      'your next invoice, and only once you’ve said yes. Unused time doesn’t roll over.',
  ],
  [
    'How are bigger jobs priced?',
    'With one flat price agreed before any work starts: landing pages from ' +
      `$${LANDING_PAGE_FROM_USD}, redesigns from $${REDESIGN_FROM_USD}, a logo or brand kit from $${BRAND_FROM_USD}.`,
  ],
  [
    'Can I still edit the site myself?',
    'Yes. The site and the account are yours, and you can sign in and change anything at any time.',
  ],
  [
    'Already on a paid Aglyn plan?',
    `Add Site Care to any paid plan for $${SITE_CARE_MONTHLY_USD} a month, or $${SITE_CARE_YEARLY_USD} a ` +
      'year on yearly billing. It covers every site in your workspace.',
  ],
  [
    'What happens if I stop?',
    'Turning Site Care off takes effect at the end of the period you already paid for, and every ' +
      'change we made stays on your site.',
  ],
]

const STATEMENT = {
  was: 'You don’t have to move a single client',
  text:
    'Most owners don’t want to learn a website builder. They want a site that’s right, and someone ' +
    'to keep it that way. That’s Managed: you run the business, and we keep the website current.',
}

/** Template text that legitimately survives the pour. */
const KEPT_TEXT = new Set(['Frequently asked questions', 'See every plan', 'No obligation'])

const WRITE = process.argv.includes('--write')

loadEnv({ path: '.env', quiet: true })
loadEnv({ path: 'apps/console/.env.production.local', quiet: true })

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY')
  process.exit(1)
}
if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)

/**
 * `nodes` is stored as a plain map or as msgpack bytes. `byteOffset` and
 * `byteLength` always, because firebase-admin hands back pooled Buffers.
 */
const decodeNodes = (raw) =>
  Buffer.isBuffer(raw) ? decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)) : raw
const encodeNodes = (nodes) => Buffer.from(encode(nodes))

const problems = []
const refuse = () => {
  console.error(`REFUSED — nothing written:\n${problems.map((p) => `  • ${p}`).join('\n')}`)
  process.exit(1)
}

// ---- what already exists ---------------------------------------------------
const hostRef = firestore.collection('hosts').doc(HOST)
const host = (await hostRef.get()).data()
if (!host) {
  console.error(`hosts/${HOST} does not exist`)
  process.exit(1)
}
const routes = host.screens ?? {}
const takenBy = Object.entries(routes).find(([, path]) => path === ROUTE)
if (takenBy) problems.push(`/${ROUTE} is already routed to screen ${takenBy[0]}`)

const formsRef = hostRef.collection('forms')
const sameSlug = await formsRef.where('slug', '==', FORM_SLUG).limit(1).get()
if (!sameSlug.empty) problems.push(`a form with slug "${FORM_SLUG}" exists: ${sameSlug.docs[0].id}`)

const campaignsRef = firestore.collection('orgs').doc(ORG).collection('emailCampaigns')
const sameCampaign = await campaignsRef.where('name', '==', CAMPAIGN.name).limit(1).get()
if (!sameCampaign.empty) problems.push(`a campaign named "${CAMPAIGN.name}" exists: ${sameCampaign.docs[0].id}`)
for (const label of CAMPAIGN.utmCampaigns) {
  const claimed = await campaignsRef.where('utmCampaigns', 'array-contains', label).limit(1).get()
  if (!claimed.empty) problems.push(`utm_campaign "${label}" is already declared by ${claimed.docs[0].id}`)
}
if (problems.length) refuse()

// ---- the template ----------------------------------------------------------
const screensRef = hostRef.collection('screens')
const templateScreen = (await screensRef.doc(TEMPLATE_SCREEN).get()).data()
if (!templateScreen?.versionId) {
  console.error(`template screen ${TEMPLATE_SCREEN} has no published version`)
  process.exit(1)
}
const templateVersion = (
  await screensRef.doc(TEMPLATE_SCREEN).collection('versions').doc(templateScreen.versionId).get()
).data()
const source = decodeNodes(templateVersion.nodes)

// Every child a string id, so the copy can re-id the whole map.
for (const node of Object.values(source)) {
  if ((node.nodes ?? []).some((kid) => typeof kid !== 'string')) {
    problems.push(`node ${node.$id} holds its children inline, which this script does not copy`)
  }
}
if (problems.length) refuse()

/**
 * New ids for every node but the root. A form control's parts carry its id
 * plus a suffix (`<id>-label`, `<id>-opt-0-input`), and keep that shape.
 */
const ROOT = '_@_'
const newIds = new Map([[ROOT, ROOT]])
const ids = Object.keys(source)
for (const id of ids) if (id !== ROOT && !newIds.has(id) && !/^.{10}-/.test(id)) newIds.set(id, createResourceUid())
for (const id of ids) {
  if (newIds.has(id)) continue
  const owner = id.slice(0, 10)
  if (!newIds.has(owner)) problems.push(`node ${id} looks suffixed but ${owner} is not a node`)
  else newIds.set(id, `${newIds.get(owner)}${id.slice(10)}`)
}
if (problems.length) refuse()
const remap = (id) => newIds.get(id) ?? id

const nodes = {}
for (const node of Object.values(source)) {
  const copy = structuredClone(node)
  copy.$id = remap(node.$id)
  if (copy.parentId) copy.parentId = remap(copy.parentId)
  if (copy.nodes) copy.nodes = copy.nodes.map(remap)
  nodes[copy.$id] = copy
}

const kids = (node) => (node?.nodes ?? []).map((id) => nodes[id]).filter(Boolean)
const textOf = (node) => (typeof node?.props?.children === 'string' ? node.props.children : null)
const setText = (node, text) => {
  if (node) node.props = { ...node.props, children: text }
}
function descendants(node) {
  const out = []
  const walk = (n) => {
    for (const kid of kids(n)) {
      out.push(kid)
      walk(kid)
    }
  }
  walk(node)
  return out
}
const named = (scope, name) => descendants(scope).filter((n) => n.name === name)
const one = (scope, name, where) => {
  const found = named(scope, name)
  if (found.length !== 1) {
    problems.push(`${where}: expected one "${name}", found ${found.length}`)
    return null
  }
  return found[0]
}
const root = nodes[ROOT]
const section = (name) => {
  const found = kids(root).filter((n) => n.name === name)
  if (found.length !== 1) problems.push(`expected one top-level section "${name}", found ${found.length}`)
  return found[0] ?? null
}
const assertText = (node, expected, where) => {
  if (!node) return false
  const text = textOf(node) ?? ''
  if (!text.startsWith(expected)) {
    problems.push(`${where}: expected text starting "${expected}", found "${text.slice(0, 60)}"`)
    return false
  }
  return true
}
const changes = []

// ---- reusable component instances -----------------------------------------
for (const [name, values] of Object.entries(INSTANCES)) {
  const found = kids(root).filter((n) => n.componentId === 'reusableInstance' && n.props?.name === name)
  if (found.length !== 1) {
    problems.push(`expected one "${name}" instance, found ${found.length}`)
    continue
  }
  const [instance] = found
  const had = Object.keys(instance.props.propValues ?? {}).sort().join(',')
  const has = Object.keys(values).sort().join(',')
  if (had !== has) {
    problems.push(`"${name}" props are [${had}], the copy has [${has}]`)
    continue
  }
  instance.props = { ...instance.props, propValues: structuredClone(values) }
  changes.push(`${name}: ${values.headline}`)
}

// ---- statement ------------------------------------------------------------
{
  const statement = section('Statement')
  const line = statement && one(statement, 'Statement', 'Statement')
  if (assertText(line, STATEMENT.was, 'Statement')) setText(line, STATEMENT.text)
}

/** Pours [title, body] pairs into a list of "Bullet · …" stacks. */
function pourBullets(list, pairs, where) {
  const bullets = kids(list)
  if (bullets.length !== pairs.length) {
    problems.push(`${where}: ${bullets.length} bullets in the template, ${pairs.length} in the copy`)
    return
  }
  bullets.forEach((bullet, at) => {
    const [title, body] = pairs[at]
    const titleNode = one(bullet, 'Title', `${where} bullet ${at + 1}`)
    const bodyNode = one(bullet, 'Body', `${where} bullet ${at + 1}`)
    if (!titleNode || !bodyNode) return
    setText(titleNode, title)
    setText(bodyNode, body)
    bullet.name = `Bullet · ${title}`
  })
}

// ---- deep dives -----------------------------------------------------------
for (const dive of DEEP_DIVES) {
  const sec = section(dive.section)
  if (!sec) continue
  const heading = one(sec, 'Heading', dive.section)
  if (!assertText(heading, dive.was, dive.section)) continue
  setText(one(sec, 'Eyebrow', dive.section), dive.eyebrow)
  setText(heading, dive.heading)
  setText(one(sec, 'Lede', dive.section), dive.lede)
  const list = one(sec, 'Bullets', dive.section)
  if (list) pourBullets(list, dive.bullets, dive.section)
  const image = one(sec, 'Deep-dive image', dive.section)
  if (image) image.props = { ...image.props, src: dive.image[0], alt: dive.image[1] }
  sec.name = dive.rename
  changes.push(`${dive.rename}: ${dive.heading}`)
}

/** A "Section header" stack: badge label, heading, lede. */
function pourHeader(sec, copy, where) {
  const header = one(sec, 'Section header', where)
  if (!header) return null
  const heading = one(header, 'Heading', where)
  if (!assertText(heading, copy.was, where)) return null
  setText(one(header, 'Badge label', where), copy.badge)
  setText(heading, copy.heading)
  setText(one(header, 'Lede', where), copy.lede)
  return header
}

// ---- fair use ------------------------------------------------------------
{
  const sec = section(FAIR_USE.section)
  if (sec && pourHeader(sec, FAIR_USE, FAIR_USE.section)) {
    const items = one(sec, 'Items', FAIR_USE.section)
    if (items) pourBullets(items, FAIR_USE.items, FAIR_USE.section)
    sec.name = FAIR_USE.rename
    sec.props = { ...sec.props, ariaLabel: FAIR_USE.heading }
    changes.push(`${FAIR_USE.rename}: ${FAIR_USE.heading}`)
  }
}

// ---- what it costs --------------------------------------------------------
{
  const sec = section(COST.section)
  const header = sec && pourHeader(sec, COST, COST.section)
  if (header) {
    const [primary, secondary, ...extra] = kids(one(header, 'CTAs', COST.section))
    if (!primary || !secondary || extra.length) problems.push(`${COST.section}: expected two CTA buttons`)
    else if (secondary.props?.screenId !== PRICING_SCREEN) {
      problems.push(`${COST.section}: the second CTA does not link the pricing page`)
    } else {
      const [label, href] = COST.primaryCta
      primary.props = { ...primary.props, children: label, href }
      primary.name = label
    }
    sec.name = COST.rename
    sec.props = { ...sec.props, id: COST.anchor, ariaLabel: 'What it costs' }
    changes.push(`${COST.rename} (#${COST.anchor}): ${COST.heading}`)
  }
}

// ---- the form ------------------------------------------------------------
const formId = createResourceUid()
const formVersionId = createResourceUid()
let formNodeId = null
{
  const sec = section(FORM_SECTION.section)
  const heading = sec && one(sec, 'Heading', 'Form')
  if (assertText(heading, FORM_SECTION.was, 'Form')) {
    setText(heading, FORM_SECTION.heading)
    setText(one(sec, 'Lede', 'Form'), FORM_SECTION.lede)
    const next = one(sec, 'What happens next', 'Form')
    if (next) pourBullets(next, FORM_SECTION.bullets, 'Form')
    sec.props = { ...sec.props, ariaLabel: FORM_SECTION.heading }

    const forms = descendants(sec).filter((n) => n.componentId === 'form')
    if (forms.length !== 1) problems.push(`Form: expected one form node, found ${forms.length}`)
    else {
      const [form] = forms
      formNodeId = form.$id
      // The template's controls, by the input name each one carries.
      const controls = new Map()
      for (const control of kids(form)) {
        const input = descendants(control).find((n) => n.props?.name)
        if (input) controls.set(input.props.name, control)
      }
      for (const name of ['name', 'email', 'client', CONSENT_FIELD]) {
        if (!controls.has(name)) problems.push(`Form: the template has no "${name}" field`)
      }
      if (!problems.length) {
        const dropped = descendants(form)
        for (const node of dropped) delete nodes[node.$id]
        /** A copy of one template control, re-id'd, for one field. */
        const cloneControl = (likeName) => {
          const like = source[[...newIds].find(([, now]) => now === controls.get(likeName).$id)[0]]
          const id = createResourceUid()
          const parts = [like, ...Object.values(source).filter((n) => n.$id.startsWith(`${like.$id}-`))]
          const made = {}
          for (const part of parts) {
            const copy = structuredClone(part)
            copy.$id = part.$id === like.$id ? id : `${id}${part.$id.slice(10)}`
            copy.parentId = part.$id === like.$id ? form.$id : `${id}${part.parentId.slice(10)}`
            if (copy.nodes) copy.nodes = copy.nodes.map((kid) => `${id}${kid.slice(10)}`)
            made[copy.$id] = copy
          }
          return { id, made }
        }
        const order = []
        for (const field of FIELDS) {
          const { id, made } = cloneControl(field.like)
          const label = made[`${id}-label`]
          const input = made[`${id}-input`]
          if (!label || !input) {
            problems.push(`Form: the "${field.like}" control is not a label and an input`)
            break
          }
          label.props = { ...label.props, children: field.label }
          input.props = {
            name: field.fieldName,
            type: field.type ?? 'text',
            ...(field.required ? { required: true } : {}),
            fullWidth: true,
            ...(field.multiline ? { multiline: true, minRows: 3 } : {}),
          }
          made[id].props = { fullWidth: true, ...(field.required ? { required: true } : {}) }
          Object.assign(nodes, made)
          order.push(id)
        }
        const consent = cloneControl(CONSENT_FIELD)
        const consentLabel = consent.made[`${consent.id}-opt-0`]
        if (!consentLabel) problems.push('Form: the consent control has no option label')
        else consentLabel.props = { ...consentLabel.props, label: CONSENT_LABEL }
        Object.assign(nodes, consent.made)
        order.push(consent.id)
        form.nodes = order
        form.props = {
          ...form.props,
          formName: FORM_NAME,
          submitLabel: FORM_SECTION.submitLabel,
          successMessage: FORM_SECTION.successMessage,
          formId,
        }
        changes.push(
          `Form ${formId}: ${FIELDS.map((f) => `${f.label}${f.required ? '*' : ''}`).join(', ')}, ` +
            `"${CONSENT_LABEL}" → "${FORM_SECTION.submitLabel}"`,
        )
      }
    }
  }
}

// ---- FAQ -----------------------------------------------------------------
{
  const sec = section('FAQ')
  const list = sec && one(sec, 'Questions', 'FAQ')
  const items = kids(list)
  if (!items.length) problems.push('FAQ: no questions in the template')
  else {
    // One more accordion than the template holds: a re-id'd copy of its last.
    while (items.length < FAQ.length) {
      const last = items[items.length - 1]
      const map = new Map()
      for (const node of [last, ...descendants(last)]) map.set(node.$id, createResourceUid())
      for (const node of [last, ...descendants(last)]) {
        const copy = structuredClone(node)
        copy.$id = map.get(node.$id)
        copy.parentId = map.get(node.parentId) ?? node.parentId
        if (copy.nodes) copy.nodes = copy.nodes.map((id) => map.get(id))
        nodes[copy.$id] = copy
      }
      list.nodes = [...list.nodes, map.get(last.$id)]
      items.push(nodes[map.get(last.$id)])
    }
    if (items.length !== FAQ.length) problems.push(`FAQ: ${items.length} questions, ${FAQ.length} in the copy`)
    else {
      items.forEach((item, at) => {
        const [summary, details] = kids(item)
        const answer = kids(details)[0]
        if (summary?.componentId !== 'muiAccordionSummary' || !answer) {
          problems.push(`FAQ item ${at + 1} is not a summary and an answer`)
          return
        }
        setText(summary, FAQ[at][0])
        setText(answer, FAQ[at][1])
      })
      changes.push(`FAQ: ${FAQ.map(([q]) => q).join(' / ')}`)
    }
  }
}
if (problems.length) refuse()

// ---- nothing of the template survives ---------------------------------------
const templateTexts = new Set(Object.values(source).map(textOf).filter(Boolean))
for (const node of Object.values(nodes)) {
  const text = textOf(node)
  if (text && templateTexts.has(text) && !KEPT_TEXT.has(text)) {
    problems.push(`node ${node.$id} (${node.name ?? node.componentId}) still reads "${text.slice(0, 60)}"`)
  }
  for (const value of Object.values(node.props ?? {})) {
    if (typeof value === 'string' && /onejob|next-client|agenc/i.test(value)) {
      problems.push(`node ${node.$id} still carries "${value.slice(0, 60)}"`)
    }
  }
}
// Every node reachable from the root, and nothing else.
const reachable = new Set([ROOT, ...descendants(root).map((n) => n.$id)])
for (const id of Object.keys(nodes)) if (!reachable.has(id)) problems.push(`node ${id} is not reachable`)
if (problems.length) refuse()

// ---- the form document -----------------------------------------------------
/** The form's own tree: the placed subtree, rooted, with the root unparented. */
const formNodes = {}
for (const node of [nodes[formNodeId], ...descendants(nodes[formNodeId])]) {
  formNodes[node.$id] = structuredClone(node)
}
formNodes[formNodeId].parentId = null
const fieldDecls = [
  ...FIELDS.map((field) => ({
    fieldName: field.fieldName,
    label: field.label,
    fieldType: field.multiline ? 'textarea' : field.type === 'email' ? 'email' : 'text',
    ...(field.required ? { required: true } : {}),
    ...(field.role ? { role: field.role } : {}),
  })),
  { fieldName: CONSENT_FIELD, label: CONSENT_LABEL, fieldType: 'checkbox', options: ['Yes'] },
]

// ---- the rest of the plan ----------------------------------------------------
const campaignId = createResourceUid()
const screenId = createResourceUid()
const versionId = createResourceUid()
const outboxId = createResourceUid()
const groupSiblings = await screensRef.where('parentId', '==', LANDING_PAGES_GROUP).get()
const order = Math.max(-1, ...groupSiblings.docs.map((d) => Number(d.get('order') ?? 0))) + 1
const templateCampaign = (await campaignsRef.doc(templateScreen.campaignIds?.[0] ?? '-').get()).data()
const createdBy = templateScreen.createdBy

const printTree = (node, depth = 0) => {
  const text = textOf(node)
  const pv = node.props?.propValues
  const line =
    `${'  '.repeat(depth)}${node.name ?? node.props?.name ?? node.componentId}` +
    (text ? `: ${text}` : '') +
    (node.props?.src ? ` [${node.props.src}]` : '') +
    (node.props?.href ? ` → ${node.props.href}` : '') +
    (node.props?.label ? ` (${node.props.label})` : '')
  console.log(line)
  if (pv) {
    for (const [key, value] of Object.entries(pv)) {
      console.log(`${'  '.repeat(depth + 1)}${key}: ${typeof value === 'string' ? value : value.iconId}`)
    }
  }
  for (const kid of kids(node)) printTree(kid, depth + 1)
}

console.log(`/${ROUTE} → hosts/${HOST}/screens/${screenId} (version ${versionId})`)
console.log(`  copied from /next-client-site ${TEMPLATE_SCREEN} version ${templateScreen.versionId}`)
console.log(`  group ${LANDING_PAGES_GROUP} order ${order}, visibility PUBLIC, layout ${templateScreen.layoutId}`)
console.log(`  seo: ${SCREEN.seo.title} | ${SCREEN.seo.description}`)
console.log(`campaign orgs/${ORG}/emailCampaigns/${campaignId}: ${CAMPAIGN.name}, utm ${CAMPAIGN.utmCampaigns}`)
console.log(`form hosts/${HOST}/forms/${formId} (version ${formVersionId}): lead routing OFF, consent ${CONSENT_FIELD}`)
console.log(`outbox publishOutbox/${outboxId}: /${ROUTE}, entire host`)
for (const line of changes) console.log(`  + ${line}`)
console.log('\nThe page, in document order:')
printTree(root)

if (!WRITE) {
  console.log(`\nDry run. ${Object.keys(nodes).length} nodes planned. Pass --write to publish.`)
  process.exit(0)
}

const now = FieldValue.serverTimestamp()
const batch = firestore.batch()
batch.create(campaignsRef.doc(campaignId), {
  name: CAMPAIGN.name,
  nameLower: nameSearchKey(CAMPAIGN.name),
  nameTokens: nameSearchTokens(CAMPAIGN.name),
  startAtMs: CAMPAIGN.startAtMs,
  listIds: [],
  visibleTo: ['org'],
  utmCampaigns: CAMPAIGN.utmCampaigns,
  createdAtMs: Date.now(),
  createdBy: templateCampaign?.createdBy ?? createdBy,
})
batch.create(formsRef.doc(formId), {
  displayName: FORM_NAME,
  slug: FORM_SLUG,
  fields: fieldDecls,
  rootId: formNodeId,
  nodes: encodeNodes(formNodes),
  consentFieldName: CONSENT_FIELD,
  campaignIds: [campaignId],
  inCampaign: true,
  ...formListFields({ id: formId, displayName: FORM_NAME, slug: FORM_SLUG }),
  retired: false,
  routing: { lead: false },
  versionId: formVersionId,
  createdAt: now,
  createdBy,
  updatedAt: now,
})
batch.create(formsRef.doc(formId).collection('versions').doc(formVersionId), {
  formId,
  hostId: HOST,
  displayName: 'Managed landing page form (AGL-3960)',
  rootId: formNodeId,
  nodes: encodeNodes(formNodes),
  createdAt: now,
  createdBy,
  updatedAt: now,
})
batch.create(screensRef.doc(screenId).collection('versions').doc(versionId), {
  screenId,
  hostId: HOST,
  layoutId: templateScreen.layoutId,
  displayName: SCREEN.versionName,
  nodes: encodeNodes(nodes),
  createdAt: now,
  createdBy,
  updatedAt: now,
})
batch.create(screensRef.doc(screenId), {
  displayName: SCREEN.displayName,
  ...displayNameSearchFields(SCREEN.displayName),
  slug: ROUTE,
  description: SCREEN.description,
  layoutId: templateScreen.layoutId,
  seo: SCREEN.seo,
  campaignIds: [campaignId],
  parentId: LANDING_PAGES_GROUP,
  order,
  visibility: PUBLIC_VISIBILITY,
  versionId,
  publishedAt: now,
  deletedAt: null,
  createdAt: now,
  createdBy,
  updatedAt: now,
})
batch.update(hostRef, new FieldPath('screens', screenId), ROUTE)
batch.create(firestore.collection('publishOutbox').doc(outboxId), {
  hostId: HOST,
  paths: [`/${ROUTE}`],
  createdAt: now,
  attempts: 0,
  entireHost: true,
})
await batch.commit()

console.log(`\nPublished /${ROUTE}: screen ${screenId}, version ${versionId}.`)
console.log(`Campaign ${campaignId}, form ${formId} (version ${formVersionId}), outbox ${outboxId}.`)
console.log(`Revert: delete hosts/${HOST}.screens.${screenId}, then add a publishOutbox entry for the host.`)
