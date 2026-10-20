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
 * Republishes `/managed` on aglyn.com with no price on it, and with each
 * deep-dive row whose picture is a product film's poster frame playing that
 * film (AGL-3998).
 *
 *   node tools/scripts/republish-managed-landing-page.mjs [--dry-run]
 *       dry run, the default: prints every changed node before and after
 *   node tools/scripts/republish-managed-landing-page.mjs --write --expect-live=<versionId>
 *       publishes, only if the live version is still the one the dry run read
 *
 * Reads `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` /
 * `FIREBASE_PRIVATE_KEY` from the environment, then from the repo's `.env`
 * and `apps/console/.env.production.local`.
 *
 * `publish-managed-landing-page.mjs` wrote the page (AGL-3960) and refuses to
 * run once `/managed` is routed, so this is the change to the live page, made
 * to the screen's stored node map as a new version. Prices are published on
 * `/pricing`, and only there. The changes, and nothing else:
 *
 *  1. the hero's lede says one price covers both, monthly or yearly, with no
 *     build fee, in place of the two monthly figures. Its second button led
 *     to the prices section; it reads "See what’s included" and leads to the
 *     fair-use list, which takes the `included` anchor. Its picture was film
 *     C's poster frame, caption and all; the hero's media slot is the
 *     component's image (an instance passes it only a picture, and the
 *     component is not edited here), so it shows `HERO_MOCKUP` instead: a
 *     small business's site from the org's media library, captioned by
 *     nothing, which the run refuses if the library tags it a film poster;
 *  2. the prices section ("What it costs", `#cost`) goes, with everything in
 *     it: it stated the price and nothing else. Its two buttons are the
 *     page's own twice over (the form, and every plan in the closing band),
 *     so nothing on the page is left without a way on;
 *  3. the form's section takes the background the prices section had, and
 *     the FAQ's section takes the white the form's had, so the bands still
 *     alternate instead of the How it works band, the form and the FAQ
 *     running together;
 *  4. the bigger-jobs bullets name each job without a starting price;
 *  5. the fair-use line and the FAQ answer on extra time say we ask first and
 *     bill only after a yes; the FAQ answer on bigger jobs says one flat price
 *     agreed before work starts; the FAQ answer for a paid plan says Site Care
 *     adds on with monthly or yearly billing;
 *  6. the screen's SEO description, which the page also gives as its Open
 *     Graph and X description, ends on one price for both, with no build fee;
 *  7. each deep-dive picture that is a product film's poster frame in the
 *     org's media library (tagged `video` and `poster` there) is replaced by
 *     the film, a `video` node made the way the film band makes it and read
 *     from a live page that plays it (`lib/marketing-film.mjs`). It keeps the
 *     picture's place and look in the row, and clips the player to the
 *     picture's corners as the band does. `FILMS` names the page each film is
 *     read from, and the run refuses on a poster it does not name;
 *  8. the three deep-dive sections' accessible names were still the
 *     template's ("Deep-dive · describe it", …); each becomes its heading, as
 *     the fair-use and form sections' are.
 *
 * Each value is checked against its current one before it changes. A value
 * already carrying the new one is left alone, so a re-run is a no-op. After
 * the edits, no text on the page and nothing in its SEO fields may state a
 * dollar figure, or the run refuses.
 *
 * None of the nodes this touches sits in a reusable component, and the
 * script refuses if one does. The hero is a component INSTANCE: its
 * `propValues` are this page's own words for it, and the component's
 * definition is untouched. So are the form and its version, the campaign,
 * lead routing, the route, the PUBLIC visibility and the sitemap.
 *
 * Safety:
 *  - dry run by default. `--write` also needs `--expect-live=<versionId>`,
 *    the live version the dry run printed. The pointer and the SEO
 *    description are re-read inside the write's transaction, and the run
 *    refuses if a peer has published since;
 *  - before writing, the live screen and version documents are backed up to
 *    `.scratch/managed-backup-<ISO>.json` (untracked);
 *  - the new version is diffed against the live one key by key, and the run
 *    refuses unless the only nodes that differ, appear or go are the ones
 *    listed above;
 *  - one transaction writes a NEW version, moves the screen's `versionId` to
 *    it with the new SEO description, and adds a `publishOutbox` entry for
 *    `/managed`. That is the same announce the Besigner's publish leaves, and
 *    the console's drain turns it into the tenant revalidate. The previous
 *    version stays in history as the revert path, printed at the end.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { decode, encode } from '@msgpack/msgpack'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { readFilmVideo } from './lib/marketing-film.mjs'
