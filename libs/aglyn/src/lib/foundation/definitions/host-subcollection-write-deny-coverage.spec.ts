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
 * No host subcollection the metered invoice is computed from is writable by
 * the client (AGL-1367).
 *
 * AGL-1361 built default-deny coverage for the FIELDS of `hosts/{hostId}`.
 * AGL-1367 was the same failure one level out: not an unclassified field but an
 * unclassified COLLECTION. `hosts/{hostId}/counters/*` had no dedicated rules
 * block and appeared in none of the host catch-all's three exclusion lists, so
 * `canWriteHostContent` — admin or EDITOR — granted full create/update/delete
 * on the documents that hold the entire enforcement state of five quotas and
 * three of the four inputs to `estimateMonthlyUsageCost`. Zeroing
 * `counters/media.bytes` bought unbounded Firebase Storage on a Free plan;
 * lowering any of them lowered a live Stripe metered invoice.
 *
 * ## Why this guard is derived rather than declared
 *
 * The field guards partition a declared interface, because a document's fields
 * are enumerable. A host's subcollections are not — ~49 names appear under
 * `hosts/{hostId}` across the repo, most of them plugin content — so a
 * hand-written classification of all of them would be a large list of guesses
 * dressed as decisions, and the first stale entry is where the next hole hides.
 *
 * So this asks the narrower question that AGL-1367 actually answers, and asks
 * it of a DIRECTORY rather than a file list: every host subcollection the
 * billing rollup reads must be denied to client writes, or be named below with
 * a reason it is not billed. A new metered input added under a new collection
 * fails the build until someone decides which it is. That is the AGL-1361
 * property — "a read is an INPUT TO A DECISION" — transposed from fields to
 * collections, with the decision here being money.
 *
 * The behavioural companion is `cloud/rules-tests/firestore-rules.test.mjs`,
 * which drives a real client-SDK write per collection against the emulator and
 * was mutation-tested nine ways: dropping any of `counters`, `analytics` or
 * `members` from any one of the three exclusion lists turns it red naming the
 * key. This file proves the RULES cover what billing reads; that one proves
 * the rules fire. A complete list in a rule that never runs is AGL-1354 again.
 */

import { readFileSync, readdirSync } from 'fs'
import { join, resolve } from 'path'

import { parseHostSubcollectionRules } from './write-deny-coverage.util'

const REPO_ROOT = resolve(__dirname, '../../../../../..')
const RULES_FILE = 'cloud/firebase-firestore.rules'
const BILLING_DIR = 'apps/console/app/api/billing'

/**
 * Host subcollections the billing routes read that do NOT price anything.
 *
 * Kept deliberately tiny and reasoned. `report-usage` computes `billedCents`
 * from `estimateMonthlyUsageCost(usage, org)` plus the dataset, API and
 * contact overages; `siteSizeBytes` is summed beside it and written into the
 * audit rollup, but never added to `billedCents` and never sent to the Stripe
 * meter. An editor who rewrites a screen changes what their own site weighs
 * and pays exactly the same, which is what makes this safe and is why the
 * reason has to be written down rather than assumed.
 */
const BILLING_READS_NOT_METERED: Record<string, string> = {
  screens:
    'Site size only. `siteSizeBytes` lands in the usage audit rollup and the ' +
    'staff COGS view; it is not part of `billedCents` and is never sent to ' +
    'the Stripe meter, so a client rewrite moves a number nobody charges for ' +
    '— and screens must stay editor-writable or authoring stops.',
  layouts:
    'The other half of `siteSizeBytes`, on the same footing as `screens`: ' +
    'measured, reported, never billed, and client-writable by necessity ' +
    'because a shared layout is authored in the console.',
}

const read = (relativePath: string): string =>
  readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')

/**
 * Every host subcollection the billing routes read, swept off the DIRECTORY.
 *
 * Directory-wide on purpose, like the resolver sweep in the field guard: a
 * per-file list would be one more thing to tend, and a NEW billing route
 * reading a NEW collection is covered the moment it is written.
 *
 * The binding is what makes a read host-scoped. `report-usage` also walks
 * `doc.ref.collection('versions')` where `doc` is a screen — matching a bare
 * `.collection('…')` would sweep that in as if it hung off the host and demand
 * the rules deny version history, which is client-written by every save.
 */
