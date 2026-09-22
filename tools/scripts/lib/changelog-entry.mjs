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
 * Turns the commits a release shipped into the changelog entry a reader of
 * aglyn.com sees (AGL-3211).
 *
 * The customer-facing changelog is CONTENT, not a file: one entry per version
 * in the marketing host's `changelog` collection, dated at the instant that
 * version served. `CHANGELOG.md` is the engineering record and is cut on
 * `main`, so it says what was INTENDED to ship; this says what did.
 *
 * ## The fixture this module answers to
 *
 * Sixteen entries (v1.0.0-beta.102 → v1.0.0-beta.117) were authored by hand in
 * the console before any of this existed, and AGL-2848's backfill had to read
 * like them rather than like a generator. So they became the test: the
 * renderer regenerates all sixteen byte for byte — title, publish instant,
 * excerpt and body — and three rules that sounded obviously right died against
 * them.
 *
 *  1. **Only the bare `chore(release): v1.2.3` commit is dropped.** Dropping
 *     every `chore(release)` also swallowed the notes-carrying commits the
 *     published entries list.
 *  2. **A repeated subject in a later release is its own change.** The same
 *     sentence ships twice when a ceiling is raised twice; de-duplicating by
 *     text silently deleted the second release's work. Only a repeated SHA —
 *     the same commit reached by two merges — is a duplicate.
 *  3. **An issue id mid-sentence is part of the sentence.** "raise the ceiling
 *     to AGL-2718" is the change; only a trailing `(AGL-nnnn)` citation is
 *     stripped, because that one is a reference to a private workspace.
 *
 * Change anything here and run the fixture: `npm run test:changelog-entry`.
 */

import { BRITISH_SPELLINGS } from './british-spellings.mjs'

/**
 * What each commit scope is CALLED on the site.
 *
 * A subscriber reading the changelog has never heard of `dam`, `waf` or
 * `api-v1`, and the repo's scope vocabulary is an implementation detail that
 * moves. Everything here was recovered from the sixteen hand-written entries
 * or chosen to match their register, which is why `tenant` reads *Sites* and
 * `aglyn` reads *Platform* rather than being title-cased mechanically.
 *
 * An unmapped scope falls back to its own spelling (`tenant-runtime` → *Site
 * runtime* would need a row; without one it prints *Tenant runtime*). That is
 * deliberately unglamorous rather than wrong: a new scope appears in the entry
 * the release ships, where it is visible and can be named properly, instead of
 * being hidden under a catch-all.
 */