import { createResourceUid } from './lib/resource-uid.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const HOST = 'DXnRbPH4CQ' // aglyn-marketing
const ORG = 'jWmGooWE3L' // Aglyn's own org
const SCREEN = 'qnuMY13VsS' // /managed
const ROUTE = '/managed'
const HERO_COMPONENT = 'T-RdDkvVLW' // Product detail hero

const VERSION_NAME = 'No prices; films where their posters were; a site in the hero; FAQ band (AGL-3998)'

/** A dollar figure, which nothing on the page may state once this has run. */
const FIGURE = /\$\s?\d/

// ---- what the page says now, and what it will say ---------------------------
const INCLUDED_ANCHOR = 'included'
const HERO_LEDE_KEPT =
  'Managed is an Aglyn plan with Site Care on top. We build your site, you look it over, and ' +
  'from then on you email us what changed (new hours, prices, photos, a new face on the team) ' +
  'and we make the change for you.'
/** The hero instance's values that change, `[prop, from, to]`. */
const HERO = [
  [
    'lede',
    `${HERO_LEDE_KEPT} One price: $74 a month, or $65 a month billed yearly.`,
    `${HERO_LEDE_KEPT} One price covers both, monthly or yearly, with no build fee.`,
  ],
  ['secondaryCtaLabel', 'See what it costs', 'See what’s included'],
  ['secondaryCtaHref', '#cost', `#${INCLUDED_ANCHOR}`],
  ['mockup', `media:org:${ORG}/uQc5k6NyKH`, `media:org:${ORG}/DJdz0ISx5R`], // film C's poster → a shop's site
]
/** The hero's picture once this has run: Northwind's storefront, `commerce-storefront.png`. */
const HERO_MOCKUP = HERO.find(([key]) => key === 'mockup')[2]

const SEO_KEPT =
  'Managed is an Aglyn plan with Site Care: our team builds your site and makes your changes ' +
  'every month, within 2 business days.'
const SEO_FROM = `${SEO_KEPT} $74 a month, or $65 a month billed yearly.`
const SEO_TO = `${SEO_KEPT} One price covers both, with no build fee.`

/** The prices section, which goes. */
const COST = {
  section: 'What it costs',
  anchor: 'cost',
  heading: '$74 a month. Or $65 a month, billed yearly.',
}
const FAIR_USE_SECTION = 'Fair use'
/** The form's section, which takes the prices section's background; the FAQ's takes the form's. */
const FORM_SECTION = { section: 'Form', from: 'background.paper', to: 'surface.main' }
const FAQ_SECTION = { section: 'FAQ', from: 'background.default', to: 'background.paper' }

/** The bigger-jobs bullets: each title, and its bullet's name with it. */
const BIGGER_JOBS = {
  section: 'Deep-dive · bigger jobs',
  titles: [
    ['Landing pages from $249', 'Landing pages'],
    ['Redesigns from $749', 'Redesigns'],
    ['Logo or brand kit from $349', 'Logo or brand kit'],
  ],
}