const billingHostReads = (() => {
  const dir = resolve(REPO_ROOT, BILLING_DIR)
  const sources = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(dir, entry.name, 'route.ts'))
    .filter((path) => {
      try {
        readFileSync(path)
        return true
      } catch {
        return false
      }
    })
    .map((path) => readFileSync(path, 'utf8'))
  const found = new Set<string>()
  for (const source of sources) {
    for (const hit of source.matchAll(
      /\b(?:hostRef|host\.ref)\s*\.\s*collection\(\s*'([A-Za-z][A-Za-z0-9]*)'/g,
    )) {
      found.add(hit[1])
    }
  }
  return [...found].sort()
})()

describe('the metered invoice is computed from server-owned documents only (AGL-1367)', () => {
  const rules = parseHostSubcollectionRules(read(RULES_FILE))

  describe('the parsers still see what they are supposed to see', () => {
    it('reads the host catch-all exclusion lists out of the rules', () => {
      // One list per operation, and none of them empty — an exclusion list
      // that failed to parse would silently make every collection look
      // client-writable and this whole guard would pass by accident.
      expect(rules.excluded.create).toEqual(
        expect.arrayContaining(['screens', 'datasets', 'webhooks', 'orders']),
      )
      expect(rules.excluded.update.length).toBeGreaterThanOrEqual(6)
      expect(rules.excluded.delete.length).toBeGreaterThanOrEqual(4)
    })

    it('sees the dedicated blocks that RE-GRANT what the lists exclude', () => {
      // Without this subtraction the guard would call `screens` denied. Rules
      // OR their allows and the looser wins, which is the single most
      // load-bearing fact about this file.
      expect(rules.dedicated).toEqual(
        expect.arrayContaining([
          'screens',
          'layouts',
          'components',
          'templates',
          'webhooks',
          'orders',
          'collections',
        ]),
      )
      expect(rules.serverOnly).not.toContain('screens')
      expect(rules.serverOnly).not.toContain('collections')
      // `orders` sits in all three exclusion lists since AGL-1827 but is NOT
      // outright server-only: its dedicated block re-grants the status-frozen
      // update the console's note and restock answer still make. The emulator
      // suite proves the freeze fires; this only keeps the parse honest about
      // which set the name belongs to.
      expect(rules.excluded.update).toContain('orders')
      expect(rules.excluded.delete).toContain('orders')
      expect(rules.serverOnly).not.toContain('orders')
    })

    it('finds the host subcollections the billing routes read', () => {
      // The floor. Renaming the `hostRef` binding would otherwise empty this
      // sweep and leave the guard asserting nothing, forever green.
      expect(billingHostReads).toEqual(
        expect.arrayContaining(['counters', 'analytics']),
      )
    })
  })

  it('denies client writes to every host subcollection the invoice reads', () => {
    const exposed = billingHostReads.filter(
      (name) =>
        !rules.serverOnly.includes(name) &&
        !(name in BILLING_READS_NOT_METERED),
    )
    if (exposed.length > 0) {
      throw new Error(
        `These host subcollections are read by the billing rollup in ` +
          `${BILLING_DIR} but a site EDITOR can still write them from the ` +
          `Firebase client SDK:\n\n` +
          `${exposed.map((name) => `  • hosts/{hostId}/${name}`).join('\n')}\n\n` +
          `A document the invoice is computed from is a document the customer ` +
          `must not be able to write. AGL-1367 was exactly this: ` +
          `\`counters/media.bytes\` and \`analytics/{day}.total\` feed ` +
          `\`estimateMonthlyUsageCost\`, and metered pass-through is live for ` +
          `every paid plan (AGL-1280), so lowering them lowered a real bill — ` +
          `while zeroing the same storage counter also removed the ` +
          `\`storagePerHostMb\` wall entirely.\n\n` +
          `Decide, on this commit:\n` +
          `  • priced — add the name to ALL THREE \`subcollection in […]\` ` +
          `exclusion lists of the host catch-all in ${RULES_FILE}. All three: ` +
          `one list is not denial, and a dedicated ` +
          `\`allow write: if false\` block does NOT close it, because sibling ` +
          `match blocks are OR'd and the looser one wins;\n` +
          `  • measured but not billed — add it to ` +
          `BILLING_READS_NOT_METERED with a reason saying why a client ` +
          `rewrite costs nobody anything.\n\n` +
          `When in doubt, deny: every writer of the collections AGL-1367 ` +
          `closed was already an Admin-SDK route, so denying them changed ` +
          `nothing about the product.`,
      )
    }
  })

  it('keeps the not-metered exemptions honest', () => {
    for (const [name, reason] of Object.entries(BILLING_READS_NOT_METERED)) {
      // Still read by billing — a stale exemption is a name nobody is
      // checking any more, which is where the next one hides.
      expect([name, billingHostReads.includes(name)]).toEqual([name, true])
      expect([name, reason.length > 40]).toEqual([name, true])
      // And never both exempt and denied: one of the two would be a lie.
      expect([name, rules.serverOnly.includes(name)]).toEqual([name, false])
    }
  })

  it('holds the collections AGL-1367 and AGL-2038 closed', () => {
    // The floor that makes the emulator suite's mutation proof meaningful
    // here too: drop any one of these from any one of the three lists and it
    // leaves `serverOnly`, and this fails naming it — without needing an
    // emulator, so the plain unit build catches it.
    for (const name of [
      'counters',
      'analytics',
      'members',
      'screenAnalytics',
    ]) {
      expect([name, rules.serverOnly.includes(name)]).toEqual([name, true])
    }
  })
})