export const CHANGELOG_AREAS = {
  a11y: 'Accessibility',
  activity: 'Activity log',
  admin: 'Admin',
  agents: 'AI agents',
  aglyn: 'Platform',
  ai: 'AI',
  analytics: 'Analytics',
  api: 'API',
  'api-v1': 'REST API',
  assist: 'Assist',
  auth: 'Accounts',
  automation: 'Automations',
  automations: 'Automations',
  backfills: 'Scripts',
  backups: 'Backups',
  beacon: 'Analytics',
  besigner: 'Besigner',
  billing: 'Billing',
  bindings: 'Data bindings',
  blocks: 'Blocks',
  bookings: 'Bookings',
  brand: 'Brand',
  branding: 'Brand',
  build: 'Build',
  'build-performance': 'Build',
  canary: 'Monitoring',
  changelog: 'Changelog',
  ci: 'CI',
  claude: 'Agent tooling',
  cli: 'CLI',
  cloud: 'Cloud functions',
  collection: 'Collections',
  collections: 'Collections',
  'color-picker': 'Color picker',
  commerce: 'Commerce',
  components: 'Components',
  console: 'Console',
  consent: 'Consent',
  contacts: 'Contacts',
  content: 'Content',
  core: 'Platform',
  crm: 'CRM',
  crons: 'Scheduled jobs',
  dam: 'Media library',
  data: 'Data',
  datasets: 'Datasets',
  decisions: 'Documentation',
  deploy: 'Deploys',
  deps: 'Dependencies',
  'deps-dev': 'Dependencies',
  design: 'Design',
  docker: 'Docker',
  docs: 'Documentation',
  domains: 'Domains',
  e2e: 'Tests',
  email: 'Email',
  entitlements: 'Entitlements',
  enums: 'Platform',
  env: 'Environment',
  errors: 'Errors',
  'events-calendar': 'Events',
  export: 'Export',
  firestore: 'Database',
  firewall: 'Firewall',
  flags: 'Feature flags',
  forms: 'Forms',
  functions: 'Cloud functions',
  gate: 'Build checks',
  'getting-started': 'Documentation',
  guard: 'Build checks',
  guards: 'Build checks',
  guides: 'Documentation',
  handoff: 'Documentation',
  health: 'Monitoring',
  host: 'Sites',
  i18n: 'Translations',
  inbox: 'Inbox',
  infra: 'Infrastructure',
  instance: 'Sites',
  interactions: 'Interactions',
  'json-editor': 'JSON editor',
  jsx: 'UI components',
  'jsx-forms': 'Forms',
  labeler: 'CI',
  launch: 'Launch',
  layouts: 'Layouts',
  leads: 'Leads',
  legal: 'Legal',
  libs: 'Shared libraries',
  limits: 'Limits',
  links: 'Links',
  lint: 'Build checks',
  lockdown: 'Lockdown',
  logic: 'Logic',
  main: 'CI',
  'main-gate': 'CI',
  markdown: 'Markdown',
  marketing: 'Marketing site',
  marketplace: 'Marketplace',
  media: 'Media library',
  'media-cdn': 'Media CDN',
  monitoring: 'Monitoring',
  mui: 'UI components',
  nx: 'Build',
  ops: 'Operations',
  orgs: 'Organizations',
  outreach: 'Outreach',
  packages: 'Packages',
  perf: 'Performance',
  permissions: 'Permissions',
  'plugins-data': 'Plugin data',
  'plugins-marketplace': 'Marketplace',
  'plugins-mui': 'Plugin UI',
  'plugins-redirects': 'Redirects',
  plugins: 'Plugins',
  'pre-commit': 'Build checks',
  presence: 'Co-editing',
  pricing: 'Pricing',
  privacy: 'Privacy',
  promotion: 'Releases',
  publish: 'Publishing',
  redirects: 'Redirects',
  release: 'Releases',
  releasing: 'Releases',
  renderer: 'Rendering',
  repo: 'Repository',
  rules: 'Security rules',
  runbooks: 'Runbooks',
  runtime: 'Runtime',
  screens: 'Screens',
  screenshots: 'Screenshots',
  scripts: 'Scripts',
  security: 'Security',
  'self-host': 'Self-hosting',
  selfhost: 'Self-hosting',
  seo: 'SEO',
  settings: 'Settings',
  shared: 'Shared libraries',
  'shared-ui': 'UI components',
  'shared-ui-jsx': 'UI components',
  'shared-ui-next': 'UI components',
  'shared-ui-theme': 'Themes',
  'shared-util-email': 'Email',
  'shared-util-vendor': 'Dependencies',
  sites: 'Sites',
  specs: 'Tests',
  sso: 'SSO',
  'staff-console': 'Staff console',
  status: 'Status page',
  stripe: 'Billing',
  tax: 'Tax',
  team: 'Team',
  templates: 'Templates',
  tenant: 'Sites',
  'tenant-data-admin': 'Site data',
  'tenant-feature-instance': 'Sites',
  'tenant-instance': 'Sites',
  'tenant-runtime': 'Site runtime',
  'test-infra': 'Tests',
  theme: 'Themes',
  tools: 'Tooling',
  trust: 'Trust',
  ui: 'UI components',
  uptime: 'Monitoring',
  vendor: 'Dependencies',
  versions: 'Components',
  video: 'Video',
  'video-delivery': 'Video',
  waf: 'Firewall',
  'whats-new': "What's new",
  'white-label': 'White label',
  workflows: 'Workflows',
}

