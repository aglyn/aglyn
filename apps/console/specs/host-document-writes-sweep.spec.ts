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
 * EVERY WRITE OF SOMETHING A PUBLISHED PAGE RENDERS ASKS FOR THE DROP
 * (AGL-3386).
 *
 * The live site is ISR-cached for an hour. A publish drops that cache; a
 * settings save, a theme install and an API write did not, so each of them
 * waited out the hour while the surface that made it reported success. The
 * fix is a door per side — `useHost` / `updateHostDocument` in the console,
 * `writeSiteWideChange` for a plugin's card, `dropPluginSiteCache` for a
 * plugin's server route, an announce inside each `/v1` write handler — and
 * this file is what keeps the next writer from walking around it. It reads
 * source, because the omission it guards against is a line that is not
 * there, and no rendered test of the writer that exists can see the writer
 * that does not yet.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const REPO = join(__dirname, '..', '..', '..')
const CONSOLE = join(REPO, 'apps', 'console')
const PLUGINS = join(REPO, 'libs', 'plugins')

const posix = (path: string) => relative(REPO, path).split(sep).join('/')

function sourcesUnder(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...sourcesUnder(path))
      continue
    }
    if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.includes('.spec.') &&
      !entry.name.endsWith('.d.ts')
    ) {
      found.push(path)
    }
  }
  return found
}

/**
 * A write to `hosts/{id}` itself — not to a subcollection under it — by any
 * of the shapes the client SDK takes: the ref inline, or held in a variable
 * first. `doc(db, 'hosts', id)` with exactly three arguments is the host
 * document; a fourth segment is a subcollection path.
 */
const HOST_DOC = String.raw`doc\(\s*[\w.]+\s*,\s*['"]hosts['"]\s*,\s*[^,()]+\)`
const INLINE_WRITE = new RegExp(
  String.raw`(?:\b(?:updateDoc|setDoc)\(|\.(?:update|set)\()\s*` + HOST_DOC + String.raw`\s*,`,
)
const HELD_REF = new RegExp(String.raw`const\s+(\w+)\s*=\s*` + HOST_DOC, 'g')

function writesHostDocument(source: string): boolean {
  if (INLINE_WRITE.test(source)) return true
  for (const [, name] of source.matchAll(HELD_REF)) {
    const held = new RegExp(
      String.raw`(?:\b(?:updateDoc|setDoc)\(|\.(?:update|set)\()\s*${name}\s*,`,
    )
    if (held.test(source)) return true
  }
  return false
}

describe('the sweep can see a host-document write', () => {
  // Premise guards: a regex that matches nothing would pass every case below
  // against an empty set.
  it.each([
    "await updateDoc(doc(firestore, 'hosts', hostId), { theme })",
    "batch.update(doc(firestore, 'hosts', hostId), { screens })",
    "const ref = doc(firestore, 'hosts', hostId)\nawait setDoc(ref, { seo }, { merge: true })",
  ])('%s', (source) => {
    expect(writesHostDocument(source)).toBe(true)
  })

  it.each([
    "await updateDoc(doc(firestore, 'hosts', hostId, 'products', id), { name })",
    "const snap = await getDoc(doc(firestore, 'hosts', hostId))",
    "useFirestoreDoc(() => doc(firestore, 'hosts', hostId), [firestore, hostId])",
  ])('and does not mistake %s for one', (source) => {
    expect(writesHostDocument(source)).toBe(false)
  })
})