/**
 * Every host subcollection in the repo is CLASSIFIED, not merely unlisted
 * (AGL-2038).
 *
 * The guard above asks the narrow question AGL-1367 asked: is every host
 * subcollection the *billing rollup reads* denied to clients? `screenAnalytics`
 * answered it correctly and was still wide open — nothing invoices off it, so
 * the billing sweep never saw the name, while the host catch-all granted a site
 * editor create/update/delete on the per-screen traffic history behind a Pro+
 * panel. Same failure as `registers`, which has now been clobbered twice.
 *
 * The root cause is not any of those three omissions. It is that
 * `match /hosts/{hostId}/{subcollection}/{document=**}` is PERMISSIVE BY
 * DEFAULT: it grants writes unless a name appears in an exclusion list, so
 * every subcollection added from here on inherits editor write access silently,
 * and the only thing between a server-owned document and a customer writing it
 * is somebody remembering to type a string into three lists.
 *
 * ## Why this is a classification guard and not a deny-by-default rule
 *
 * Inverting the catch-all — deny everything, allow-list what editors may write
 * — is the stronger fix and was measured before being rejected. Fifty-one
 * distinct subcollection names appear under `hosts/{hostId}` in first-party
 * code, and roughly twenty of them are plugin content authored client-side:
 * `libs/plugins/commerce` alone writes `products`, `productCategories`,
 * `locations`, `coupons`, `discounts`, `memberPosts`, `licenseKeys`,
 * `suppliers`, `reservations` and `inventoryAdjustments` from console
 * components. Two properties make an allow-list the wrong instrument for that
 * set:
 *
 *  - **A miss fails at runtime, silently, in a customer's session.** It is not
 *    a build error — it is `permission-denied` on a save, in a plugin surface
 *    no rules test covers. Deny-by-default would have to be *complete* on the
 *    first try to avoid breaking authoring for real sites.
 *  - **The set is open.** Marketplace plugins store host-scoped data, and a
 *    list committed in a `.rules` file cannot name a collection a plugin
 *    publishes next month.
 *
 * So the rules stay permissive-by-default and the BUILD becomes
 * deny-by-default: a subcollection may exist only if it is server-owned in the
 * rules or named below with a reason. A new one fails CI until someone decides
 * which it is. That converts a silent runtime grant into a loud commit-time
 * question, which is the property AGL-2038 actually needs and the one the three
 * clobbers of `registers` kept proving was missing.
 */

const SOURCE_ROOTS = ['apps', 'libs']

