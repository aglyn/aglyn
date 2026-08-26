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

// Week-One pre-flight — precondition P4 of LAUNCH_DAY_RUNBOOK.md (AGL-1617).
//
// P4 spent its whole life as six prose bullets in a Google Doc, ticked by
// hand. Twice now the ticks and reality have disagreed in BOTH directions:
// two items were done and unticked (2026-08-14), and two more were built and
// the bullet still said "does not exist" (2026-08-19). A checklist that can
// only be wrong quietly is the thing this file replaces.
//
//   node tools/scripts/check-week-one-preflight.mjs
//   node tools/scripts/check-week-one-preflight.mjs --docs <path-to-GTM-folder>
//   node tools/scripts/check-week-one-preflight.mjs --self-test
//
// EXIT CODES — three states, never two. A check that cannot run must not
// report the same thing as a check that ran and passed (the skipped-CI-job
// failure mode):
//
//   0  every automatable item PASSED
//   1  at least one item FAILED — P4 is not done
//   2  at least one item is UNKNOWN (could not be evaluated) and none failed
//
// WHAT THIS CANNOT DO. Minting the live Stripe coupon, naming twenty people,
// and confirming zero enabled Google Ads campaigns are console actions a
// person takes by hand. This script
// still checks the first (a live read is not a live write) and the second
// (the names land in a file), and prints the third as an explicit manual
// item rather than pretending silence is a pass.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withProbeHeaders } from './lib/probe-headers.mjs'

const DEFAULT_DOCS = join(
  process.env['HOME'] ?? '',
  'Library/CloudStorage/GoogleDrive-zach@aglyn.com/Shared drives/Platform Docs',
  'Pricing & Packaging/07-GTM-and-Marketing',
)

const args = process.argv.slice(2)
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : fallback
}
const selfTest = args.includes('--self-test')
const docsDir = argValue(
  '--docs',
  process.env['AGLYN_GTM_DOCS'] || DEFAULT_DOCS,
)

const PASS = 'PASS'
const FAIL = 'FAIL'
const UNKNOWN = 'UNKNOWN'

/** The four legal pages the founding offer links people at. */
const LEGAL_URLS = [
  'https://aglyn.com/legal/cookies',
  'https://aglyn.com/legal/dmca',
  'https://aglyn.com/legal/subprocessors',
  'https://aglyn.com/legal/dpa',
  'https://aglyn.com/legal/terms',
]

/**
 * Editorial leftovers. Each one is a string that appeared on a live legal page
 * at some point, so this list is a census of things that HAVE happened, not a
 * guess at what might.
 */
const LEGAL_MARKERS = [
  '[verify]',
  'TO BE ATTACHED',
  '[Registered agent address — pending]',
  'should be confirmed',
  'TODO',
]

/**
 * The hosts the demo org serves, each with the brand string that proves the
 * seeder actually ran against it. A 200 is NOT the check: `demo` answered 200
 * for months while serving a component scratch canvas.
 *
 * ⚠️ `demo` IS DELIBERATELY ABSENT, and re-adding it would be a mistake.
 * It was here asserting `/sourdough|croissant|Bakery/`, which was never true
 * and is now decided never to become true. There is no `hosts/demo` document
 * at all: the `demo` subdomain is served by a legacy push-id host in an
 * individual's personal org, with zero `seed-` documents and four renderer
 * test screens (`Hierarchy Child`, `Layout Test Page`). It is also the tenant
 * middleware's fallback for `app.aglyn.com`, for every Vercel preview and for
 * localhost:4500, so it must not be reseeded or deleted — `seed-demo-host.mjs`
 * would merge a competing home screen over a working dev fixture while
 * pruning none of it, because the prune only removes `seed-` ids. Asserting
 * bakery content on it was asserting something we have chosen not to do.
 *
 * `showcase` replaces it, and is the one row that carries a second job: it is
 * the render canary's subject (`AGLYN_CANARY_SITE_HOST`). The canary grades
 * only "host resolved + non-empty node tree" so an ordinary customer edit
 * cannot page on-call — which is only meaningful while something guarantees
 * the tree. THIS ROW IS THAT GUARANTEE. Its content comes from the `showcase`
 * brand pack in version control, so if the canary is ever green over a host
 * that has drifted, this is what says so — on a schedule, where it can file
 * rather than page.
 */