/** Sentences that change, each found by its words inside its section. */
const SENTENCES = [
  {
    section: FAIR_USE_SECTION,
    where: 'fair-use line "Extra time only with your yes"',
    from:
      'If a month needs more, we ask first. Extra time is $79 for each started hour, and only ' +
      'once you’ve said yes.',
    to: 'If a month needs more, we ask first. Extra time is billed only once you’ve said yes.',
  },
  {
    section: 'FAQ',
    question: 'What if a month needs more than an hour?',
    from:
      'We ask before going past it. Extra time is $79 for each started hour, billed with your next ' +
      'invoice, and only once you’ve said yes. Unused time doesn’t roll over.',
    to:
      'We ask before going past it. Extra time is billed with your next invoice, and only once ' +
      'you’ve said yes. Unused time doesn’t roll over.',
  },
  {
    section: 'FAQ',
    question: 'How are bigger jobs priced?',
    from:
      'With one flat price agreed before any work starts: landing pages from $249, redesigns from ' +
      '$749, a logo or brand kit from $349.',
    to: 'With one flat price for the whole job, agreed before any work starts.',
  },
  {
    section: 'FAQ',
    question: 'Already on a paid Aglyn plan?',
    from:
      'Add Site Care to any paid plan for $49 a month, or $588 a year on yearly billing. It covers ' +
      'every site in your workspace.',
    to: 'Add Site Care to any paid plan, on monthly or yearly billing. It covers every site in your workspace.',
  },
]

/** The deep-dive sections, and the template's accessible name each still carries. */
const DEEP_DIVES = [
  ['Deep-dive · who it is for', 'Deep-dive · describe it'],
  ['Deep-dive · how a change gets made', 'Deep-dive · finish it'],
  ['Deep-dive · bigger jobs', 'Deep-dive · hand it over'],
]
const DEEP_DIVE_IMAGE = 'Deep-dive image'
const DEEP_DIVE_VIDEO = 'Deep-dive video'

/** Each film a deep-dive picture may be the poster frame of: the live page that plays it. */
const FILMS = new Map([
  [`media:org:${ORG}/v2sbemHaD1`, { screen: '24LtzlsGi4', route: '/product/ai' }], // film A
  [`media:org:${ORG}/opiiHe6jgz`, { screen: 'o1Q1hKCS-O', route: '/product/besigner' }], // film D
])

// ---- arguments ---------------------------------------------------------------
const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const expectLive = args.find((arg) => arg.startsWith('--expect-live='))?.slice('--expect-live='.length)
if (WRITE && args.includes('--dry-run')) {
  console.error('Pass --write or --dry-run, not both.')
  process.exit(1)
}
if (WRITE && !expectLive) {
  console.error('--write needs --expect-live=<versionId>: the live version the dry run printed.')
  process.exit(1)
}

loadEnv({ path: join(ROOT, '.env'), quiet: true })
loadEnv({ path: join(ROOT, 'apps', 'console', '.env.production.local'), quiet: true })

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
 * `nodes` is stored as a plain map or as msgpack bytes; `/managed`'s is bytes.
 * `byteOffset`/`byteLength` always, because firebase-admin hands back pooled
 * Buffers (see `tools/marketing/pour-page.mjs`).
 */
const decodeNodes = (raw) =>
  Buffer.isBuffer(raw) ? decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)) : raw
const encodeNodes = (nodes, wasBytes) => (wasBytes ? Buffer.from(encode(nodes)) : nodes)

// ---- read what is live ---------------------------------------------------------
const hostRef = firestore.collection('hosts').doc(HOST)
const screenRef = hostRef.collection('screens').doc(SCREEN)
const versionsRef = screenRef.collection('versions')
const screenSnap = await screenRef.get()
if (!screenSnap.exists) {
  console.error(`hosts/${HOST}/screens/${SCREEN} does not exist`)
  process.exit(1)
}
const sourceVersionId = screenSnap.get('versionId')
if (!sourceVersionId) {
  console.error(`screen ${SCREEN} has no versionId`)
  process.exit(1)
}
if (WRITE && sourceVersionId !== expectLive) {
  console.error(
    `REFUSED — nothing written: the live version is ${sourceVersionId}, not ${expectLive}. ` +
      'Someone published since the dry run; run the dry run again and read its diff.',
  )
  process.exit(1)
}
const sourceSnap = await versionsRef.doc(sourceVersionId).get()
if (!sourceSnap.exists) {
  console.error(`version ${sourceVersionId} does not exist under screen ${SCREEN}`)
  process.exit(1)
}
const source = sourceSnap.data()
const storedAsBytes = Buffer.isBuffer(source.nodes)
const before = decodeNodes(source.nodes)
const nodes = structuredClone(before)
const seo = screenSnap.get('seo') ?? {}