/**
 * Built output only. `apps/docs/build` in particular contains webpack bundles
 * that mention half these names inside minified strings, which would classify
 * documentation prose as a storage layer.
 */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nx',
  'coverage',
  'out',
  '.turbo',
])

/**
 * Host subcollections a site EDITOR may write, and what breaks if they cannot.
 *
 * This is the list the deny-by-default option would have had to get right, so
 * it is written from the call sites rather than from memory: each name below
 * has at least one client-SDK write in the console or a plugin console
 * component. A reason has to say what authoring stops working, because "it
 * seems fine" is how `screenAnalytics` got here.
 */
const EDITOR_WRITABLE_HOST_SUBCOLLECTIONS: Record<string, string> = {
  screens: 'The site itself. Every save in the besigner writes one.',
  layouts: 'Shared page chrome, authored in the besigner alongside screens.',
  components:
    'Reusable component documents, created and saved from the components ' +
    'console page.',
  templates:
    'Entry/collection templates, authored in the console; the dedicated block ' +
    'freezes `source` and leaves the rest client-written.',
  collections:
    'Content collections. Identity keys are API-owned (AGL-978) and the ' +
    'dedicated block re-grants the non-identity updates the console makes.',
  variables: 'Design tokens and site variables, edited in the besigner.',
  functions: 'Site functions, authored in the console function editor.',
  workflows: 'Automation graphs, authored in the workflow builder.',
  actions: 'Workflow actions, written by the interaction builder dialog.',
  overlays: 'Modal/drawer overlays, written by the interaction builder dialog.',
  experiments:
    'A/B variants, created and retired by the interactions provider.',
  redirects: 'Redirect rules, authored in the redirects plugin console page.',
  webhooks:
    'Outbound webhook listeners, edited in the workflows console card; the ' +
    'per-host cap is enforced on create by /api/hosts/resources (AGL-1360).',
  installs:
    'Plugin pins. Create/update are API-only (AGL-508); the console still ' +
    'deletes one to uninstall, which is the delete grant here.',
  settings:
    'Per-plugin settings documents — shipping, storefront, booking policy — ' +
    'each written by its own console settings card.',
  media: 'Host media library documents: alt text, tags and folder moves.',
  mediaFolders: 'Media library folders, created and renamed in the DAM.',
  activity: 'The site activity feed, appended by the tenant activity logger.',
  orders:
    'Commerce orders. All three lists exclude the name (AGL-1827) and the ' +
    'dedicated block re-grants exactly the status-frozen update the console ' +
    'makes when adding a note or restocking.',
  products: 'The catalog. Written by the products hub and product editor.',
  productCategories:
    'Catalog taxonomy, reordered and renamed in the catalog organization card.',
  suppliers: 'Supplier records, edited in the product editor dialog.',
  inventoryAdjustments:
    'Stock adjustment ledger rows, written when a merchant edits inventory ' +
    'in the products hub.',
  locations: 'Physical locations, authored in the locations card.',
  reservations: 'POS/booking holds, created and released from the POS page.',
  resources: 'Bookable resources, authored in the reservations card.',
  coupons: 'Coupon codes, authored in the coupons card.',
  discounts: 'Automatic discounts, authored in the discounts card.',
  licenseKeys:
    'Digital-product license keys, issued and revoked from the products hub.',
  memberPosts: 'Members-only posts, authored in the member posts card.',
  reviews: 'Product reviews, approved and hidden in the moderation card.',
  subscriptions:
    'Site membership subscriptions, adjusted from the site member drawer.',
  siteMembers:
    'Site member profiles, edited from the site member drawer and accounts ' +
    'card. Distinct from `members`, the ORG-facing roster AGL-1367 denied.',
  services: 'Bookable services, authored in the bookings console page.',
  bookings: 'Booking records, rescheduled and cancelled in the same page.',
  events: 'Calendar events, authored in the events console page.',
  campaigns: 'Email campaigns, authored in the campaigns card.',
  emailTemplates: 'Transactional email templates, edited in the console.',
  leads: 'Captured leads, triaged and deleted in the inbox console page.',
  formSubmissions:
    'Create is denied (AGL-1668) because the row is what the meter counts; ' +
    'update and delete stay open because the inbox marks a submission read ' +
    'and deletes it client-side.',
}