/**
 * Areas that describe how the product is BUILT rather than what a reader got.
 *
 * Used only to pick the sentence an entry LEADS with: a release whose first
 * commit raises a lint ceiling still leads with the feature it shipped. The
 * bullets themselves are never filtered — the entry lists everything, which
 * is the whole point of it.
 */
export const INTERNAL_AREAS = new Set([
  'Agent tooling',
  'Build',
  'Build checks',
  'CI',
  'Dependencies',
  'Deploys',
  'Docker',
  'Documentation',
  'Environment',
  // Aglyn's own marketing site: a change to it is not one a subscriber got.
  'Marketing site',
  'Releases',
  'Repository',
  'Runbooks',
  'Scripts',
  'Screenshots',
  'Tests',
  'Tooling',
])

/**
 * The sections, in the order the entries print them.
 *
 * Same spine as `renderRelease` in release-version.mjs, with two differences a
 * reader of the site rather than of the repo needs: `feat` is *New* rather
 * than *Added*, and the types that file has as QUIET are gathered into
 * *Behind the scenes* instead of being dropped. A subscriber is not owed a
 * silent release — "nothing visible changed, here is what did" is an answer.
 */
export const CHANGELOG_SECTIONS = [
  { heading: 'New', types: ['feat'], tally: (n) => `${n} new` },
  {
    heading: 'Fixed',
    types: ['fix'],
    tally: (n) => `${n} ${n === 1 ? 'fix' : 'fixes'}`,
  },
  { heading: 'Performance', types: ['perf'], tally: (n) => `${n} performance` },
  { heading: 'Reverted', types: ['revert'], tally: (n) => `${n} reverted` },
  { heading: 'Changed', types: ['refactor'], tally: (n) => `${n} changed` },
  { heading: 'Documentation', types: ['docs'], tally: (n) => `${n} docs` },
  {
    heading: 'Behind the scenes',
    // `null` is the unconventional subject — a merge of a fork's branch, an
    // early commit from before the convention. It shipped, so it is listed.
    types: ['chore', 'test', 'ci', 'style', 'build', null],
    tally: (n) => `${n} behind the scenes`,
  },
]

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** The area a commit is filed under. */
export function areaFor(commit) {
  // A commit naming several scopes is filed under the first — `console,docs`
  // is a console change that also touched the docs, in that order.
  const scope = (commit.scope ?? '').split(',')[0].trim()
  if (!scope) return 'Platform'
  if (CHANGELOG_AREAS[scope]) return CHANGELOG_AREAS[scope]
  const spelled = scope.replace(/-/g, ' ')
  return spelled.charAt(0).toUpperCase() + spelled.slice(1)
}

/**
 * The house style is American spelling, and a commit subject is copy here.
 *
 * Word by word against the shared list rather than by rule: `-ise` → `-ize`
 * would mangle `advertise` and `enterprise`, which is exactly why
 * british-spellings.mjs enumerates instead of generalizing.
 */
export function americanize(text) {
  return text.replace(/[A-Za-z]+/g, (word) => {
    const american = BRITISH_SPELLINGS[word.toLowerCase()]
    if (!american) return word
    if (word === word.toUpperCase()) return american.toUpperCase()
    if (word[0] === word[0].toUpperCase()) {
      return american.charAt(0).toUpperCase() + american.slice(1)
    }
    return american
  })
}