const problems = []
/** Planned changes, for the dry run: `{ id, where, field, from, to }`. */
const changes = []
/** Values already carrying the new one. */
const already = []
/** Every node id this run is allowed to change, add and remove. */
const intended = new Set()
const adding = new Set()
const removing = new Set()

const ROOT_ID = '_@_'
const childIds = (node) => (node?.nodes ?? []).map((kid) => (typeof kid === 'string' ? kid : kid.$id))
const kids = (node) => childIds(node).map((id) => nodes[id]).filter(Boolean)
const textOf = (node) => (typeof node?.props?.children === 'string' ? node.props.children : null)
const withText = (...texts) => Object.values(nodes).filter((node) => texts.includes(textOf(node)))
const refuse = () => {
  console.error(`REFUSED — nothing written:\n${problems.map((p) => `  • ${p}`).join('\n')}`)
  process.exit(1)
}
const ancestorsOf = (node) => {
  const out = []
  let at = nodes[node.parentId]
  while (at && at.$id !== at.parentId && out.length < 64) {
    out.push(at)
    at = nodes[at.parentId]
  }
  return out
}
function subtree(node) {
  const out = [node]
  for (const kid of kids(node)) out.push(...subtree(kid))
  return out
}
/** The page's top-level sections, by name. */
const section = (name) => {
  const found = kids(nodes[ROOT_ID]).filter((node) => node.name === name)
  if (found.length !== 1) problems.push(`expected one top-level section "${name}", found ${found.length}`)
  return found[0] ?? null
}
/** The top-level section a node sits in. */
const sectionOf = (node) => [node, ...ancestorsOf(node)].find((at) => at.parentId === ROOT_ID) ?? null

/** Set one prop of a node, guarded on its current value. */
function setProp(node, key, from, to, where) {
  const now = node.props?.[key]
  if (now === to) {
    already.push(`${node.$id} (${where}) already has ${key} "${to}"`)
    return false
  }
  if (now !== from) {
    problems.push(`${node.$id} (${where}) has ${key} "${now}", expected "${from}"`)
    return false
  }
  node.props = { ...node.props, [key]: to }
  intended.add(node.$id)
  changes.push({ id: node.$id, where, field: `props.${key}`, from, to })
  return true
}
const setText = (node, from, to, where) => setProp(node, 'children', from, to, where)

/** The single node reading `from` or `to`, inside the named section. */
function oneText(from, to, sectionName, where) {
  const found = withText(from, to)
  if (found.length !== 1) {
    problems.push(`${where}: expected one node reading it, found ${found.length}`)
    return null
  }
  if (sectionOf(found[0])?.name !== sectionName) {
    problems.push(`${where}: ${found[0].$id} is not in the "${sectionName}" section`)
    return null
  }
  return found[0]
}

// ---- (1) the hero ------------------------------------------------------------------
{
  const heroes = kids(nodes[ROOT_ID]).filter(
    (node) => node.componentId === 'reusableInstance' && node.props?.refId === HERO_COMPONENT,
  )
  if (heroes.length !== 1) {
    problems.push(`expected one Product detail hero instance, found ${heroes.length}`)
    refuse()
  }
  const [hero] = heroes
  const values = hero.props.propValues ?? {}
  for (const [key, from, to] of HERO) {
    const where = `hero, ${key}`
    if (values[key] === to) {
      already.push(`${hero.$id} (${where}) already reads "${to}"`)
    } else if (values[key] !== from) {
      problems.push(`${hero.$id} (${where}) reads "${values[key]}", expected "${from}"`)
    } else {
      values[key] = to
      intended.add(hero.$id)
      changes.push({ id: hero.$id, where, field: `props.propValues.${key}`, from, to })
    }
  }
  hero.props = { ...hero.props, propValues: values }
  // The hero's new picture is a picture, in the org's library, and no film's poster frame.
  const [, org, mediaId] = /^media:org:([^/]+)\/(.+)$/.exec(HERO_MOCKUP) ?? []
  const mockup = await firestore.collection('orgs').doc(org).collection('media').doc(mediaId).get()
  if (!mockup.exists || mockup.get('deletedAt') || mockup.get('kind') !== 'image') {
    problems.push(`${HERO_MOCKUP} is not an image in the org's media library`)
  } else if ((mockup.get('tags') ?? []).includes('poster')) {
    problems.push(`${HERO_MOCKUP} (${mockup.get('fileName')}) is tagged a film poster`)
  }
}

