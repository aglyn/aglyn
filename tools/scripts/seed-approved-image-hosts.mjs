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
 * Seed each site's `approvedImageHosts` from what it ALREADY loads (AGL-1152).
 *
 *   node tools/scripts/seed-approved-image-hosts.mjs            # report only
 *   node tools/scripts/seed-approved-image-hosts.mjs --write
 *   node tools/scripts/seed-approved-image-hosts.mjs --write --host <hostId>
 *
 * REPORT-ONLY BY DEFAULT. This writes a security policy onto live customer
 * sites; the shape of the corpus should be a thing you have READ before it is
 * a thing you have changed.
 *
 * ## Why this has to run BEFORE `img-src` is enforced
 *
 * Enforcing against an empty list breaks every image a site already hotlinks,
 * on customer property, with no error anyone sees and no one who knows to
 * report it. That asymmetry is exactly why AGL-1726 refused the flip. Seeding
 * turns "blocking" into "blocking hosts you have not already chosen": nothing
 * that works today stops working, and everything NEW goes through the editor's
 * warn-then-approve path.
 *
 * It is also the half the editor warning CANNOT cover. AGL-1725 inventoried the
 * tenant's image sinks and two of them are raw author CSS — a `<style>` block
 * or a `style` attribute the author typed — which no validator, lint rule or
 * attribute-panel warning can see. Those URLs would be refused at runtime with
 * no warning ever shown. Reading them out of the stored trees is the only way
 * they get onto the list.
 *
 * ## What it reads
 *
 * Every host's PUBLISHED content: each screen's and layout's published version
 * nodes, plus component documents (which carry their tree inline). Any absolute
 * `http(s)` URL anywhere in a node's props is a candidate, wherever it sits —
 * a prop, a nested `sx`, a `background-image` inside author CSS. Deliberately
 * not a list of known prop names: the sinks that matter are the ones nobody
 * remembered to enumerate.
 *
 * ## What it will not add
 *
 * - The site's own origins, and `firebasestorage.googleapis.com`, which is
 *   PINNED in `security-origins.js` and must not be duplicated into owner data.
 * - Anything the shared parser refuses (`normalizeApprovedImageHost`), so the
 *   seed can never contain an entry the header would drop.
 * - Hosts that only appear in a NON-image context — see the note on `looksLikeImage`.
 *
 * Credentials follow every other admin script here.
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { normalizeApprovedImageHost, APPROVED_IMAGE_HOSTS_MAX } = require(
  '../../security-origins.js',
)

const SELF_TEST = process.argv.includes('--self-test')
const WRITE = process.argv.includes('--write')
const hostArg = process.argv.indexOf('--host')
const ONLY_HOST = hostArg > -1 ? process.argv[hostArg + 1] : null

const projectId = SELF_TEST ? 'self-test' : process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!SELF_TEST && (!projectId || !clientEmail || !privateKey)) {
  console.error(
    'Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY',
  )
  process.exit(1)
}
if (!SELF_TEST && !getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}
const firestore = SELF_TEST ? null : getFirestore(process.env.FIRESTORE_DATABASE_ID)

/** Never seeded: pinned in the directive, or the site's own address. */
const PINNED = new Set(['firebasestorage.googleapis.com'])