/** A commit subject as the site prints it. */
export function cleanSummary(summary) {
  const text = summary
    // A TRAILING citation only: the Linear workspace is private, so the
    // reference is noise to a reader — but an id inside the sentence is the
    // sentence, and cutting it leaves "raise the ceiling to , read from…".
    .replace(/\s*\((?:AGL-\d+(?:,\s*)?)+\)\s*$/g, '')
    // A subject that already opens with a bullet marker, which the early
    // history is full of: the entry supplies its own.
    .replace(/^[-*]\s+/, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return (
    americanize(text)
      // The site speaks to subscribers; the founder is not a character in it.
      .replace(/\bZach's\b/g, "the owner's")
      .replace(/\bZach\b/g, 'the owner')
  )
}

/**
 * The `chore(release): v1.2.3` commit, which exists to carry the bump.
 *
 * Its siblings — `chore(release): carry the ratchet-row move into the notes` —
 * are real work and stay. The published entries list them.
 */
export function isVersionBump(commit) {
  return (
    commit.type === 'chore' &&
    commit.scope === 'release' &&
    /^v?\d+\.\d+\.\d+/.test((commit.summary ?? '').trim())
  )
}

/** The commits, grouped into the sections that have any. */
export function sectionsFor(commits) {
  return CHANGELOG_SECTIONS.map((section) => ({
    ...section,
    commits: commits.filter((commit) =>
      section.types.includes(commit.conventional ? commit.type : null),
    ),
  })).filter((section) => section.commits.length > 0)
}

/**
 * `- **Console:** a Tracking tab, and Tag Manager under the same gate`
 *
 * A commit with NO scope gets no label at all rather than a generic one. The
 * convention arrived in 2026; before it, whole months are scopeless, and
 * `- **Platform:**` on all 38 lines of September 2021 labels nothing — it just
 * makes the reader's eye skip a column that never varies.
 */
export function bulletFor(commit) {
  const summary = cleanSummary(commit.summary)
  if (!(commit.scope ?? '').trim()) return `- ${summary}`
  return `- **${areaFor(commit)}:** ${summary}`
}

/**
 * The excerpt: what changed, then how much.
 *
 * The lead is the first change a reader would care about, which is why the
 * internal areas are skipped — the published beta.116 entry leads with the
 * media CDN and not with the ffmpeg tooling commit above it. A release of one
 * change states it and stops; a tally of "1 changes in all" is a robot
 * talking.
 */
export function renderExcerpt(commits) {
  const sections = sectionsFor(commits)
  const lead =
    commits.find(
      (commit) => commit.type === 'feat' && !INTERNAL_AREAS.has(areaFor(commit)),
    ) ??
    commits.find(
      (commit) => commit.type === 'fix' && !INTERNAL_AREAS.has(areaFor(commit)),
    ) ??
    commits.find((commit) => !INTERNAL_AREAS.has(areaFor(commit))) ??
    commits[0]
  if (!lead) return ''
  const sentence = cleanSummary(lead.summary)
  const opener = /[.!?]$/.test(sentence)
    ? sentence.charAt(0).toUpperCase() + sentence.slice(1)
    : `${sentence.charAt(0).toUpperCase() + sentence.slice(1)}.`
  if (commits.length < 2) return opener
  const tally = sections.map((section) => section.tally(section.commits.length))
  return `${opener} ${commits.length} changes in all: ${joinList(tally)}.`
}

/** The entry body: what this was, anything unusual about it, then everything. */
export function renderBody({ intro, notes = [], commits }) {
  const sections = sectionsFor(commits).map((section) =>
    [
      `## ${section.heading}`,
      '',
      ...section.commits.map((commit) => bulletFor(commit)),
    ].join('\n'),
  )
  return [intro, ...(notes.length ? [notes.join(' ')] : []), ...sections].join(
    '\n\n',
  )
}

/** `September 10, 2026` */
export function longDate(iso, timeZone = 'UTC') {
  const parts = zonedParts(iso, timeZone)
  return `${MONTHS[parts.month - 1]} ${parts.day}, ${parts.year}`
}

/**
 * `17:37` in the site's zone, with the label that says which (AGL-3237).
 *
 * It used to be UTC with no choice, on the reasoning that a release instant
 * has no local time. True of the INSTANT and false of the SENTENCE: a release
 * served at 00:30 UTC went out at half past seven the previous evening in
 * Chicago, and an entry dated the 21st by its own site while its body said
 * September 22 disagreed with itself on the page.
 */
export function clockZoned(iso, timeZone = 'UTC') {
  const parts = zonedParts(iso, timeZone)
  return `${pad(parts.hour)}:${pad(parts.minute)}`
}

/**
 * The zone's own abbreviation for that instant — `CDT`, `UTC`, `GMT+8`.
 *
 * Read from `Intl` rather than mapped, so it is right across a daylight-saving
 * boundary without this file knowing where any of them are.
 */
export function zoneLabel(iso, timeZone = 'UTC') {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  }).formatToParts(new Date(iso))
  return formatted.find((part) => part.type === 'timeZoneName')?.value ?? 'UTC'
}