// ---- (2) the prices section goes, (3) the form's and FAQ's sections alternate -----------
{
  const costs = kids(nodes[ROOT_ID]).filter((node) => node.name === COST.section || node.props?.id === COST.anchor)
  const form = section(FORM_SECTION.section)
  if (costs.length > 1) problems.push(`expected at most one "${COST.section}" section, found ${costs.length}`)
  else if (costs.length === 1) {
    const [cost] = costs
    const heading = subtree(cost).find((node) => node.name === 'Heading')
    if (cost.name !== COST.section || cost.props?.id !== COST.anchor || textOf(heading) !== COST.heading) {
      problems.push(`${cost.$id} is not the "${COST.section}" section (#${COST.anchor}) headed "${COST.heading}"`)
    } else if (cost.sx?.bgcolor !== FORM_SECTION.to) {
      problems.push(`the "${COST.section}" section's background is ${cost.sx?.bgcolor}, not ${FORM_SECTION.to}`)
    } else {
      const gone = subtree(cost)
      for (const node of gone) {
        removing.add(node.$id)
        delete nodes[node.$id]
      }
      const root = nodes[ROOT_ID]
      root.nodes = childIds(root).filter((id) => id !== cost.$id)
      intended.add(ROOT_ID)
      changes.push({
        id: cost.$id,
        where: `the "${COST.section}" section (#${COST.anchor}), and the ${gone.length - 1} nodes in it`,
        field: 'removed',
        from: gone.map((node) => textOf(node)).filter(Boolean).join(' · '),
        to: '(none)',
      })
    }
  } else {
    already.push(`the "${COST.section}" section is already gone`)
  }
  for (const { section: name, from, to } of [FORM_SECTION, FAQ_SECTION]) {
    const band = name === FORM_SECTION.section ? form : section(name)
    if (!band) continue
    const where = `${name} section`
    const now = band.sx?.bgcolor
    if (now === to) already.push(`${band.$id} (${where}) already has background ${now}`)
    else if (now !== from) problems.push(`${band.$id} (${where}) has background ${now}, expected ${from}`)
    else {
      band.sx = { ...band.sx, bgcolor: to }
      intended.add(band.$id)
      changes.push({ id: band.$id, where, field: 'sx.bgcolor', from: now, to })
    }
  }
}

// ---- the fair-use list takes the hero's anchor ------------------------------------------------
{
  const fairUse = section(FAIR_USE_SECTION)
  const taken = Object.values(nodes).filter((node) => node.props?.id === INCLUDED_ANCHOR && node !== fairUse)
  if (taken.length) problems.push(`#${INCLUDED_ANCHOR} is already the id of ${taken.map((node) => node.$id).join(', ')}`)
  if (fairUse) setProp(fairUse, 'id', undefined, INCLUDED_ANCHOR, 'fair-use section anchor')
}

// ---- (4) the bigger-jobs bullets ------------------------------------------------------------
for (const [from, to] of BIGGER_JOBS.titles) {
  const title = oneText(from, to, BIGGER_JOBS.section, `bigger-jobs bullet "${from}"`)
  if (!title) continue
  setText(title, from, to, 'bigger-jobs bullet title')
  // Title → Copy → Bullet: the bullet is named after its title.
  const bullet = nodes[nodes[title.parentId]?.parentId]
  const name = bullet?.name
  if (name === `Bullet · ${to}`) already.push(`${bullet.$id} (bigger-jobs bullet) is already named "${name}"`)
  else if (name !== `Bullet · ${from}`) problems.push(`${bullet?.$id} (bigger-jobs bullet) is named "${name}", expected "Bullet · ${from}"`)
  else {
    bullet.name = `Bullet · ${to}`
    intended.add(bullet.$id)
    changes.push({ id: bullet.$id, where: 'bigger-jobs bullet', field: 'name', from: name, to: bullet.name })
  }
}