/**
 * Does this URL plausibly load as an IMAGE?
 *
 * A tree holds link `href`s and script sources too, and approving the host of
 * an outbound link would widen the policy for a URL no browser ever fetches as
 * an image. So a candidate needs either an image-ish extension, an image-ish
 * query (CDN transforms drop the extension), or a key whose name says image.
 *
 * Deliberately generous: a false POSITIVE seeds a host the site already
 * references and is at worst untidy, while a false negative is a broken image
 * on a customer's page the day enforcement lands. When those two are the
 * options, err toward the list being longer.
 */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|tiff?)(\?|#|$)/i
const IMAGE_KEY = /(image|img|photo|picture|logo|icon|avatar|cover|thumb|banner|background|poster|src|srcset|favicon)/i

function looksLikeImage(url, key) {
  if (IMAGE_EXT.test(url)) return true
  if (key && IMAGE_KEY.test(key)) return true
  // `background-image: url(...)` inside author CSS, where the key is the whole
  // stylesheet rather than a prop name.
  return /background(-image)?\s*:/i.test(key ?? '')
}

const URL_IN_TEXT = /https?:\/\/[^\s"'()<>\\]+/gi

/** Every plausible image host inside one arbitrarily-shaped value. */
function collectHosts(value, key, into) {
  if (typeof value === 'string') {
    const matches = value.match(URL_IN_TEXT)
    if (!matches) return
    for (const raw of matches) {
      if (!looksLikeImage(raw, key)) continue
      let hostname
      try {
        hostname = new URL(raw).hostname.toLowerCase()
      } catch {
        continue
      }
      if (!hostname || PINNED.has(hostname)) continue
      into.add(hostname)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectHosts(entry, key, into)
    return
  }
  if (value && typeof value === 'object') {
    for (const [childKey, entry] of Object.entries(value)) {
      collectHosts(entry, `${key ?? ''} ${childKey}`, into)
    }
  }
}

/**
 * PROVE THE SCANNER BEFORE TRUSTING ITS ZERO (AGL-1152).
 *
 * A scanner that never matches and a corpus with nothing to match produce
 * byte-identical output — the AGL-518 shape, and the reason AGL-1726 spent a
 * whole section on how to read its counters. A clean production run means
 * nothing unless the collector is known to fire, so this runs the real
 * `collectHosts` over a tree shaped like the sinks that actually exist:
 * an ordinary prop, a nested `sx`, a `srcSet`, and — the two the editor
 * warning can never see — raw author CSS in a `<style>` block and in a
 * `style` attribute.
 */
if (SELF_TEST) {
  const tree = {
    root: { props: { children: 'hello' } },
    hero: { props: { src: 'https://cdn.example.com/a.png', alt: 'x' } },
    nested: { props: { sx: { backgroundImage: 'url(https://sx.example.net/b.jpg)' } } },
    srcset: {
      props: { srcSet: 'https://srcset.example.org/c.webp 1x, /local.webp 2x' },
    },
    authorStyle: {
      props: {
        html: '<style>.a{background-image:url("https://css.example.io/d.png")}</style>',
      },
    },
    styleAttr: {
      props: { html: '<div style="background: url(https://attr.example.co/e.gif)">' },
    },
    // Must NOT be seeded: an outbound link is never fetched as an image.
    link: { props: { href: 'https://not-an-image.example.com/page' } },
    // Must NOT be seeded: pinned in the directive.
    pinned: { props: { src: 'https://firebasestorage.googleapis.com/f.png' } },
  }
  const found = new Set()
  collectHosts(tree, 'nodes', found)
  const got = [...found].sort()
  const want = [
    'attr.example.co',
    'cdn.example.com',
    'css.example.io',
    'srcset.example.org',
    'sx.example.net',
  ]
  const missing = want.filter((h) => !got.includes(h))
  const extra = got.filter((h) => !want.includes(h))
  console.log('self-test — found:', got.join(', ') || '(none)')
  if (missing.length) console.error('  MISSING:', missing.join(', '))
  if (extra.length) console.error('  UNEXPECTED:', extra.join(', '))
  console.log(missing.length || extra.length ? 'SELF-TEST FAILED' : 'SELF-TEST OK')
  process.exit(missing.length || extra.length ? 1 : 0)
}

async function hostsForSite(hostRef, siteOrigins) {
  const found = new Set()
  const collections = ['screens', 'layouts', 'components']
  for (const name of collections) {
    const docs = await hostRef.collection(name).limit(2000).get()
    for (const docSnapshot of docs.docs) {
      if (name === 'components') {
        collectHosts(docSnapshot.get('nodes'), 'nodes', found)
        continue
      }
      const versionId = docSnapshot.get('versionId')
      if (!versionId) continue
      const version = await docSnapshot.ref
        .collection('versions')
        .doc(String(versionId))
        .get()
        .catch(() => null)
      if (version?.exists) collectHosts(version.get('nodes'), 'nodes', found)
    }
  }
  for (const origin of siteOrigins) found.delete(origin)
  return [...found].sort()
}

const hostDocs = ONLY_HOST
  ? [await firestore.collection('hosts').doc(ONLY_HOST).get()]
  : (await firestore.collection('hosts').get()).docs

console.log(
  `sites: ${hostDocs.length}   mode: ${WRITE ? 'WRITE' : 'report only'}\n`,
)

let changed = 0
for (const hostSnapshot of hostDocs) {
  if (!hostSnapshot.exists) continue
  const hostId = hostSnapshot.id
  const subdomain = String(hostSnapshot.get('subdomain') ?? '')
  const cname = String(hostSnapshot.get('cname') ?? '')
  const siteOrigins = new Set(
    [
      subdomain ? `${subdomain}.aglyn.app` : '',
      cname,
      cname ? `www.${cname}` : '',
    ].filter(Boolean),
  )

  const discovered = await hostsForSite(hostSnapshot.ref, siteOrigins)
  const existing = Array.isArray(hostSnapshot.get('approvedImageHosts'))
    ? hostSnapshot.get('approvedImageHosts')
    : []
  // Everything the shared parser would keep, existing entries first so an
  // owner's own choices survive the cap.
  const merged = []
  const seen = new Set()
  for (const entry of [...existing, ...discovered]) {
    const normalized = normalizeApprovedImageHost(entry)
    if (!normalized) continue
    const bare = normalized.replace(/^https:\/\//, '')
    if (seen.has(bare)) continue
    seen.add(bare)
    merged.push(bare)
    if (merged.length >= APPROVED_IMAGE_HOSTS_MAX) break
  }
  const added = merged.filter((entry) => !existing.includes(entry))
  const refused = discovered.filter(
    (entry) => normalizeApprovedImageHost(entry) === null,
  )

  if (!added.length && !refused.length) continue
  changed += 1
  console.log(`${hostId}${subdomain ? ` (${subdomain})` : ''}`)
  if (added.length) console.log(`  + ${added.join(', ')}`)
  if (refused.length) {
    // Named, never silently dropped: these are hosts the site DOES load and
    // the policy will refuse, so they are the pages that break on the flip.
    console.log(`  ⚠ refused by the parser, will be BLOCKED: ${refused.join(', ')}`)
  }
  if (WRITE && added.length) {
    await hostSnapshot.ref.set({ approvedImageHosts: merged }, { merge: true })
    console.log(`  written (${merged.length} total)`)
  }
}

console.log(
  `\n${changed} site(s) with changes.` +
    (WRITE ? '' : '\nREPORT ONLY. Nothing was written. Re-run with --write.'),
)