/**
 * Host subcollections with NO client-SDK writer that are nonetheless still
 * reachable through the catch-all, pending a decision of their own.
 *
 * Every name here was checked twice — no `'hosts', hostId, '<name>'` client
 * path anywhere in `apps` or `libs`, and no `addDoc`/`setDoc`/`updateDoc`/
 * `deleteDoc` against one — so denying them would cost the product nothing on
 * current evidence. They are NOT denied in this commit deliberately: each
 * wants its own emulator negative control, and a rules deploy is already owed
 * for AGL-2038. An entry must cite the issue that will close it, so this
 * cannot quietly become a parking lot.
 */
const SERVER_WRITTEN_NOT_YET_DENIED: Record<string, string> = {
  carts: 'Written only by libs/plugins/commerce server routes. AGL-2042.',
  checkouts:
    'Checkout sessions, written only by cart-checkout.ts server-side. AGL-2042.',
  giftCards:
    'Stored value, issued and redeemed by the commerce billing webhook ' +
    'server-side. The one on this list with money in it. AGL-2042.',
  stripeTaxRates:
    'A server-side cache of Stripe tax rate ids, written by ' +
    'manual-tax-rate.ts. AGL-2042.',
  restockAlerts:
    'Shopper emails captured by an unauthenticated storefront endpoint ' +
    '(notify-restock.ts, Admin SDK). AGL-2042.',
  suppressions:
    'Email suppression list, read by campaign-send.ts and written ' +
    'server-side. AGL-2042.',
}

const hostSubcollectionsInRepo = (() => {
  const files: string[] = []
  const walk = (directory: string): void => {
    let entries: ReturnType<typeof readdirSync>
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(path)
        continue
      }
      // Specs are excluded on purpose: a fixture path in a test is not a
      // storage decision, and demanding a classification for one would train
      // people to add entries they do not mean.
      if (!/\.tsx?$/.test(entry.name)) continue
      if (/\.(spec|test)\.tsx?$/.test(entry.name)) continue
      files.push(path)
    }
  }
  for (const root of SOURCE_ROOTS) walk(resolve(REPO_ROOT, root))

  // Three shapes, all anchored on the host. A bare `.collection('x')` would
  // sweep in every nested and org-level collection in the repo — the same
  // binding mistake the billing sweep above documents.
  const patterns = [
    /'hosts',\s*[A-Za-z0-9_.$[\]]+,\s*'([A-Za-z][A-Za-z0-9]*)'/g,
    /\.collection\(\s*'hosts'\s*\)\s*\.doc\([^()]*\)\s*\.collection\(\s*'([A-Za-z][A-Za-z0-9]*)'\s*\)/g,
    /\b(?:hostRef|hostDoc|host\.ref)\s*\.\s*collection\(\s*'([A-Za-z][A-Za-z0-9]*)'\s*\)/g,
  ]
  const found = new Set<string>()
  for (const path of files) {
    const source = readFileSync(path, 'utf8')
    for (const pattern of patterns) {
      for (const hit of source.matchAll(pattern)) found.add(hit[1])
    }
  }
  return [...found].sort()
})()

