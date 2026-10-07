/**
 * @license
 * Copyright 2026 Aglyn LLC
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *   http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Fail when a plugin's domain lives outside its plugin (AGL-3080, from AGL-2939).
//
//   npm run check:plugin-domain-in-core
//   npm run check:plugin-domain-in-core -- --json
//   npm run check:plugin-domain-in-core -- --prune     # drop rows that no longer excuse anything
//   node tools/scripts/check-plugin-domain-in-core.mjs --fixture   # the forced-red self-test
//
// docs/PACKAGES.md rule 3: a plugin's code lives only in its own plugin, and
// every tree below a plugin gets generic extension points only. Each package
// is meant to be taken on its own, so a core that names CRM, a renderer that
// names datasets or an app that names a video vendor is a package nobody can
// take without the rest. `check:lib-boundaries` judges the import graph and
// cannot see any of this, because a plugin's model parked in the core is a
// legal edge. Seven things erode the rule silently and this guard refuses each.
// Rules 5 to 7 came from a CONTENT sweep (2026-09-20): judging names alone
// had missed every file with a neutral one.
//
//  1. DOMAIN NAME — a file or a route directory in a guarded tree named for a
//     plugin's domain (`crm-deals.ts`, `app/.../marketplace/`). The name is a
//     proxy, and a cheap one: nobody names a generic seam after one plugin.
//
//  2. VENDOR LITERAL — a named vendor's host, header, model id or SDK outside
//     the adapter that is its home. An AI vendor's literal is refused in every
//     tree, other plugins included; the rest are refused in the guarded trees.
//
//  3. PLUGIN ID — a quoted first-party plugin id in a guarded tree: a switch
//     over plugin ids, a hand-written catalog, a `requires: ['commerce']`.
//     Ids that are also ordinary words (`data`, `email`, `forms`, `logic`,
//     `ai`, `mui`) are not matched; the distinctive ones carry the rule.
//
//  4. PLUGIN IMPORT — a guarded tree importing `@aglyn/plugins-*`, or a
//     relative path into `libs/plugins/`, outside the generated manifests.
//     Apps reach every plugin through the loader manifests and the core
//     registries.
//
//  5. PLUGIN COLLECTION — a Firestore collection one plugin owns, addressed
//     from outside it: a plugin's storage reached around the plugin, which no
//     import and no filename gives away.
//
//  6. DOMAIN EXPORTS — a file, whatever it is called, whose exports are mostly
//     one plugin's vocabulary.
//
//  7. DOMAIN DECLARES — ANY declaration in a plugin's vocabulary inside a file:
//     the platform file with a plugin's rows, keys or types mixed into it.
//
// Rule 3 says "nor in another plugin" as well, and two of its breaches are as
// invisible to `check:lib-boundaries` between plugins as between a plugin and
// core, because neither is an import. So inside `libs/plugins/<dir>/` two
// rules hold what one plugin may not do to another:
//
//  5. PLUGIN COLLECTION, again — a Firestore collection ANOTHER plugin owns,
//     addressed from this one. The owner publishes a record index, card,
//     facts reader or figure reader; the reader asks it.
//
//  8. CONSOLE PATH — an address on ANOTHER plugin's console surface, built
//     here: its nav slug as a `pluginSlug`, a `*_SLUG` constant or a path
//     segment, or a core route that is its page (`Route.FORM_DETAILS`). The
//     owner publishes the address under a record kind
//     (`plugin-record-routes`); the linking plugin asks for the kind. The
//     slugs are read from each plugin's own `plugin.ts` nav items, so a new
//     surface is covered the day it lands.
//
// ## The allowlist, and why it may only shrink
//
// `plugin-domain-in-core-allowlist.json` has one row per file that trips a
// rule today: the rules it trips and the `lane` of AGL-3080 that moves it. A
// row with `"lane": "stays"` is a binding argued to be the platform's own and
// carries its argument in `why` — rule 3 of the map asks for exactly that, in
// writing. The guard is red for a finding with no row AND for a row, or one
// rule on a row, that nothing trips any more, so the list cannot outlive what
// it excuses; `--prune` removes those and can never add one. A NEW file is
// refused rather than recorded.
//
// Exit codes: 0 clean · 1 a finding or a stale row · 2 the self-test failed.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const ALLOWLIST = join(ROOT, 'tools/scripts/plugin-domain-in-core-allowlist.json')

/** Every tree that is not a plugin. `libs/plugins/**` is where a domain belongs. */
const GUARDED =
  /^(?:libs\/(?:aglyn|aglyn-node-renderer|aglyn-markdown-editor|aglyn-transfer-ui|besigner|cli|shared|tenant)\/|apps\/(?:console|tenant)\/|cloud\/|tools\/)/

/** The one place a guarded tree may name a plugin package: the generated manifests. */
const MANIFEST = /^apps\/[^/]+\/(?:constants|utils)\/plugins\.[a-z.]*generated\.ts$/

const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/
const SPEC = /\.(?:spec|test|e2e)\.(?:[tj]sx?|mjs)$|\/fixtures\//
// Generated output is not authored code. The icon set is one path per icon,
// and an icon NAMED `inbox` or `shopping` is a drawing, not the plugin.
const GENERATED = /\.generated\.ts$|^libs\/shared\/data\/mdi\/generated\//