const DEMO_HOSTS = [
  ['showcase', 'https://showcase.aglyn.app/', /Platform Showcase/i],
  ['dental', 'https://northgate-dental.aglyn.app/', /Northgate Dental/i],
  ['legal', 'https://harborline-law.aglyn.app/', /Harborline/i],
  ['restaurant', 'https://casa-verde.aglyn.app/', /Casa Verde/i],
  ['fitness', 'https://ironleaf.aglyn.app/', /Ironleaf/i],
]

const results = []
const record = (id, title, state, detail) =>
  results.push({ id, title, state, detail })

/** Mutable so `--self-test` can point every check at a broken fixture. */
let docsRoot = docsDir

const readDoc = (name) => {
  const path = join(docsRoot, name)
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf8')
}

/**
 * Fetch one of OUR OWN hosts. Page routes sit behind Vercel Bot Protection and
 * answer 429 to any non-JS client, so a bare fetch is indistinguishable from
 * an outage — which is exactly the false alarm this returns UNKNOWN for rather
 * than FAIL. `/api/*` routes are not challenged; page routes are.
 */
async function fetchPage(url) {
  try {
    const response = await fetch(url, {
      headers: withProbeHeaders({ accept: 'text/html' }),
      redirect: 'manual',
    })
    const body = await response.text()
    return { status: response.status, body }
  } catch (error) {
    return { status: 0, body: '', error: String(error) }
  }
}

// ── P4.1a — the five offer decisions are recorded as resolved ───────────────
function checkDecisions() {
  const doc = readDoc('Founding-Customer-Offer.md')
  if (doc === null)
    return record(
      'P4.1a',
      'Offer decisions 1–5 recorded',
      UNKNOWN,
      'Founding-Customer-Offer.md not found',
    )
  const open = []
  for (const n of [1, 2, 3, 4, 5]) {
    // A decision is settled when its bullet is struck through AND resolved.
    // "⚖️ DECISION 4" with no strike is precisely the shape that reads as
    // pending after the decision has actually been made.
    const struck = new RegExp(`~~DECISION ${n}~~[^\\n]*RESOLVED`).test(doc)
    if (!struck) open.push(n)
  }
  return record(
    'P4.1a',
    'Offer decisions 1–5 recorded',
    open.length === 0 ? PASS : FAIL,
    open.length === 0
      ? 'all five struck through and marked RESOLVED'
      : `not resolved: ${open.join(', ')}`,
  )
}