describe('every host subcollection is classified (AGL-2038)', () => {
  const rules = parseHostSubcollectionRules(read(RULES_FILE))

  it('sweeps a plausible set of host subcollections off the source tree', () => {
    // The floor. A regex that stopped matching would empty this sweep and
    // leave the guard below asserting nothing about nothing, forever green —
    // AGL-2002's shape exactly: a guard that reports green without having
    // asserted anything is worse than no guard, because it is believed.
    //
    // Worth knowing where this one runs. AGL-2002 found that the emulator
    // rules suite executes in NO CI workflow — nx-ci.yml excludes
    // `npm run test:rules` deliberately, since it needs a JVM and the
    // emulator — so the behavioural companion to this file is, today, a
    // local-only proof. THIS spec is an ordinary jest unit test under
    // libs/aglyn and does run in CI, which is the second reason AGL-2038
    // put the durable half at commit time rather than in the rules.
    expect(hostSubcollectionsInRepo.length).toBeGreaterThanOrEqual(40)
    expect(hostSubcollectionsInRepo).toEqual(
      expect.arrayContaining([
        'screens',
        'counters',
        'products',
        'registers',
        'screenAnalytics',
      ]),
    )
  })

  it('leaves no host subcollection unclassified', () => {
    const unclassified = hostSubcollectionsInRepo.filter(
      (name) =>
        !rules.serverOnly.includes(name) &&
        !(name in EDITOR_WRITABLE_HOST_SUBCOLLECTIONS) &&
        !(name in SERVER_WRITTEN_NOT_YET_DENIED),
    )
    if (unclassified.length > 0) {
      throw new Error(
        `These host subcollections exist in the codebase and nobody has said ` +
          `whether a site EDITOR may write them:\n\n` +
          `${unclassified.map((name) => `  • hosts/{hostId}/${name}`).join('\n')}\n\n` +
          `The host catch-all in ${RULES_FILE} is PERMISSIVE by default — it ` +
          `grants create/update/delete to anyone passing ` +
          `\`canWriteHostContent(hostId)\` unless the name appears in its ` +
          `exclusion lists — so a subcollection nobody classified is a ` +
          `subcollection every editor can already write. That is how ` +
          `\`screenAnalytics\` (AGL-2038) and \`registers\` (AGL-1775) got ` +
          `there, and neither was noticed by reading the rules.\n\n` +
          `Decide, on this commit:\n` +
          `  • server-owned — add the name to ALL THREE ` +
          `\`subcollection in […]\` exclusion lists. All three: one list is ` +
          `not denial, and a dedicated \`allow write: if false\` block does ` +
          `NOT close it, because sibling match blocks are OR'd and the looser ` +
          `one wins;\n` +
          `  • editor-authored — add it to ` +
          `EDITOR_WRITABLE_HOST_SUBCOLLECTIONS with the authoring surface ` +
          `that writes it, so the next person narrowing these rules knows ` +
          `what they would break;\n` +
          `  • server-written but not yet denied — add it to ` +
          `SERVER_WRITTEN_NOT_YET_DENIED with the issue that will close it.\n\n` +
          `When in doubt, deny: every writer of the collections AGL-1367 and ` +
          `AGL-2038 closed was already an Admin-SDK route, so denying them ` +
          `changed nothing about the product.`,
      )
    }
  })

  it('keeps the classifications from contradicting the rules', () => {
    for (const name of Object.keys(EDITOR_WRITABLE_HOST_SUBCOLLECTIONS)) {
      // Claiming a name is editor-authored while the rules deny it outright
      // is a lie in one direction or the other, and the reason text is what
      // the next narrowing decision gets read off.
      expect([name, rules.serverOnly.includes(name)]).toEqual([name, false])
    }
    for (const name of Object.keys(SERVER_WRITTEN_NOT_YET_DENIED)) {
      // Once it IS denied the entry has to go, or the list stops meaning
      // "still open" and becomes scenery.
      expect([name, rules.serverOnly.includes(name)]).toEqual([name, false])
    }
    for (const name of Object.keys(EDITOR_WRITABLE_HOST_SUBCOLLECTIONS)) {
      expect([name, name in SERVER_WRITTEN_NOT_YET_DENIED]).toEqual([
        name,
        false,
      ])
    }
  })

  it('keeps the classifications from going stale', () => {
    const entries = [
      ...Object.entries(EDITOR_WRITABLE_HOST_SUBCOLLECTIONS),
      ...Object.entries(SERVER_WRITTEN_NOT_YET_DENIED),
    ]
    for (const [name, reason] of entries) {
      // A classified name that no longer appears anywhere is a decision about
      // a collection that no longer exists — the stale entry the guard's own
      // header warns is where the next hole hides.
      expect([name, hostSubcollectionsInRepo.includes(name)]).toEqual([
        name,
        true,
      ])
      expect([name, reason.length > 30]).toEqual([name, true])
    }
    for (const [name, reason] of Object.entries(SERVER_WRITTEN_NOT_YET_DENIED)) {
      // Not a parking lot: something has to be tracking the decision.
      expect([name, /AGL-\d+/.test(reason)]).toEqual([name, true])
    }
  })
})