/**
 * Rule 1. A domain token opens the file's name, or names a directory on an
 * app's route path. `form` and `contact` are matched because the forms and
 * CRM models are the two widest violations; the handful of generic files that
 * share the word are `stays` rows with their reason.
 */
const DOMAIN_TOKENS =
  'crm|contacts?|marketplace|publisher|campaigns?|datasets?|forms?|bookings?|commerce|outreach|workflows?|actions|automation|wistia|ga4|assist|email-topics?|dynamic-list|list-(?:members|import|assignment)|connect-(?:account|payout)|stripe-account'
const DOMAIN_FILE = new RegExp(`(?:^|/)(${DOMAIN_TOKENS})(?:[-.][^/]*)?\\.(?:tsx?|mjs)$`)
const DOMAIN_DIR = /^apps\/[^/]+\/.*\/(crm|contacts|marketplace|campaigns?|datasets?|forms|bookings|commerce|outreach|workflows)\//

/**
 * Rule 2. `home` is where the literal may live. `everywhere` extends the
 * sweep past the guarded trees, which is the AI rule as AGL-2939 wrote it:
 * no other plugin may grow a model vendor of its own either.
 *
 * The mail vendor's home is its provider module behind the platform's
 * mail-provider contract (`mail-providers.ts` picks it by configuration),
 * not a plugin: the transactional rail sends password resets, receipts and
 * operator alerts from every server process with no plugin loaded, and a
 * provider a plugin registered is one that can be silently absent. The rest
 * of the rail names no vendor, which is what this rule holds.
 */