// ── P4.1b — the live coupon exists ─────────────────────────────────────────
function checkCoupon() {
  let out
  try {
    out = execFileSync(
      'stripe',
      ['coupons', 'list', '--live', '--limit', '100'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )
  } catch {
    return record(
      'P4.1b',
      'Live coupon founding-cohort-1 exists',
      UNKNOWN,
      'stripe CLI unavailable or not authenticated for live mode',
    )
  }
  let parsed
  try {
    parsed = JSON.parse(out)
  } catch {
    return record(
      'P4.1b',
      'Live coupon founding-cohort-1 exists',
      UNKNOWN,
      'could not parse stripe output',
    )
  }
  const found = (parsed.data ?? []).find(
    (c) => c.id === 'founding-cohort-1' || c.name === 'founding-cohort-1',
  )
  if (!found)
    return record(
      'P4.1b',
      'Live coupon founding-cohort-1 exists',
      FAIL,
      `absent — live account holds ${(parsed.data ?? []).length} coupon(s): ${
        (parsed.data ?? []).map((c) => c.id).join(', ') || 'none'
      }`,
    )
  // Existence is not enough: the wrong percent or the wrong product list is a
  // pricing error that reaches a customer's invoice.
  const problems = []
  if (found.percent_off !== 25)
    problems.push(`percent_off=${found.percent_off}`)
  if (found.duration !== 'once') problems.push(`duration=${found.duration}`)
  return record(
    'P4.1b',
    'Live coupon founding-cohort-1 exists',
    problems.length ? FAIL : PASS,
    problems.length
      ? `exists but ${problems.join(', ')}`
      : 'exists, 25% off, once',
  )
}

// ── P4.2 — twenty names, ranked A/B ────────────────────────────────────────
function parseTracker() {
  const csv = readDoc('Per-Lead-Tracker.csv')
  if (csv === null) return null
  const lines = csv.trim().split(/\r?\n/)
  const header = lines[0].split(',')
  const rows = lines.slice(1).map((l) => l.split(','))
  return { header, rows }
}

function checkNames() {
  const tracker = parseTracker()
  if (!tracker)
    return record(
      'P4.2',
      '20 names, ranked Tranche A (10) / B (10)',
      UNKNOWN,
      'Per-Lead-Tracker.csv not found',
    )
  const nameIdx = tracker.header.indexOf('Name')
  const trancheIdx = tracker.header.indexOf('Tranche')
  if (nameIdx === -1 || trancheIdx === -1)
    return record(
      'P4.2',
      '20 names, ranked Tranche A (10) / B (10)',
      UNKNOWN,
      'tracker has no Name/Tranche column',
    )
  const named = tracker.rows.filter((r) => (r[nameIdx] ?? '').trim() !== '')
  const a = named.filter((r) => (r[trancheIdx] ?? '').trim() === 'A').length
  const b = named.filter((r) => (r[trancheIdx] ?? '').trim() === 'B').length
  const ok = named.length === 20 && a === 10 && b === 10
  return record(
    'P4.2',
    '20 names, ranked Tranche A (10) / B (10)',
    ok ? PASS : FAIL,
    `${named.length} of 20 named (Tranche A ${a}/10, B ${b}/10)`,
  )
}

// ── P4.3 — no editorial leftovers on the live legal pages ──────────────────
async function checkLegal() {
  const hits = []
  const unreadable = []
  let controlSeen = false
  for (const url of LEGAL_URLS) {
    const { status, body } = await fetchPage(url)
    if (status !== 200) {
      unreadable.push(`${url} → ${status}`)
      continue
    }
    // POSITIVE CONTROL. Zero markers means nothing if the fetch returned a
    // challenge page or an empty shell — so require that at least one page
    // demonstrably contains real policy text before trusting a zero.
    if (
      /Designated Agent|Categories of cookies|Standard Contractual/.test(body)
    )
      controlSeen = true
    for (const marker of LEGAL_MARKERS)
      if (body.includes(marker)) hits.push(`${url}: ${marker}`)
  }
  if (unreadable.length)
    return record(
      'P4.3',
      'Legal live pages carry no drafting placeholders',
      UNKNOWN,
      `unreadable (set AGLYN_PROBE_TOKEN to bypass bot protection): ${unreadable.join('; ')}`,
    )
  if (!controlSeen)
    return record(
      'P4.3',
      'Legal live pages carry no drafting placeholders',
      UNKNOWN,
      'fetched 200 but no policy text found — the census read a shell, so a zero proves nothing',
    )
  return record(
    'P4.3',
    'Legal live pages carry no drafting placeholders',
    hits.length ? FAIL : PASS,
    hits.length
      ? hits.join('; ')
      : `0 markers across ${LEGAL_URLS.length} pages`,
  )
}

// ── P4.4a — the founding-agreement email template ──────────────────────────
function checkAgreementTemplate() {
  const doc = readDoc('Founding-Agreement-Email-Template.md')
  if (doc === null)
    return record(
      'P4.4a',
      'Founding-agreement email template ready to send',
      FAIL,
      'Founding-Agreement-Email-Template.md does not exist',
    )
  if (/\*\*Status:\*\*\s*DRAFT/i.test(doc))
    return record(
      'P4.4a',
      'Founding-agreement email template ready to send',
      FAIL,
      'exists but still marked DRAFT — awaiting the voice pass',
    )
  return record(
    'P4.4a',
    'Founding-agreement email template ready to send',
    PASS,
    'exists and is not marked DRAFT',
  )
}

// ── P4.4b — the booking link is a real URL everywhere it appears ───────────
function checkBookingLink() {
  const doc = readDoc('Design-Partner-Outreach.md')
  if (doc === null)
    return record(
      'P4.4b',
      'Demo booking link present in every outreach touch',
      UNKNOWN,
      'Design-Partner-Outreach.md not found',
    )
  const placeholders = doc.match(/\{booking ?link\}|\{link\}/g) ?? []
  const hasUrl =
    /https:\/\/calendar\.google\.com\/calendar\/appointments\//.test(doc)
  if (!hasUrl)
    return record(
      'P4.4b',
      'Demo booking link present in every outreach touch',
      FAIL,
      'no appointment-schedule URL in the outreach doc',
    )
  return record(
    'P4.4b',
    'Demo booking link present in every outreach touch',
    placeholders.length ? FAIL : PASS,
    placeholders.length
      ? `${placeholders.length} unreplaced placeholder(s): ${[...new Set(placeholders)].join(', ')}`
      : 'real URL present, no {link} placeholders left',
  )
}

// ── P4.4c — the multi-site demo org is actually serving ────────────────────
async function checkDemoOrg() {
  const missing = []
  const wrongContent = []
  const unreadable = []
  for (const [id, url, marker] of DEMO_HOSTS) {
    const { status, body } = await fetchPage(url)
    if (status === 429) {
      unreadable.push(`${id} → 429 (bot protection)`)
      continue
    }
    if (status !== 200) {
      missing.push(`${id} → ${status}`)
      continue
    }
    // A 200 is not the check. The seeder shipped (AGL-1734) but had never been
    // run against production: `demo` answered 200 the whole time while serving
    // a component scratch canvas full of `{{Message}}` and "CLICK ME".
    if (!marker.test(body))
      wrongContent.push(`${id} → 200 but no brand content`)
  }
  if (unreadable.length && !missing.length && !wrongContent.length)
    return record(
      'P4.4c',
      'Multi-site demo org seeded and serving',
      UNKNOWN,
      `${unreadable.join('; ')} — set AGLYN_PROBE_TOKEN or check in a browser`,
    )
  const problems = [...missing, ...wrongContent, ...unreadable]
  return record(
    'P4.4c',
    'Multi-site demo org seeded and serving',
    problems.length ? FAIL : PASS,
    problems.length
      ? problems.join('; ')
      : `${DEMO_HOSTS.length} branded hosts serving`,
  )
}

// ── P4.5 — the tracker's shape ─────────────────────────────────────────────
const QUALIFICATION_COLUMNS = [
  'Source',
  'ICP fit (1/2/3)',
  '# sites / locations',
  'Rough GMV',
]
const FUNNEL_COLUMNS = [
  'Touch 1 sent',
  'Replied',
  'Demo booked',
  'Demo held',
  'Agreement sent',
  'Paid',
  'MRR (USD)',
]

function checkTracker() {
  const tracker = parseTracker()
  if (!tracker)
    return record(
      'P4.5',
      'Per-lead tracker exists with the right shape',
      FAIL,
      'Per-Lead-Tracker.csv does not exist',
    )
  const problems = []
  if (tracker.rows.length !== 20)
    problems.push(`${tracker.rows.length} rows, expected 20`)
  const missing = [...QUALIFICATION_COLUMNS, ...FUNNEL_COLUMNS].filter(
    (c) => !tracker.header.includes(c),
  )
  if (missing.length) problems.push(`missing columns: ${missing.join(', ')}`)
  return record(
    'P4.5',
    'Per-lead tracker exists with the right shape',
    problems.length ? FAIL : PASS,
    problems.length
      ? problems.join('; ')
      : '20 rows, 4 qualification + 7 funnel columns',
  )
}

// ── P4.6 — no paid spend in week one ───────────────────────────────────────
function checkNoPaidSpend() {
  const doc = readDoc('GTM-Marketing-Advertising-Plan.md')
  const gated = doc !== null && /turn on the \$500 search spend/.test(doc)
  return record(
    'P4.6',
    'No paid spend in week one',
    gated ? PASS : UNKNOWN,
    gated
      ? 'GTM plan gates the $500 search budget at GA, not beta — confirm 0 ENABLED campaigns in Google Ads on the morning'
      : 'GTM plan not readable; confirm 0 ENABLED campaigns in Google Ads by hand',
  )
}

// ── Self-test: every check must be able to go red ───────────────────────────
async function runSelfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'p4-selftest-'))
  // Deliberately broken artifacts: an unresolved decision, a 1-of-20 list, a
  // DRAFT template, a placeholder booking link, a short tracker.
  writeFileSync(
    join(dir, 'Founding-Customer-Offer.md'),
    '- ⚖️ DECISION 1 pending\n- ~~DECISION 2~~ **RESOLVED**\n',
  )
  writeFileSync(
    join(dir, 'Per-Lead-Tracker.csv'),
    'Tranche,Name,Source\nA,Only One,warm\n',
  )
  writeFileSync(
    join(dir, 'Founding-Agreement-Email-Template.md'),
    '**Status:** DRAFT for the voice pass\n',
  )
  writeFileSync(
    join(dir, 'Design-Partner-Outreach.md'),
    'Book here: {booking link}\n',
  )

  docsRoot = dir
  results.length = 0
  checkDecisions()
  checkNames()
  checkAgreementTemplate()
  checkBookingLink()
  checkTracker()
  // A host that certainly does not serve Aglyn brand content.
  const savedHosts = DEMO_HOSTS.splice(0, DEMO_HOSTS.length)
  DEMO_HOSTS.push([
    'bogus',
    'https://this-host-does-not-exist.aglyn.app/',
    /Northgate/,
  ])
  await checkDemoOrg()
  // Restored in ONE call rather than `length = 0` then `push`. The two-step
  // form is a read-modify-write across an `await`, which `require-atomic-updates`
  // flags correctly even though this runner is single-threaded — and the rule
  // stops being theoretical the moment anything here runs concurrently.
  DEMO_HOSTS.splice(0, DEMO_HOSTS.length, ...savedHosts)

  docsRoot = docsDir
  const red = results.filter((r) => r.state === FAIL || r.state === UNKNOWN)
  const green = results.filter((r) => r.state === PASS)
  console.log(`Self-test against a deliberately broken fixture in ${dir}`)
  for (const r of results)
    console.log(`  ${r.state.padEnd(7)} ${r.id}  ${r.detail}`)
  console.log(
    `\n${red.length} of ${results.length} checks went red; ${green.length} stayed green.`,
  )
  if (green.length) {
    console.error(
      '\nSELF-TEST FAILED — a check stayed green on a broken fixture, so it ' +
        'cannot detect the thing it claims to check.',
    )
    process.exit(1)
  }
  console.log('\nSELF-TEST PASSED — every check can go red.')
  process.exit(0)
}