/** One instant's calendar fields in a given zone. */
function zonedParts(iso, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const value = (type) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    // `hour12: false` spells midnight `24` in some ICU versions.
    hour: value('hour') % 24,
    minute: value('minute'),
  }
}

/**
 * The whole entry for one released version.
 *
 * `servedAt` is when the version reached users, not when the merge landed, and
 * it is what the entry is dated with — a release that merged at midnight and
 * built at 00:47 went out at 00:47.
 *
 * `previousRef`/`ref` name the ends of the GitHub compare link. They are tags
 * where tags exist and SHAs where they do not, because a tag gap is usually
 * the honest record (a version cut and never promoted) rather than an
 * oversight, and a compare link to a tag nobody cut is a 404.
 */
/**
 * The document id a release's changelog entry is published under.
 *
 * A NAMED key function rather than a template literal at the call site, which
 * `check:id-minting` (AGL-3079) refuses: an id with a meaning is allowed, and
 * the rule is that the scheme has one place where it is written and reviewed,
 * so that every reader of the key calls the same function rather than
 * re-deriving it. The meaning here is the point — the id is DERIVED from the
 * release slug precisely so that re-running a promotion whose write failed
 * lands on the entry that is already there instead of publishing a second one
 * beside it. A minted id would make the script non-idempotent, which for a
 * publisher that runs inside a promotion is the failure worth designing out.
 *
 * The `cl-` prefix keeps a changelog entry's id recognisable in a collection
 * that a customer's own entries also live in.
 */
export function changelogEntryId(slug) {
  return `cl-${slug}`
}

export function renderReleaseEntry({
  version,
  commits,
  servedAt,
  ref,
  previousRef,
  carriedVersions = [],
  skippedVersions = [],
  deployedAt = [],
  /**
   * The zone the entry's dates read in (AGL-3237) — the publishing org's, so
   * the body cannot name a different day than the site's own index does.
   */
  timeZone = 'UTC',
}) {
  const listed = commits.filter((commit) => !isVersionBump(commit))
  const notes = []
  if (carriedVersions.length) {
    const list = carriedVersions.map((one) => `v${one}`)
    notes.push(
      `The ${list.length === 1 ? 'tree cut as' : 'trees cut as'} ` +
        `${joinList(list)} never reached production, so ` +
        `${list.length === 1 ? 'its' : 'their'} changes ship here.`,
    )
  }
  if (skippedVersions.length) {
    notes.push(
      `It also carries the changes cut as ` +
        `${joinList(skippedVersions.map((one) => `v${one}`))}.`,
    )
  }
  if (deployedAt.length > 1) {
    const last = deployedAt[deployedAt.length - 1]
    notes.push(
      `This version reached production in ${deployedAt.length} deploys; ` +
        `the last landed on ${longDate(last, timeZone)} at ` +
          `${clockZoned(last, timeZone)} ${zoneLabel(last, timeZone)}.`,
    )
  }

  const intro =
    `Released to production on ${longDate(servedAt, timeZone)} at ` +
    `${clockZoned(servedAt, timeZone)} ${zoneLabel(servedAt, timeZone)}. ` +
    `[See every commit in this release on GitHub]` +
    `(https://github.com/aglyn/aglyn/compare/${previousRef}...${ref})`

  return {
    title: `v${version}`,
    slug: `v${version.replace(/\./g, '-')}`,
    // To the minute: the seconds of a deployment status are noise, and the
    // console's own publish-date dialog cannot express them either.
    publishedAt: `${servedAt.slice(0, 17)}00Z`,
    excerpt: renderExcerpt(listed),
    body: renderBody({ intro, notes, commits: listed }),
    changes: listed.length,
  }
}

/** `a, b and c` — the site writes lists out rather than printing commas. */
export function joinList(items) {
  if (items.length < 2) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function pad(value) {
  return String(value).padStart(2, '0')
}