describe('console: every host-document write goes through the door', () => {
  const files = sourcesUnder(CONSOLE).map((path) => ({
    path: posix(path),
    source: readFileSync(path, 'utf8'),
  }))

  it('reads the console it means to sweep', () => {
    expect(files.length).toBeGreaterThan(500)
  })

  /**
   * The library's `useHost` hands back a setter that saves and says nothing
   * to the live site. The console's own hook wraps it; importing the
   * library's directly is how a new settings card would get the silent one.
   */
  it("imports useHost only from the console's own hook", () => {
    const offenders = files
      .filter(({ path }) => path !== 'apps/console/hooks/use-host.ts')
      .filter(({ source }) =>
        [
          ...source.matchAll(
            /import\s*\{([^}]*)\}\s*from\s*'@aglyn\/tenant-feature-instance'/g,
          ),
        ].some(([, names]) =>
          names.split(',').some((name) => name.trim() === 'useHost'),
        ),
      )
      .map(({ path }) => path)
    expect(offenders).toEqual([])
  })

  /**
   * Writers that may touch the host document without the door, each with
   * why. Server routes are not in scope here — they write with the Admin SDK,
   * and each announces for itself.
   */
  const EXEMPT: Record<string, string> = {
    'apps/console/utils/host-document-writes.ts': 'The door itself.',
    'apps/console/constants/screen-publishing.ts':
      'Writes only the routing map, in the same batch as a publish outbox ' +
      'entry, and announces the exact addresses it changed — narrower than ' +
      'the whole-site drop the door would add.',
  }

  it('writes the host document only through updateHostDocument or useHost', () => {
    const offenders = files
      .filter(
        ({ path }) =>
          !path.startsWith('apps/console/app/api/') &&
          !path.startsWith('apps/console/utils/server/') &&
          !(path in EXEMPT),
      )
      .filter(({ source }) => writesHostDocument(source))
      .map(({ path }) => path)
    expect(offenders).toEqual([])
  })

  it('keeps every exemption honest', () => {
    // An exempt file that no longer writes the host document is a hole with a
    // reason attached to nothing.
    for (const path of Object.keys(EXEMPT)) {
      const file = files.find((candidate) => candidate.path === path)
      expect([path, Boolean(file)]).toEqual([path, true])
      if (path === 'apps/console/utils/host-document-writes.ts') continue
      expect([path, writesHostDocument(file?.source ?? '')]).toEqual([path, true])
    }
  })
})