// ── Main ───────────────────────────────────────────────────────────────────
if (selfTest) {
  await runSelfTest()
} else {
  if (!existsSync(docsDir)) {
    console.error(
      `Pre-flight docs folder not found:\n  ${docsDir}\n\n` +
        'This is UNKNOWN, not a pass. Mount the "Platform Docs" shared drive, ' +
        'or pass --docs <path>.',
    )
    process.exit(2)
  }
  checkDecisions()
  checkCoupon()
  checkNames()
  await checkLegal()
  checkAgreementTemplate()
  checkBookingLink()
  await checkDemoOrg()
  checkTracker()
  checkNoPaidSpend()

  console.log('\nWeek-One pre-flight — precondition P4 (AGL-1617)\n')
  for (const r of results)
    console.log(
      `  ${r.state.padEnd(7)} ${r.id.padEnd(6)} ${r.title}\n          ${r.detail}`,
    )

  const failed = results.filter((r) => r.state === FAIL)
  const unknown = results.filter((r) => r.state === UNKNOWN)
  console.log(
    `\n${results.filter((r) => r.state === PASS).length} pass · ${failed.length} fail · ${unknown.length} unknown`,
  )
  if (failed.length) process.exit(1)
  if (unknown.length) process.exit(2)
  process.exit(0)
}