export const VENDOR_LITERALS = [
  { vendor: 'ai', pattern: /api\.anthropic\.com|anthropic-version|\bclaude-[a-z0-9-]+|api\.openai\.com/, home: 'libs/plugins/ai/src/lib/providers/', everywhere: true },
  { vendor: 'ga4', pattern: /googletagmanager\.com|google-analytics\.com|\bgtag\(/ },
  { vendor: 'wistia', pattern: /wistia/i },
  {
    vendor: 'resend',
    pattern: /api\.resend\.com|from\s+['"]resend['"]/,
    home: 'libs/shared/util/email/src/lib/mail-provider-resend',
  },
]

/**
 * Rule 5. A Firestore collection one plugin owns, addressed from outside it.
 *
 * The content sweep of 2026-09-20 found the class every other rule is blind
 * to: a file with a neutral name that reads or writes `hosts/{id}/products`,
 * `…/datasets`, `…/formSubmissions`. That is a plugin's storage reached around
 * the plugin — no import crosses, so `check:lib-boundaries` sees nothing, and
 * no name gives it away. The owner publishes what another surface needs
 * through a seam (a record card, record facts, a metered line, a declared
 * host collection); the path stays the owner's to change.
 *
 * Only names one plugin clearly owns are listed, and only in the shapes that
 * address storage, because a bare quoted word (`row('orders', …)`) is not a
 * read. Platform collections a plugin also touches (`hosts`, `orgs`,
 * `screens`, `suppressions`) are not here.
 */
export const PLUGIN_COLLECTIONS = {
  ai: ['assistExchanges', 'assistSignals', 'assistUsage'],
  bookings: ['bookings', 'services'],
  commerce: ['products', 'productCategories', 'orders', 'carts', 'checkouts', 'coupons', 'discounts', 'giftCards', 'inventoryAdjustments', 'licenseKeys', 'reservations', 'restockAlerts', 'stockHolds', 'suppliers', 'printers', 'printJobs'],
  crm: ['contacts', 'leads', 'companies', 'pipelines', 'deals', 'crmTasks', 'crmActivities', 'contactFields', 'crmViews', 'crmEmailTemplates', 'crmPicklists'],
  data: ['datasets'],
  email: ['emailTopics', 'listMembers'],
  forms: ['formSubmissions'],
  marketing: ['campaigns', 'emailCampaigns', 'experiments', 'overlays', 'campaignConversions'],
  marketplace: ['marketplaceListings', 'marketplacePurchases', 'pluginVersions', 'revocations'],
  workflows: ['workflows', 'webhooks', 'flowEnrollments'],
}

const COLLECTION_OWNER = new Map(
  Object.entries(PLUGIN_COLLECTIONS).flatMap(([owner, names]) => names.map((name) => [name, owner])),
)
const COLLECTION_NAMES = [...COLLECTION_OWNER.keys()].join('|')
/**
 * The shapes that address storage, and no others: a quoted argument of
 * `collection()`, `collectionGroup()` or `doc()`, and a document path under a
 * site or an organization. A `/contacts` URL, a `'./contacts'` import and a
 * `'marketing/experiments'` page key all carry the word and address nothing.
 */
const COLLECTION_ACCESS = new RegExp(
  `(?:\\b(?:collection|collectionGroup|doc)\\([^()]*?['"\`](${COLLECTION_NAMES})['"\`]|\\b(?:hosts|orgs)/[^'"\`\\s]*?/(${COLLECTION_NAMES})(?:/|['"\`]))`,
  'g',
)
/** Generated icon data names thousands of words and addresses no storage. */
const NOT_STORAGE = /^libs\/shared\/data\/mdi\/generated\//

/** The plugins whose storage a file's CODE lines address. */
export function collectionOwnersAddressed(text) {
  const owners = new Set()
  for (const line of text.split('\n')) {
    if (COMMENT_LINE.test(line)) continue
    for (const match of line.matchAll(COLLECTION_ACCESS)) owners.add(COLLECTION_OWNER.get(match[1] ?? match[2]))
  }
  return [...owners].sort()
}

/**
 * Rule 6. A file whose EXPORTS are one plugin's vocabulary, whatever it is
 * called: at least three of them, and at least half of what it exports.
 * `marketing-consent.ts` names no plugin and exports little else, and
 * `node-definition-sanitizer.ts` did until its rule was named for what it
 * guards rather than for the marketplace that first asked. The words are the distinctive ones only — `Product`,
 * `Order`, `Lead` and `Listing` are ordinary English and would flag half the
 * platform — so this rule finds a plugin's module, never a module that
 * happens to mention one.
 */
export const DOMAIN_EXPORTS = {
  ai: /^(?:Assist[A-Z]|assist[A-Z]|ASSIST_|AiJob|aiJob)/,
  bookings: /^(?:Booking|booking[A-Z]|BOOKING_)/,
  commerce: /^(?:HostProduct|hostProduct|ProductVariant|productVariant|HostOrder|hostOrder|Storefront|storefront[A-Z]|STOREFRONT_|GiftCard|giftCard|Commerce|commerce[A-Z]|COMMERCE_)/,
  crm: /^(?:Crm|crm[A-Z]|CRM_|ContactFacet|contactFacet|ContactField|contactField|ContactImport|ContactSource|contactSource|HostContact|hostContact|HostLead|hostLead|LeadStatus|leadStatus|Deal[A-Z]|deal[A-Z]|DEAL_)/,
  data: /^(?:Dataset|dataset[A-Z]|DATASET_)/,
  email: /^(?:EmailTopic|emailTopic|EMAIL_TOPIC|DynamicList|dynamicList|ListMember|listMember)/,
  // `FormField` is left out: it is generic form UI in `libs/shared/ui`, and the
  // forms PLUGIN's own words are the submission, the contract and the entity.
  forms: /^(?:FormFieldDecl|formFieldDecl|FormSubmission|formSubmission|FormContract|formContract|HostForm|hostForm)/,
  marketing: /^(?:Campaign|campaign[A-Z]|CAMPAIGN_|HostExperiment|hostExperiment|Experiment[A-Z]|experiment[A-Z]|MarketingConsent|marketingConsent|MARKETING_|AdvertisingTag|advertisingTag)/,
  marketplace: /^(?:Marketplace|marketplace[A-Z]|MARKETPLACE_|Publisher[A-Z]|publisher[A-Z]|PUBLISHER_)/,
  outreach: /^(?:Outreach|outreach[A-Z]|OUTREACH_)/,
  workflows: /^(?:Workflow|workflow[A-Z]|WORKFLOW_|HostAction|hostAction|HostWorkflow|Automation[A-Z]|automation[A-Z])/,
}
const EXPORTED_NAME = /^export\s+(?:declare\s+)?(?:async\s+)?(?:default\s+)?(?:function\*?|const|let|type|interface|class|enum)\s+([A-Za-z0-9_$]+)/gm

/** The plugin whose words a file mostly exports, or `null`. */
export function domainOfExports(text) {
  const names = [...text.matchAll(EXPORTED_NAME)].map((match) => match[1])
  if (names.length < 3) return null
  for (const [domain, pattern] of Object.entries(DOMAIN_EXPORTS)) {
    const hits = names.filter((name) => pattern.test(name)).length
    if (hits >= 3 && hits * 2 >= names.length) return domain
  }
  return null
}

/**
 * Rule 7. A DECLARATION in one plugin's vocabulary, anywhere in a file: a
 * function, a constant, a type, an interface or a class — exported or not —
 * and a member of an interface or an object literal. Rule 6 asks whether a
 * file is mostly a plugin's; this asks whether ANY of it is, which is how a
 * platform file comes to carry a plugin: `plan-entitlements.ts` declares
 * thirty-three such names and is named for none of them, and
 * `org-billing.types.ts` spells out seven plugins' keys.
 *
 * A declaration is code that lives here. A USE of another module's symbol is
 * not judged — that is the import graph's — which is what keeps this from
 * flagging every caller of a plugin's seam. That includes an inline `type`
 * specifier on a line of its own inside a multi-line `import { … }` or
 * `export { … }`: it names a symbol declared somewhere else, so a type is a
 * declaration here only as an alias (`type Name =` or `type Name<`).
 */
const DECLARATION = /^\s*(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:default\s+)?(?:(?:function\*?|const|let|interface|class|enum)\s+([A-Za-z_$][\w$]*)|type\s+([A-Za-z_$][\w$]*)\s*[=<])/
const MEMBER = /^\s{2,}(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*[:(]/

/** The plugins whose vocabulary a file's code lines DECLARE. */
export function domainsDeclared(text) {
  const domains = new Set()
  for (const line of text.split('\n')) {
    if (COMMENT_LINE.test(line)) continue
    const declared = DECLARATION.exec(line)
    const name = declared?.[1] ?? declared?.[2] ?? MEMBER.exec(line)?.[1]
    if (!name) continue
    for (const [domain, pattern] of Object.entries(DOMAIN_EXPORTS)) if (pattern.test(name)) domains.add(domain)
  }
  return [...domains].sort()
}

/**
 * Rule 3. First-party ids that are also plain English are left out on purpose.
 * `sms` is also a URL scheme (`sms:`) that core's link sanitizers allow-list
 * (AGL-3610), which names no plugin.
 */
const AMBIGUOUS_IDS = new Set(['ai', 'data', 'email', 'forms', 'logic', 'mui', 'sms'])

const PLUGIN_IMPORT =
  /from\s+['"](@aglyn\/plugins-[a-z-]+)(?:\/[^'"]*)?['"]|import\(\s*['"](@aglyn\/plugins-[a-z-]+)|(?:\.\.\/)+(libs\/plugins\/[a-z-]+)\//
const COMMENT_LINE = /^\s*(?:\/\/|\*|\/\*)/

/** A plugin's own tree, by its directory under `libs/plugins/`. */
const PLUGIN_TREE = /^libs\/plugins\/([a-z0-9-]+)\//
/**
 * A spec's stand-in for ANOTHER plugin's registration: it imitates the owner
 * over a spec's Firestore double, on purpose, because the plugin under test
 * may not load the owner.
 */
const STAND_IN = /^libs\/plugins\/[a-z0-9-]+\/src\/lib\/testing\//
/** A plugin's nav declaration: the file its console surfaces' slugs are read from. */
const PLUGIN_NAV = /^libs\/plugins\/([a-z0-9-]+)\/src\/(?:.*\/)?plugin\.ts$/
const CONSOLE_ROUTES = 'libs/aglyn/src/lib/app-utils/console-routes.ts'
/** A console route whose first segment under the org or the site is a plugin's surface. */
const ROUTE_SURFACE = /^\/\[orgSlug\](?:\/hosts\/\[host\])?\/([a-z0-9-]+)/

/**
 * Rule 8's vocabulary, read from the corpus itself: which plugin each console
 * slug belongs to (every `href: '/slug'` and `legacyHrefs` entry in a plugin's
 * `plugin.ts`), and which core routes are a plugin's page because their first
 * segment is one of its slugs.
 */
export function consoleAddresses(files, pluginIdOfDir = (dir) => dir) {
  const slugOwner = new Map()
  for (const { path, text } of files) {
    const dir = PLUGIN_NAV.exec(path)?.[1]
    if (!dir) continue
    const owner = pluginIdOfDir(dir)
    for (const match of text.matchAll(/\bhref:\s*['"]\/([a-z0-9-]+)['"]/g)) slugOwner.set(match[1], owner)
    for (const legacy of text.matchAll(/\blegacyHrefs:\s*\[([^\]]*)\]/g)) {
      for (const match of legacy[1].matchAll(/['"]\/([a-z0-9-]+)['"]/g)) slugOwner.set(match[1], owner)
    }
  }
  const routeOwner = new Map()
  const routes = files.find((file) => file.path === CONSOLE_ROUTES)?.text ?? ''
  for (const [, name, route] of routes.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*'([^']+)'/gm)) {
    const surface = ROUTE_SURFACE.exec(route)?.[1]
    if (surface && slugOwner.has(surface)) routeOwner.set(name, slugOwner.get(surface))
  }
  const slugs = [...slugOwner.keys()].join('|')
  const names = [...routeOwner.keys()].join('|')
  return {
    slugOwner,
    routeOwner,
    // A slug as a `pluginSlug`, as a `*_SLUG` constant, or as a path segment
    // after an interpolation or opening a literal. A bare quoted word is not
    // matched: `'data'` and `'forms'` are ordinary strings.
    slugPattern: slugs
      ? new RegExp(
          `\\bpluginSlug:\\s*['"\`](${slugs})['"\`]|\\b[A-Z_]*SLUG\\s*=\\s*['"\`](${slugs})['"\`]|\\}/(${slugs})(?=[/'"\`?#])|['"\`]/(${slugs})(?=[/'"\`?#])`,
          'g',
        )
      : null,
    routePattern: names ? new RegExp(`\\bRoute\\.(${names})\\b`, 'g') : null,
  }
}

/** A literal that is an API path or a Firestore document path, not a page. */
const NOT_A_PAGE = /\/api\/|['"`](?:hosts|orgs)\//

/** The plugins whose console surfaces a file's CODE lines address. */
export function consolePathOwners(text, addresses) {
  const owners = new Set()
  for (const line of text.split('\n')) {
    if (COMMENT_LINE.test(line)) continue
    if (addresses.slugPattern) {
      for (const match of line.matchAll(addresses.slugPattern)) {
        if (NOT_A_PAGE.test(line.slice(0, match.index))) continue
        owners.add(addresses.slugOwner.get(match[1] ?? match[2] ?? match[3] ?? match[4]))
      }
    }
    if (addresses.routePattern) {
      for (const match of line.matchAll(addresses.routePattern)) owners.add(addresses.routeOwner.get(match[1]))
    }
  }
  return [...owners].sort()
}

/** Prose is not code: a comment that spells a package or an id is judged by neither rule. */
function codeLineMatches(text, pattern) {
  return text.split('\n').some((line) => !COMMENT_LINE.test(line) && pattern.test(line))
}

export function pluginIdPattern(ids) {
  const distinctive = ids.filter((id) => !AMBIGUOUS_IDS.has(id))
  return distinctive.length ? new RegExp(`['"\`](${distinctive.join('|')})['"\`]`) : null
}

/**
 * The rules a corpus of {path, text} trips: Map<path, string[]>. `pluginIdOfDir`
 * names the plugin a `libs/plugins/<dir>/` tree is, where the two differ.
 */
export function findFindings(files, pluginIds, pluginIdOfDir = (dir) => dir) {
  const idPattern = pluginIdPattern(pluginIds)
  const addresses = consoleAddresses(files, pluginIdOfDir)
  const findings = new Map()
  const add = (path, rule) => findings.set(path, [...(findings.get(path) ?? []), rule])
  for (const { path, text } of files) {
    if (!SOURCE.test(path) || SPEC.test(path) || GENERATED.test(path)) continue
    const pluginDir = PLUGIN_TREE.exec(path)?.[1]
    if (pluginDir && !STAND_IN.test(path)) {
      // Rules 5 and 8 inside a plugin: another plugin's storage and pages.
      const self = pluginIdOfDir(pluginDir)
      for (const owner of collectionOwnersAddressed(text)) if (owner !== self) add(path, `plugin-collection:${owner}`)
      if (!PLUGIN_NAV.test(path)) {
        for (const owner of consolePathOwners(text, addresses)) if (owner !== self) add(path, `console-path:${owner}`)
      }
    }
    const guarded = GUARDED.test(path)
    // tools/ names hosts and package strings in lint rules and weight budgets;
    // only a domain-named script is evidence there.
    const tools = path.startsWith('tools/')
    if (guarded && (DOMAIN_FILE.test(path) || DOMAIN_DIR.test(path))) add(path, 'domain-name')
    for (const { vendor, pattern, home, everywhere } of VENDOR_LITERALS) {
      if (tools || !(guarded || everywhere)) continue
      if (home && path.startsWith(home)) continue
      if (pattern.test(text)) add(path, `vendor:${vendor}`)
    }
    if (!guarded || tools) continue
    if (!NOT_STORAGE.test(path)) for (const owner of collectionOwnersAddressed(text)) add(path, `plugin-collection:${owner}`)
    if (!NOT_STORAGE.test(path)) for (const domain of domainsDeclared(text)) add(path, `domain-declares:${domain}`)
    const exportsOf = domainOfExports(text)
    if (exportsOf) add(path, `domain-exports:${exportsOf}`)
    if (idPattern && codeLineMatches(text, idPattern)) add(path, 'plugin-id')
    if (!MANIFEST.test(path) && codeLineMatches(text, PLUGIN_IMPORT)) add(path, 'plugin-import')
  }
  return findings
}

/** What is refused, and what on the list excuses nothing any more. */
export function judge(findings, rows) {
  const allowed = new Map(rows.map((row) => [row.path, new Set(row.rules)]))
  const refused = []
  for (const [path, rules] of findings) {
    for (const rule of rules) if (!allowed.get(path)?.has(rule)) refused.push({ path, rule })
  }
  const stale = []
  for (const row of rows) {
    for (const rule of row.rules) if (!findings.get(row.path)?.includes(rule)) stale.push({ path: row.path, rule })
  }
  const unargued = rows.filter((row) => row.lane === 'stays' && !row.why).map((row) => row.path)
  return { refused, stale, unargued }
}

export function trackedFiles(root = ROOT) {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean)
}

export function loadCorpus(root = ROOT) {
  const out = []
  for (const path of trackedFiles(root)) {
    if (!SOURCE.test(path)) continue
    try {
      out.push({ path, text: readFileSync(join(root, path), 'utf8') })
    } catch {
      // Unreadable — not source that names a domain.
    }
  }
  return out
}

export function firstPartyPluginIds(root = ROOT) {
  return JSON.parse(readFileSync(join(root, 'plugins.config.json'), 'utf8')).plugins.map((plugin) => plugin.id)
}

/** The plugin id a `libs/plugins/<dir>/` tree registers as (`themes` is `theme-presets`). */
export function pluginIdsByDir(root = ROOT) {
  const byDir = new Map()
  for (const plugin of JSON.parse(readFileSync(join(root, 'plugins.config.json'), 'utf8')).plugins) {
    const dir = /^@aglyn\/plugins-(.+)$/.exec(plugin.package ?? '')?.[1]
    if (dir) byDir.set(dir, plugin.id)
  }
  return (dir) => byDir.get(dir) ?? dir
}

function selfTest() {
  // The forced-red fixture: one file per rule, the homes and exemptions beside
  // them, and a list with a stale rule and an unargued `stays` — each must be
  // reported, and nothing else may be.
  const ids = ['crm', 'commerce', 'data', 'mui']
  const corpus = [
    { path: 'libs/aglyn/src/lib/app-utils/crm-deals.ts', text: 'export const stages = []\n' },
    { path: 'apps/console/app/api/marketplace/listings/route.ts', text: 'export const GET = () => null\n' },
    { path: 'libs/plugins/crm/src/lib/model/crm-deals.ts', text: 'export const stages = []\n' },
    { path: 'libs/aglyn/src/lib/app-utils/thing.ts', text: "const model = 'claude-sonnet-5'\n" },
    { path: 'libs/plugins/crm/src/lib/summary.ts', text: "fetch('https://api.anthropic.com/v1/messages')\n" },
    { path: 'libs/plugins/ai/src/lib/providers/anthropic.ts', text: "fetch('https://api.anthropic.com/v1/messages')\n" },
    { path: 'libs/tenant/runtime/src/lib/video.ts', text: "const host = 'fast.wistia.net'\n" },
    { path: 'libs/shared/util/email/src/lib/send-email.ts', text: "fetch('https://api.resend.com/emails')\n" },
    { path: 'libs/shared/util/email/src/lib/mail-provider-resend.ts', text: "fetch('https://api.resend.com/emails')\n" },
    { path: 'libs/plugins/mui/src/lib/video.ts', text: "const host = 'fast.wistia.net'\n" },
    { path: 'libs/aglyn/src/lib/plugin-manager/catalog.ts', text: "const requires = ['commerce']\n" },
    { path: 'libs/aglyn/src/lib/plugin-manager/words.ts', text: "const kind = 'data'\n" },
    { path: 'libs/aglyn/src/lib/plugin-manager/prose.ts', text: " * `contacts` read as `crm` until its backfill\n// the 'commerce' bundle\nexport const x = 1\n" },
    { path: 'apps/console/app/(app)/page.tsx', text: "import { x } from '@aglyn/plugins-ai'\n" },
    { path: 'apps/console/constants/plugins.client.generated.ts', text: "import('@aglyn/plugins-ai')\n" },
    { path: 'libs/aglyn/src/lib/app-utils/crm.spec.ts', text: "'claude-haiku-4-5' 'commerce'\n" },
    { path: 'tools/lint-rules/no-remote-image.mjs', text: "const hosts = ['googletagmanager.com']\n" },
    { path: 'tools/scripts/lib/crm-fixtures.mjs', text: 'export const rows = []\n' },
    { path: 'apps/console/utils/server/capacity.ts', text: "const snap = await db.collection('hosts').doc(id).collection('products').get()\n" },
    { path: 'libs/tenant/runtime/src/lib/read-it.ts', text: "const ref = doc(firestore, 'hosts', hostId, 'datasets', datasetId)\n" },
    { path: 'apps/console/constants/nav.ts', text: "const href = `${base}/contacts`\nimport { x } from './contacts'\nrow('orders', 'Orders')\n" },
    { path: 'libs/plugins/commerce/src/lib/server/read.ts', text: "db.collection('products')\n" },
    { path: 'libs/aglyn/src/lib/app-utils/neutral-name.ts', text: 'export const MARKETPLACE_A = 1\nexport function marketplaceB() {}\nexport type MarketplaceC = 1\nexport const other = 2\n' },
    { path: 'libs/aglyn/src/lib/app-utils/plans.ts', text: 'export const seats = 1\nexport const sites = 2\nexport const pages = 3\nexport const members = 4\ninterface Limits {\n  crmEmailsPerDay: number\n}\n' },
    { path: 'libs/aglyn/src/lib/app-utils/caller.ts', text: "import { crmRoutes } from './x'\nexport const href = crmRoutes(base).contact(id)\n" },
    { path: 'libs/aglyn/src/lib/app-utils/type-user.ts', text: "import {\n  crmRoutes,\n  type CrmDeal,\n  type CrmStage as Stage,\n} from './x'\nexport const deal: CrmDeal | null = null\n" },
    { path: 'libs/aglyn/src/lib/app-utils/type-alias.ts', text: 'export type CrmDealId = string\ntype CrmStageMap<T> = Record<string, T>\n' },
    { path: 'libs/aglyn/src/lib/app-utils/mentions-one.ts', text: 'export const MARKETPLACE_A = 1\nexport const a = 1\nexport const b = 2\nexport const c = 3\n' },
    { path: 'libs/plugins/crm/src/lib/plugin.ts', text: "nav: [{ label: 'CRM', href: '/crm', legacyHrefs: ['/contacts'] }]\n" },
    { path: 'libs/plugins/forms/src/lib/plugin.ts', text: "nav: [{ label: 'Forms', href: '/forms' }]\n" },
    { path: 'libs/aglyn/src/lib/app-utils/console-routes.ts', text: "export enum Route {\n  FORM_DETAILS = '/[orgSlug]/hosts/[host]/forms/[formId]',\n  HOST_SETUP = '/[orgSlug]/hosts/[host]/setup',\n}\n" },
    { path: 'libs/plugins/inbox/src/lib/row.tsx', text: 'const href = buildRoute(Route.FORM_DETAILS, { orgSlug, host, formId })\n' },
    { path: 'libs/plugins/inbox/src/lib/hub.ts', text: "const CRM_SLUG = 'crm'\n" },
    { path: 'libs/plugins/inbox/src/lib/link.ts', text: 'const href = `${hostsPath}/${sub}/forms/${id}`\n' },
    { path: 'libs/plugins/inbox/src/lib/legacy.ts', text: "router.push('/contacts?email=' + email)\n" },
    { path: 'libs/plugins/inbox/src/lib/not-pages.ts', text: "const events = `/api/ai/jobs/${id}/crm?org=${org}`\nconst path = `hosts/${hostId}/forms`\nconst setup = buildRoute(Route.HOST_SETUP, { orgSlug, host })\nconst kind = 'crm'\n" },
    { path: 'libs/plugins/crm/src/lib/own.ts', text: "const hub = `${base}/crm`\nconst to = buildRoute(Route.HOST_PLUGIN, { orgSlug, host, pluginSlug: 'crm' })\n" },
    { path: 'libs/plugins/inbox/src/lib/reads.ts', text: "const rows = await db.collection('orgs').doc(orgId).collection('contacts').get()\n" },
    { path: 'libs/plugins/shop/src/lib/read.ts', text: "db.collection('products')\n" },
    { path: 'libs/plugins/inbox/src/lib/testing/stand-in-contacts.ts', text: "db.collection('orgs').doc(orgId).collection('contacts')\n" },
  ]
  const findings = findFindings(corpus, ids, (dir) => (dir === 'shop' ? 'commerce' : dir))
  const ok = (label, condition) => {
    if (!condition) {
      console.error(`self-test FAILED: ${label}`)
      process.exit(2)
    }
  }
  const has = (path, rule) => findings.get(path)?.includes(rule) === true
  ok('a domain-named core file is reported', has('libs/aglyn/src/lib/app-utils/crm-deals.ts', 'domain-name'))
  ok('a domain-named route directory is reported', has('apps/console/app/api/marketplace/listings/route.ts', 'domain-name'))
  ok('the same name inside its plugin is not', !findings.has('libs/plugins/crm/src/lib/model/crm-deals.ts'))
  ok('a core model literal is reported', has('libs/aglyn/src/lib/app-utils/thing.ts', 'vendor:ai'))
  ok('an AI vendor literal in another plugin is reported', has('libs/plugins/crm/src/lib/summary.ts', 'vendor:ai'))
  ok('the adapter is not reported', !findings.has('libs/plugins/ai/src/lib/providers/anthropic.ts'))
  ok('a video vendor in the runtime is reported', has('libs/tenant/runtime/src/lib/video.ts', 'vendor:wistia'))
  ok('a video vendor inside a plugin is not', !findings.has('libs/plugins/mui/src/lib/video.ts'))
  ok('a mail vendor on the rail is reported', has('libs/shared/util/email/src/lib/send-email.ts', 'vendor:resend'))
  ok('the mail provider that is its home is not', !findings.has('libs/shared/util/email/src/lib/mail-provider-resend.ts'))
  ok('a plugin id in core is reported', has('libs/aglyn/src/lib/plugin-manager/catalog.ts', 'plugin-id'))
  ok('an id that is a plain word is not', !findings.has('libs/aglyn/src/lib/plugin-manager/words.ts'))
  ok('an id named in a comment is not', !findings.has('libs/aglyn/src/lib/plugin-manager/prose.ts'))
  ok('a page importing a plugin is reported', has('apps/console/app/(app)/page.tsx', 'plugin-import'))
  ok('the generated manifest is not reported', !findings.has('apps/console/constants/plugins.client.generated.ts'))
  ok('a spec is not reported', !findings.has('libs/aglyn/src/lib/app-utils/crm.spec.ts'))
  ok('a lint rule naming a host is not reported', !findings.has('tools/lint-rules/no-remote-image.mjs'))
  ok('a domain-named tools script is reported', has('tools/scripts/lib/crm-fixtures.mjs', 'domain-name'))
  ok('an app reading a plugin’s collection is reported', has('apps/console/utils/server/capacity.ts', 'plugin-collection:commerce'))
  ok('a doc() path into a plugin’s collection is reported', has('libs/tenant/runtime/src/lib/read-it.ts', 'plugin-collection:data'))
  ok('a URL, an import path and a bare quoted word address no storage', !findings.has('apps/console/constants/nav.ts'))
  ok('the owner reading its own collection is not reported', !findings.has('libs/plugins/commerce/src/lib/server/read.ts'))
  ok('a neutral filename exporting one plugin’s words is reported', has('libs/aglyn/src/lib/app-utils/neutral-name.ts', 'domain-exports:marketplace'))
  ok('one export in a plugin’s words is a declaration, though not most of the file', has('libs/aglyn/src/lib/app-utils/mentions-one.ts', 'domain-declares:marketplace') && !has('libs/aglyn/src/lib/app-utils/mentions-one.ts', 'domain-exports:marketplace'))
  ok('a plugin’s key mixed into a platform type is reported', has('libs/aglyn/src/lib/app-utils/plans.ts', 'domain-declares:crm'))
  ok('USING a plugin’s symbol declares nothing', !findings.has('libs/aglyn/src/lib/app-utils/caller.ts'))
  ok('a type named inside a multi-line import declares nothing', !findings.has('libs/aglyn/src/lib/app-utils/type-user.ts'))
  ok('a type alias in a plugin’s words is a declaration', has('libs/aglyn/src/lib/app-utils/type-alias.ts', 'domain-declares:crm'))
  ok('a plugin reading another plugin’s collection is reported', has('libs/plugins/inbox/src/lib/reads.ts', 'plugin-collection:crm'))
  ok('a plugin whose directory is not its id reads its own collection unreported', !findings.has('libs/plugins/shop/src/lib/read.ts'))
  ok('another plugin’s page, by core route, is reported', has('libs/plugins/inbox/src/lib/row.tsx', 'console-path:forms'))
  ok('another plugin’s nav slug as a constant is reported', has('libs/plugins/inbox/src/lib/hub.ts', 'console-path:crm'))
  ok('another plugin’s page, spelled as a path, is reported', has('libs/plugins/inbox/src/lib/link.ts', 'console-path:forms'))
  ok('a legacy slug is the plugin’s too', has('libs/plugins/inbox/src/lib/legacy.ts', 'console-path:crm'))
  ok('an API path, a storage path, a core page and a bare word are not pages', !findings.has('libs/plugins/inbox/src/lib/not-pages.ts'))
  ok('a plugin addressing its own pages is not reported', !findings.has('libs/plugins/crm/src/lib/own.ts'))
  ok('a plugin’s nav declaration is not reported', !findings.has('libs/plugins/crm/src/lib/plugin.ts'))
  ok('a spec’s stand-in for another plugin’s seam is not reported', !findings.has('libs/plugins/inbox/src/lib/testing/stand-in-contacts.ts'))

  const rows = [
    { path: 'libs/aglyn/src/lib/app-utils/crm-deals.ts', rules: ['domain-name', 'plugin-id'], lane: 'crm' },
    { path: 'libs/aglyn/src/lib/app-utils/gone.ts', rules: ['domain-name'], lane: 'crm' },
    { path: 'libs/tenant/runtime/src/lib/video.ts', rules: ['vendor:wistia'], lane: 'stays' },
  ]
  const { refused, stale, unargued } = judge(findings, rows)
  ok('an allowed finding is not refused', !refused.some((v) => v.path.endsWith('crm-deals.ts')))
  ok('a finding with no row is refused', refused.some((v) => v.path.endsWith('thing.ts') && v.rule === 'vendor:ai'))
  ok('a rule a row no longer trips is stale', stale.some((v) => v.path.endsWith('crm-deals.ts') && v.rule === 'plugin-id'))
  ok('a row whose file is gone is stale', stale.some((v) => v.path.endsWith('gone.ts')))
  ok('a `stays` row with no argument is reported', unargued.length === 1 && unargued[0].endsWith('video.ts'))
  console.log('self-test ok')
}

function prune(list, stale) {
  const gone = new Set(stale.map(({ path, rule }) => `${path}\n${rule}`))
  const files = list.files
    .map((row) => ({ ...row, rules: row.rules.filter((rule) => !gone.has(`${row.path}\n${rule}`)) }))
    .filter((row) => row.rules.length)
  writeFileSync(ALLOWLIST, `${JSON.stringify({ ...list, files }, null, 2)}\n`)
  return list.files.length - files.length
}

function main(argv) {
  if (argv.includes('--fixture')) return selfTest()

  const list = JSON.parse(readFileSync(ALLOWLIST, 'utf8'))
  const corpus = loadCorpus(ROOT)
  const findings = findFindings(corpus, firstPartyPluginIds(ROOT), pluginIdsByDir(ROOT))
  const { refused, stale, unargued } = judge(findings, list.files)

  if (argv.includes('--prune')) {
    const rows = prune(list, stale)
    console.log(`check:plugin-domain-in-core: pruned ${stale.length} stale rule(s), ${rows} whole row(s)`)
    return
  }
  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ refused, stale, unargued }))
    process.exitCode = refused.length || stale.length || unargued.length ? 1 : 0
    return
  }

  for (const v of refused) console.error(`  REFUSED   ${v.path}: ${v.rule} — a plugin's domain lives in its plugin, behind a generic seam (docs/PACKAGES.md rule 3)`)
  for (const v of stale) console.error(`  STALE ROW ${v.path}: ${v.rule} no longer trips; run with --prune`)
  for (const path of unargued) console.error(`  UNARGUED  ${path}: a "stays" row carries its argument in "why"`)
  if (refused.length || stale.length || unargued.length) {
    console.error(
      `\ncheck:plugin-domain-in-core: ${refused.length} finding(s) outside the allowlist, ` +
        `${stale.length} stale rule(s), ${unargued.length} unargued "stays" row(s).`,
    )
    process.exitCode = 1
    return
  }
  const moving = list.files.filter((row) => row.lane !== 'stays' && row.lane !== 'coupling').length
  const coupled = list.files.filter((row) => row.lane === 'coupling').length
  console.log(
    `check:plugin-domain-in-core: clean (${corpus.length} source files; ${moving} file(s) still to move, ` +
      `${coupled} plugin file(s) still reaching into another plugin, ` +
      `${list.files.length - moving - coupled} argued to stay)`,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