// ---- (5) the sentences that stated a figure ---------------------------------------------------
for (const { section: name, question, where, from, to } of SENTENCES) {
  const label = where ?? `FAQ answer to "${question}"`
  const node = oneText(from, to, name, label)
  if (!node) continue
  if (question) {
    // Answer → Accordion details → Accordion, whose first child is the question.
    const accordion = nodes[nodes[node.parentId]?.parentId]
    const [summary] = kids(accordion)
    if (summary?.componentId !== 'muiAccordionSummary' || textOf(summary) !== question) {
      problems.push(`${node.$id} does not answer "${question}"`)
      continue
    }
  }
  setText(node, from, to, label)
}

// ---- (8) the deep dives' accessible names -----------------------------------------------------
for (const [name, templateLabel] of DEEP_DIVES) {
  const dive = section(name)
  const heading = dive && subtree(dive).find((node) => node.name === 'Heading')
  if (!dive || !textOf(heading)) {
    if (dive) problems.push(`${dive.$id} ("${name}") has no heading`)
    continue
  }
  setProp(dive, 'ariaLabel', templateLabel, textOf(heading), `"${name}" section's accessible name`)
}

// ---- (7) a film's poster frame plays the film ---------------------------------------------------
const pictures = Object.values(nodes).filter((node) => node.name === DEEP_DIVE_IMAGE && node.componentId === 'image')
const placed = Object.values(nodes).filter((node) => node.name === DEEP_DIVE_VIDEO && node.componentId === 'video')
const posters = new Map()
for (const picture of pictures) {
  const [, org, mediaId] = /^media:org:([^/]+)\/(.+)$/.exec(picture.props?.src ?? '') ?? []
  if (!org) {
    problems.push(`${picture.$id} (deep-dive picture) is not an org library image: ${picture.props?.src}`)
    continue
  }
  const media = await firestore.collection('orgs').doc(org).collection('media').doc(mediaId).get()
  const tags = media.get('tags') ?? []
  const isPoster = media.exists && tags.includes('video') && tags.includes('poster')
  if (isPoster && !FILMS.has(picture.props.src)) {
    problems.push(`${picture.$id} shows ${picture.props.src}, a film's poster frame that FILMS does not name`)
  } else if (!isPoster && FILMS.has(picture.props.src)) {
    problems.push(`${picture.props.src} is in FILMS, but the media library does not tag it a video poster`)
  } else if (isPoster) {
    posters.set(picture.$id, media.get('fileName'))
  } else {
    already.push(`${picture.$id} (${sectionOf(picture)?.name}) shows ${media.get('fileName') ?? mediaId}, no film's poster: stays a picture`)
  }
}
for (const video of placed) {
  already.push(`${video.$id} (${sectionOf(video)?.name}) already plays ${video.props?.src}`)
}
for (const picture of pictures.filter((node) => posters.has(node.$id))) {
  const { screen, route } = FILMS.get(picture.props.src)
  const film = await readFilmVideo({ firestore, hostId: HOST, screenId: screen, poster: picture.props.src })
  if ('problem' in film) {
    problems.push(`the film for ${picture.props.src}: ${film.problem}`)
    continue
  }
  const row = nodes[picture.parentId]
  if (childIds(row).some((id) => typeof id !== 'string')) {
    problems.push(`${row.$id} holds its children inline, which this script does not edit`)
    continue
  }
  const videoId = createResourceUid()
  nodes[videoId] = {
    $id: videoId,
    type: 'node',
    name: DEEP_DIVE_VIDEO,
    parentId: row.$id,
    pluginId: 'mui',
    componentId: 'video',
    props: film.props,
    // The picture's place and look in the row; the band clips its player the same way.
    sx: { ...picture.sx, overflow: 'hidden' },
  }
  row.nodes = childIds(row).map((id) => (id === picture.$id ? videoId : id))
  delete nodes[picture.$id]
  removing.add(picture.$id)
  adding.add(videoId)
  intended.add(row.$id)
  const where = `${sectionOf(row)?.name}, in place of ${picture.$id}`
  changes.push({
    id: picture.$id,
    where,
    field: 'removed',
    from: JSON.stringify({ componentId: 'image', src: picture.props.src, alt: picture.props.alt }),
    to: `(none: the film "${posters.get(picture.$id)}" plays here)`,
  })
  changes.push({
    id: videoId,
    where: `${where}, read from ${route} (instance ${film.instanceId}, version ${film.versionId})`,
    field: 'new node',
    from: '(none)',
    to: JSON.stringify({ componentId: 'video', props: film.props, sx: nodes[videoId].sx }),
  })
}