describe("plugins: a console card's write of something a page renders carries the drop", () => {
  /**
   * Every document a plugin's console code writes under a host, by what a
   * published page makes of it. Keyed by the first path segment under
   * `hosts/{id}` — `(host)` is the host document itself.
   *
   * RENDERED means the tenant reads it while building a page it caches: the
   * write must go through `writeSiteWideChange` (or stage its entry with
   * `commitWithSiteWideEntry` inside a transaction), so the site's cache drop
   * commits with it. The reasons on the other side are what a page does
   * INSTEAD — read it per request, fetch it from the browser, or never.
   *
   * A write to a segment in neither list fails the build until somebody
   * decides, which is the point: the sweep cannot know whether a new
   * collection renders, and guessing "no" is how the hour-long cache came to
   * be the mechanism for every setting in the first place.
   */
  const RENDERED: Record<string, string> = {
    '(host)': 'Site settings the tenant layout reads (see SITE_RENDERED_HOST_FIELDS).',
    products: 'The PDP at /products/{slug} is composed server-side from the product.',
    reviews: 'The PDP renders the approved reviews’ star aggregate server-side.',
    variables: 'Read at render through the tenant-data cache (get-variables).',
    functions: 'Read at render through the tenant-data cache (get-variables).',
    overlays: 'Read at render through the tenant-data cache (get-overlays).',
    experiments: 'Read at render by the marketing page enricher.',
    installs: 'Which plugin version a page loads is read at render (get-plugin-installs).',
    settings:
      '`settings/store` names the PDP and collection templates the resolver renders.',
  }
  const UNRENDERED: Record<string, string> = {
    actions: 'Automation, run server-side on events; never on a page.',
    workflows: 'Automation, run server-side on events; never on a page.',
    webhooks: 'Outbound delivery configuration; never on a page.',
    bookings: 'Appointments; the booking widget asks its API per visit.',
    services: 'Read only by the booking widget’s API, fetched from the browser.',
    events: 'Read only by the events API, fetched from the browser (60s CDN cache).',
    coupons: 'Read only at checkout.',
    discounts: 'Read only at checkout.',
    orders: 'The order book; never on a page.',
    licenseKeys: 'Issued at fulfilment; never on a page.',
    inventoryAdjustments:
      'The stock log; the product write beside each entry carries the drop.',
    suppliers: 'Purchasing; never on a page.',
    registers: 'Point of sale; never on a page.',
    reservations: 'Availability is computed per request by the reservation API.',
    resources: 'Availability is computed per request by the reservation API.',
    locations: 'No tenant reader; used by POS and fulfilment.',
    memberPosts: 'The member feed API answers per member, private and no-store.',
    productCategories:
      'Read only by the catalog API, fetched from the browser (60s CDN cache).',
    forms:
      'The placed design renders from the nodes /api/forms/promote writes ' +
      'and announces; these writes are fields, names, routing, archive state ' +
      'and the draft pointer, which the tenant reads per submission.',
    formSubmissions: 'The inbox; never on a page.',
    screens: 'The email plugin’s documents are emails, never routed.',
    suppressions: 'Email suppression list; never on a page.',
  }
  /** Segments whose writes announce their own addresses instead. */
  const OWN_ANNOUNCE: Record<string, string> = {
    redirects:
      'A rule names its own source, and the redirects manager posts it to ' +
      '/api/screens/revalidate as `redirectPath`.',
  }
  /**
   * Plugin writers of a rendered segment that owe no drop, each with why.
   * Checked against the payload below, so an exempt card that starts writing
   * something a page renders loses its exemption.
   */
  const EXEMPT: Record<string, { writes: RegExp; why: string }> = {
    'libs/plugins/commerce/src/lib/components/console/shipping-settings-card.component.tsx':
      {
        writes: /\{\s*shipping:\s*current\s*\}/,
        why:
          'Writes only `settings/store.shipping`, which checkout reads per ' +
          'request; no cached page renders the rates.',
      },
    'libs/plugins/commerce/src/lib/components/console/tax-settings-card.component.tsx':
      {
        writes: /\{\s*tax:\s*current\s*\}/,
        why:
          'Writes only `settings/store.tax`, which checkout reads per ' +
          'request; no cached page renders the rates.',
      },
  }

  const files = sourcesUnder(PLUGINS)
    .filter((path) => !/[/\\]server[/\\]|[/\\]server\.ts$/.test(path))
    .map((path) => ({ path: posix(path), source: readFileSync(path, 'utf8') }))

  /** The first segment under `hosts/{id}` of every document this file writes. */
  function writtenSegments(source: string): Set<string> {
    const flat = source.replace(/\s+/g, ' ')
    const segments = new Set<string>()
    const WRITE = String.raw`(?:\b(?:setDoc|updateDoc|deleteDoc|addDoc)\(|\.(?:set|update|delete)\()\s*`
    const TARGET = String.raw`(?:doc|collection)\(\s*[\w.]+\s*,\s*'hosts'\s*,\s*[^,()]+(?:\([^()]*\))?\s*(?:,\s*'(\w+)')?`
    for (const match of flat.matchAll(new RegExp(WRITE + TARGET, 'g'))) {
      segments.add(match[1] ?? '(host)')
    }
    const held = new RegExp(
      String.raw`const (\w+) = doc\(\s*[\w.]+\s*,\s*'hosts'\s*,\s*[^,()]+\s*(?:,\s*'(\w+)')?`,
      'g',
    )
    for (const match of flat.matchAll(held)) {
      const writes = new RegExp(WRITE + String.raw`${match[1]}\s*,`)
      if (writes.test(flat)) segments.add(match[2] ?? '(host)')
    }
    return segments
  }

  const writers = files
    .map((file) => ({ ...file, segments: writtenSegments(file.source) }))
    .filter(({ segments }) => segments.size > 0)

  it('reads the plugins it means to sweep', () => {
    expect(files.length).toBeGreaterThan(200)
    // Premise guard: writers this was written against, found by the parse.
    const found = new Map(writers.map(({ path, segments }) => [path, segments]))
    expect(
      found.get('libs/plugins/marketing/src/lib/components/popup-card.component.tsx'),
    ).toEqual(new Set(['(host)']))
    expect(
      found.get(
        'libs/plugins/commerce/src/lib/components/console/product-editor-dialog.component.tsx',
      ),
    ).toEqual(new Set(['products']))
    expect(
      found.get('libs/plugins/logic/src/lib/components/host-variables-card.component.tsx'),
    ).toEqual(new Set(['variables']))
  })

  it('classifies every host-scoped segment a plugin card writes', () => {
    const unclassified = writers.flatMap(({ path, segments }) =>
      [...segments]
        .filter(
          (segment) =>
            !(segment in RENDERED) &&
            !(segment in UNRENDERED) &&
            !(segment in OWN_ANNOUNCE),
        )
        .map((segment) => `${path} → ${segment}`),
    )
    expect(unclassified).toEqual([])
  })

  it('carries the drop from every writer of a rendered segment', () => {
    const silent = writers
      .filter(({ path }) => !(path in EXEMPT))
      .filter(({ segments }) => [...segments].some((segment) => segment in RENDERED))
      .filter(
        ({ source }) =>
          !/\bwriteSiteWideChange\(/.test(source) &&
          !/\bcommitWithSiteWideEntry\(/.test(source),
      )
      .map(({ path }) => path)
    expect(silent).toEqual([])
  })

  it('writes a rendered segment ONLY inside the helper — no bare write beside it', () => {
    // A file that calls the helper once and writes a rendered document
    // directly elsewhere passes the case above while that second write stays
    // silent. So the bare SDK calls are read for their target, and none may
    // name a rendered segment.
    const bare = writers
      .filter(({ path }) => !(path in EXEMPT))
      .flatMap(({ path, source }) => {
        const flat = source.replace(/\s+/g, ' ')
        const direct = new RegExp(
          String.raw`\b(?:setDoc|updateDoc|deleteDoc|addDoc)\(\s*(?:doc|collection)\(\s*[\w.]+\s*,\s*'hosts'\s*,\s*[^,()]+(?:\([^()]*\))?\s*(?:,\s*'(\w+)')?`,
          'g',
        )
        return [...flat.matchAll(direct)]
          .map((match) => match[1] ?? '(host)')
          .filter((segment) => segment in RENDERED)
          .map((segment) => `${path} → ${segment}`)
      })
    expect(bare).toEqual([])
  })

  it('keeps every exemption to the payload it was granted for', () => {
    for (const [path, { writes }] of Object.entries(EXEMPT)) {
      const file = files.find((candidate) => candidate.path === path)
      expect([path, Boolean(file)]).toEqual([path, true])
      expect([path, writes.test(file?.source ?? '')]).toEqual([path, true])
      // One settings write, and it is the one above.
      const settingsWrites = (file?.source ?? '').match(
        /\b(?:updateDoc|setDoc)\(\s*doc\(\s*[\w.]+\s*,\s*['"]hosts['"]/g,
      )
      expect([path, settingsWrites?.length]).toEqual([path, 1])
    }
  })

  it('lets a segment announce its own addresses only where it really does', () => {
    const silent = writers
      .filter(({ segments }) => [...segments].some((segment) => segment in OWN_ANNOUNCE))
      .filter(({ source }) => !source.includes("'/api/screens/revalidate'"))
      .map(({ path }) => path)
    expect(silent).toEqual([])
  })
})

describe("plugins: a server route that writes a site's theme drops its pages", () => {
  /**
   * `themeInstalledFrom` is written only beside a theme — it is the
   * provenance of the one on the host — so it marks every server path that
   * changes what every page is styled with.
   */
  const writers = sourcesUnder(PLUGINS)
    .filter((path) => /[/\\]server[/\\]/.test(path))
    .map((path) => ({ path: posix(path), source: readFileSync(path, 'utf8') }))
    .filter(({ source }) => /\bthemeInstalledFrom\s*:/.test(source))

  it('finds the theme writers', () => {
    expect(writers.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        'libs/plugins/marketplace/src/lib/server/install-theme.ts',
        'libs/plugins/marketplace/src/lib/server/update-artifact.ts',
      ]),
    )
  })

  it('each calls dropPluginSiteCache', () => {
    const silent = writers
      .filter(({ source }) => !/\bdropPluginSiteCache\(/.test(source))
      .map(({ path }) => path)
    expect(silent).toEqual([])
  })

  it('install-theme drops after every action that writes', () => {
    const source =
      writers.find(({ path }) => path.endsWith('/install-theme.ts'))?.source ?? ''
    // A write is a direct `hostRef.set` or a theme-library action, which
    // writes the host in its own transaction (AGL-3404).
    const writes =
      source.match(/await hostRef\.set\(|runThemeLibraryAction\(tx, hostRef/g) ?? []
    const drops = source.match(/await repaintLiveSite\(/g) ?? []
    expect(writes.length).toBeGreaterThanOrEqual(4)
    expect(drops.length).toBe(writes.length)
  })
})

describe('/v1: every write handler of rendered data announces', () => {
  /**
   * Each function in the `/v1` resource modules that writes Firestore, and
   * what a published page makes of the write. `announces` names the call
   * that must appear in its body; `unrendered` says why none is owed. A new
   * write handler fails here until somebody decides which it is.
   */
  const HANDLERS: Record<string, { announces: string } | { unrendered: string }> = {
    'api-v1-resources.ts#createDataset': {
      unrendered: 'A new dataset holds no rows, and no page is bound to it yet.',
    },
    'api-v1-resources.ts#updateDataset': { announces: 'announceDatasetChange' },
    'api-v1-resources.ts#deleteDataset': {
      unrendered:
        'Refused while any record remains, so a bound page showed no rows ' +
        'before and shows none after.',
    },
    'api-v1-resources.ts#createRecord': { announces: 'announceDatasetChange' },
    'api-v1-resources.ts#updateRecord': { announces: 'announceDatasetChange' },
    'api-v1-resources.ts#deleteRecord': { announces: 'announceDatasetChange' },
    'api-v1-resources.ts#createSite': {
      unrendered: 'A new site has no cached pages to be stale.',
    },
    'api-v1-resources.ts#handlePublish': { announces: 'postTenantRevalidate' },
    'api-v1-resources.ts#updateFormSubmission': {
      unrendered: 'Inbox state; submissions never render on the site.',
    },
    'api-v1-resources.ts#deleteFormSubmission': {
      unrendered: 'Inbox state; submissions never render on the site.',
    },
    'api-v1-resources.ts#updateOrder': {
      unrendered:
        'Status, carrier and tracking number only — the order book is not ' +
        'on any page, and a shipment moves no stock.',
    },
    'api-v1-resources.ts#createMedia': {
      unrendered:
        'Create only: a new file is on no page until one references it. The ' +
        'API has no replace or delete for media.',
    },
  }
  /**
   * The CRM's resources, served from the plugin (AGL-3080): whole modules
   * that hold CRM records only, none of them rendered.
   */
  const CRM_API_V1 = join(PLUGINS, 'crm', 'src', 'lib', 'server', 'api-v1')
  const CRM_MODULES = /^crm-|^contacts(?:-merge)?\.ts$/

  const WRITE = [
    /\bawait\s+[\w$]+(?:\s*(?:\.\w+|\((?:[^()]|\([^()]*\))*\)))*?\s*\.(?:create|update|set|delete)\(/,
    /\b(?:batch|tx|transaction)\.(?:create|update|set|delete)\(/,
    /\brunTransaction\(/,
  ]

  function functionsOf(file: string): Array<{ key: string; body: string }> {
    const source = readFileSync(join(CONSOLE, 'utils', file), 'utf8')
    const starts = [...source.matchAll(/^(?:export )?(?:async )?function (\w+)/gm)]
    return starts.map((match, index) => ({
      key: `${file}#${match[1]}`,
      body: source.slice(match.index, starts[index + 1]?.index ?? source.length),
    }))
  }

  const functions = functionsOf('api-v1-resources.ts')
  const writeHandlers = functions.filter(({ body }) =>
    WRITE.some((pattern) => pattern.test(body)),
  )

  it('finds the write handlers it means to classify', () => {
    expect(writeHandlers.map(({ key }) => key)).toEqual(
      expect.arrayContaining([
        'api-v1-resources.ts#createRecord',
        'api-v1-resources.ts#updateDataset',
        'api-v1-resources.ts#createMedia',
      ]),
    )
  })

  it('classifies every one of them', () => {
    const unclassified = writeHandlers
      .map(({ key }) => key)
      .filter((key) => !(key in HANDLERS))
    expect(unclassified).toEqual([])
  })

  it('names only functions that exist', () => {
    // Some entries write through a helper rather than directly (the publish,
    // a site create, an order update), so detection alone would never check
    // them; the table still has to describe code that is there.
    const known = new Set(functions.map(({ key }) => key))
    expect(Object.keys(HANDLERS).filter((key) => !known.has(key))).toEqual([])
  })

  it('announces from every handler of rendered data', () => {
    const silent = functions
      .filter(({ key }) => {
        const entry = HANDLERS[key]
        return entry && 'announces' in entry
      })
      .filter(({ key, body }) => {
        const entry = HANDLERS[key] as { announces: string }
        return !new RegExp(String.raw`\b${entry.announces}\(`).test(body)
      })
      .map(({ key }) => key)
    expect(silent).toEqual([])
  })

  it('keeps the CRM modules free of anything a page renders', () => {
    // They write only under `orgs/{orgId}` CRM collections. A write into a
    // host from one of them is a new kind of write, and belongs in the table
    // above instead of under this blanket.
    const dir = CRM_API_V1
    const crm = readdirSync(dir).filter(
      (name) => CRM_MODULES.test(name) && !name.includes('.spec.'),
    )
    expect(crm.length).toBeGreaterThan(3)
    const intoHosts = crm.filter((name) =>
      /collection\(\s*['"]hosts['"]\s*\)[\s\S]{0,200}?\.(?:create|update|set|delete)\(/.test(
        readFileSync(join(dir, name), 'utf8'),
      ),
    )
    expect(intoHosts).toEqual([])
  })
})