// ---- (6) the SEO description ---------------------------------------------------------------
let seoTo = null
if (seo.description === SEO_TO) already.push(`screen ${SCREEN} SEO description already reads "${SEO_TO}"`)
else if (seo.description !== SEO_FROM) problems.push(`screen ${SCREEN} SEO description reads "${seo.description}", expected "${SEO_FROM}"`)
else {
  seoTo = SEO_TO
  changes.push({ id: SCREEN, where: 'screen document', field: 'seo.description', from: SEO_FROM, to: SEO_TO })
}
if (problems.length) refuse()

// ---- no dollar figure anywhere, and nothing inside a reusable component -------------------------
/** Every string under a value, with the path it sits at. */
function* strings(value, path) {
  if (typeof value === 'string') yield [path, value]
  else if (Array.isArray(value)) for (const [at, item] of value.entries()) yield* strings(item, `${path}[${at}]`)
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) yield* strings(item, `${path}.${key}`)
  }
}
for (const node of Object.values(nodes)) {
  for (const [path, text] of strings({ name: node.name, props: node.props }, node.$id)) {
    if (FIGURE.test(text)) problems.push(`${path} still states a figure: "${text.slice(0, 80)}"`)
  }
  for (const [path, text] of strings(node.props, node.$id)) {
    if (text === `#${COST.anchor}`) problems.push(`${path} still leads to #${COST.anchor}, which is gone`)
  }
}
for (const field of ['title', 'description']) {
  const text = field === 'description' ? (seoTo ?? seo.description) : seo[field]
  if (FIGURE.test(text ?? '')) problems.push(`screen ${SCREEN} seo.${field} still states a figure: "${text}"`)
}
for (const id of [...intended, ...adding]) {
  if (id === ROOT_ID) continue
  const inside = ancestorsOf(nodes[id]).find((node) => node.props?.refId || node.componentId === 'reusableInstance')
  if (inside) problems.push(`${id} sits in reusable component ${inside.props?.refId ?? inside.$id}`)
}
if (problems.length) refuse()

// ---- the diff against live: only the intended nodes may differ ---------------------------------
const differ = []
const added = []
const removed = []
for (const id of new Set([...Object.keys(before), ...Object.keys(nodes)])) {
  if (!(id in before)) added.push(id)
  else if (!(id in nodes)) removed.push(id)
  else if (JSON.stringify(before[id]) !== JSON.stringify(nodes[id])) differ.push(id)
}
const unexpected = [
  ...differ.filter((id) => !intended.has(id)).map((id) => `changed ${id}`),
  ...[...intended].filter((id) => !differ.includes(id)).map((id) => `meant to change ${id}, unchanged`),
  ...added.filter((id) => !adding.has(id)).map((id) => `added ${id}`),
  ...removed.filter((id) => !removing.has(id)).map((id) => `removed ${id}`),
]
if (unexpected.length) {
  problems.push(`the new version differs from live beyond the planned changes: ${unexpected.join(', ')}`)
  refuse()
}

// ---- report -----------------------------------------------------------------------------------
console.log(`${ROUTE} → hosts/${HOST}/screens/${SCREEN}`)
console.log(`  live version: ${sourceVersionId} ("${source.displayName ?? ''}")`)
console.log(
  `  nodes: ${Object.keys(before).length} → ${Object.keys(nodes).length}; ` +
    `${differ.length} changed, ${added.length} added, ${removed.length} removed`,
)
for (const change of changes) {
  console.log(`\n  ~ ${change.id}  ${change.where}  [${change.field}]`)
  console.log(`      before: ${change.from}`)
  console.log(`      after:  ${change.to}`)
}
if (already.length) console.log(`\n  already done or left as is:\n${already.map((line) => `    = ${line}`).join('\n')}`)

if (!differ.length && !added.length && !removed.length && !seoTo) {
  console.log(`\nNothing to do: ${ROUTE} already carries every change.`)
  process.exit(0)
}
if (!WRITE) {
  console.log(
    `\nDry run. ${differ.length + added.length + removed.length} node(s) and ${seoTo ? 1 : 0} SEO field ` +
      `would change. To publish:\n` +
      `  node tools/scripts/republish-managed-landing-page.mjs --write --expect-live=${sourceVersionId}`,
  )
  process.exit(0)
}

// ---- back up what is live, then write -------------------------------------------------------
/** Firestore values as JSON: a Timestamp becomes its ISO string. */
const plain = (value) => {
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString()
  if (Buffer.isBuffer(value)) return { base64: value.toString('base64') }
  if (Array.isArray(value)) return value.map(plain)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]))
  return value
}
const takenAt = new Date().toISOString()
const backupPath = join(ROOT, '.scratch', `managed-backup-${takenAt.replace(/[:.]/g, '-')}.json`)
mkdirSync(dirname(backupPath), { recursive: true })
const { nodes: _sourceNodes, ...sourceFields } = source
writeFileSync(
  backupPath,
  JSON.stringify(
    {
      hostId: HOST,
      screenId: SCREEN,
      takenAt,
      screen: plain(screenSnap.data()),
      version: {
        id: sourceVersionId,
        ...plain(sourceFields),
        nodesStoredAs: storedAsBytes ? 'msgpack' : 'map',
        nodesMsgpackBase64: storedAsBytes ? source.nodes.toString('base64') : null,
        nodes: before,
      },
    },
    null,
    1,
  ),
)
console.log(`\nBacked up the live screen and version ${sourceVersionId} to ${backupPath}`)

const newVersionRef = versionsRef.doc(createResourceUid())
const outboxRef = firestore.collection('publishOutbox').doc(createResourceUid())
const { createdAt: _createdAt, updatedAt: _updatedAt, ...carried } = sourceFields
await firestore.runTransaction(async (tx) => {
  const live = await tx.get(screenRef)
  if (live.get('versionId') !== sourceVersionId) {
    throw new Error(`the live version moved to ${live.get('versionId')} while this ran; nothing written`)
  }
  if (live.get('seo')?.description !== seo.description) {
    throw new Error('the SEO description changed while this ran; nothing written')
  }
  tx.create(newVersionRef, {
    ...carried,
    displayName: VERSION_NAME,
    nodes: encodeNodes(nodes, storedAsBytes),
    hostId: HOST,
    screenId: SCREEN,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  tx.update(screenRef, {
    versionId: newVersionRef.id,
    ...(seoTo ? { 'seo.description': seoTo } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  })
  tx.create(outboxRef, {
    hostId: HOST,
    paths: [ROUTE],
    createdAt: FieldValue.serverTimestamp(),
    attempts: 0,
  })
})

console.log(`\nPublished NEW version ${newVersionRef.id} "${VERSION_NAME}" (was ${sourceVersionId}).`)
console.log(`Announced ${ROUTE} in publishOutbox/${outboxRef.id}; the console's drain revalidates it.`)
console.log(
  `Revert: set hosts/${HOST}/screens/${SCREEN}.versionId back to ${sourceVersionId}` +
    (seoTo ? ` and seo.description back to "${seo.description}"` : '') +
    `, then add a publishOutbox entry { hostId: '${HOST}', paths: ['${ROUTE}'], attempts: 0 }.`,
)
