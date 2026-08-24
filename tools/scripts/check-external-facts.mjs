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

// Re-reads the external facts that open Linear issues depend on (AGL-2193).
// The non-git counterpart of `check-shipped-not-closed.mjs`, and it exists
// because that check is structurally blind to most of what actually finishes
// an issue here.
//
//   npm run check:external-facts -- --from-linear
//   npm run check:external-facts -- --from-linear --comment
//   npm run check:external-facts -- --file tools/scripts/fixtures/external-facts-demo.md
//   npm run check:external-facts -- --self-test
//
// ## THE DEFECT THIS ANSWERS
//
// Today's reconciliation of the 38 launch blockers found six already complete
// and still open — 16%. None was closed by a commit, so nothing in this
// repository could have noticed: a Texas Form 401 effective 08/14 and found
// nine days later, a Google payments profile address, two config screens, a
// besigner publish with no commit at all, and a decision.
// `check:shipped-not-closed` reads `git log`. There was no path from "an
// external fact changed" to "the board knows".
//
// ## THE CONVENTION
//
// A fenced ```aglyn-check block in the issue body. Two forms, both small
// enough to write in half a minute — a convention that costs more than that
// gets used once and abandoned:
//
//     ```aglyn-check
//     url: https://aglyn.com/developers
//     expect-status: 200
//     ```
//
//     ```aglyn-check
//     confirm: Registrant Last Name is set on all 7 Squarespace domains
//     where: Squarespace → Domains → <domain> → Contacts → Registrant
//     confirmed:
//     ```
//
// `expect-present:`/`expect-absent:` assert on the body, and `expect-absent`
// REFUSES to run without a `control:` string proving the real page was read.
// See `lib/external-facts.mjs` for why that is enforced by the parser rather
// than left to discipline.
//
// ## THE TOKEN, AND WHERE IT MAY GO
//
// Every aglyn.com / app.aglyn.com / docs.aglyn.com path answers 429 with
// `x-vercel-mitigated: challenge` to any non-browser client. `AGLYN_PROBE_TOKEN`
// (the existing `x-aglyn-probe` firewall bypass, already a repo secret) clears
// it on all three. The header is sent ONLY to hosts we own — an assertion may
// name any URL, and posting a shared bypass secret to a third party because
// somebody pasted their URL into an issue body would be a real leak.
//
// ## EXIT CODES
//
//   0  nothing looks newly finished, and everything was readable
//   1  at least one issue's assertions ALL pass — go and read it
//   2  something could not be evaluated, or there was nothing to evaluate
//
// 2 dominates 1. An UNKNOWN means the sweep did not see the whole board.

import { appendFileSync, readFileSync } from 'node:fs'

import {
  PASS,
  UNKNOWN,
  classifyHttp,
  classifyMalformed,
  classifyManual,
  commentBody,
  commentMarker,
  formatReport,
  groupByIssue,
  overallExitCode,
  parseIssue,
  tally,
} from './lib/external-facts.mjs'
import { hasProbeToken, withProbeHeaders } from './lib/probe-headers.mjs'

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'
const TIMEOUT_MS = 20_000

/**
 * Hosts the firewall-bypass header may be sent to.
 *
 * An assertion body is free text in a Linear issue, so the URL is untrusted
 * input as far as this script is concerned. `withProbeHeaders` says in its own
 * header that the token must not reach a third party; this is the enforcement.
 */
const OUR_HOSTS = /(^|\.)aglyn\.(com|app|io)$/

function parseArgs(argv) {
  const options = { fromLinear: false, files: [], comment: false, selfTest: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--from-linear') options.fromLinear = true
    else if (arg === '--comment') options.comment = true
    else if (arg === '--self-test') options.selfTest = true
    else if (arg.startsWith('--file=')) options.files.push(arg.slice(7))
    else if (arg === '--file') {
      const path = argv[i + 1]
      if (!path || path.startsWith('--')) throw new Error('--file needs a path')
      options.files.push(path)
      i += 1
    } else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

function linearKey() {
  const key = (process.env['LINEAR_API_KEY'] ?? '').trim()
  if (!key) {
    throw new Error(
      'LINEAR_API_KEY is not set, so the assertions cannot be read.\n' +
        '\n' +
        'This is the AGL-2379 failure mode and it must not degrade to a quiet\n' +
        'pass: an unreadable board is not a clean board. Set it once —\n' +
        '  gh secret set LINEAR_API_KEY\n' +
        '(Linear → Settings → Security & access → Personal API keys. Read is\n' +
        'enough for the report; --comment additionally needs write.)\n' +
        '\n' +
        'To run without Linear, point it at a file of blocks:\n' +
        '  npm run check:external-facts -- --file <path>',
    )
  }
  return key
}

async function linear(query, variables = {}) {
  const response = await fetch(LINEAR_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: linearKey() },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Linear responded ${response.status}`)
  const body = await response.json()
  if (body.errors) throw new Error(`Linear: ${JSON.stringify(body.errors)}`)
  return body.data
}

/**
 * Every OPEN issue whose body carries a block.
 *
 * Scoped to team AGL and filtered by STATE TYPE, never by label — the two
 * lessons `check-shipped-not-closed.mjs` records in its own header. A
 * label-defined queue silently empties, and a workspace-scope query returns
 * nothing while reading as a clean board.
 */
async function issuesFromLinear() {
  const query = `
    query AssertedIssues($after: String) {
      issues(
        first: 100
        after: $after
        filter: {
          team: { key: { eq: "AGL" } }
          state: { type: { nin: ["completed", "canceled"] } }
          description: { contains: "aglyn-check" }
        }
      ) {
        pageInfo { hasNextPage endCursor }
        nodes { identifier title description url state { name } }
      }
    }`
  const collected = []
  let after = null
  for (;;) {
    const page = (await linear(query, { after })).issues
    for (const node of page.nodes) {
      collected.push({
        id: node.identifier,
        title: node.title,
        description: node.description ?? '',
        url: node.url,
        state: node.state?.name ?? '?',
      })
    }
    if (!page.pageInfo.hasNextPage) break
    after = page.pageInfo.endCursor
  }
  return collected
}

/**
 * Fetch one URL and hand `classifyHttp` the parts it needs.
 *
 * `redirect: 'manual'`, for the reason `probe-uptime.mjs` records: following a
 * 3xx silently reports some other page's contents under this URL's name. Here
 * a redirect surfaces as a non-2xx and therefore as UNKNOWN, which is right —
 * `/developers` returning 308 to `/developers-home` is emphatically not
 * AGL-2397 being fixed.
 */
async function observe(url) {
  let ourHost = false
  try {
    ourHost = OUR_HOSTS.test(new URL(url).hostname)
  } catch {
    /* parseBlock already rejected unparseable URLs; belt and braces. */
  }
  const headers = ourHost
    ? withProbeHeaders({ 'user-agent': 'aglyn-external-facts' })
    : { 'user-agent': 'aglyn-external-facts' }
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return {
      status: response.status,
      headers: response.headers,
      body: await response.text().catch(() => ''),
    }
  } catch (error) {
    return { error }
  }
}

async function evaluate(issues) {
  const assertions = issues.flatMap((issue) => parseIssue(issue))
  const results = []
  for (const assertion of assertions) {
    if (assertion.kind === 'malformed') results.push(classifyMalformed(assertion))
    else if (assertion.kind === 'manual') results.push(classifyManual(assertion))
    else results.push(classifyHttp(assertion, await observe(assertion.url)))
  }
  return groupByIssue(results)
}

// ── delivery ───────────────────────────────────────────────────────────────

/**
 * Post one comment on each issue that now looks finished.
 *
 * COMMENT, NEVER CLOSE. The Todo list is handpicked; a false auto-close is
 * strictly worse than a missed one, because it removes the issue from the
 * place a human would have seen it. The assertion can only ever say an
 * external fact is now true, which is not the same claim as "this is done".
 *
 * Idempotent by marker: a finished issue passes again every day, and 365
 * identical comments a year would train everyone to mute the project.
 */
async function postComments(issues) {
  const finished = issues.filter((i) => i.verdict === PASS)
  if (!finished.length) return { posted: 0, skipped: 0 }

  let posted = 0
  let skipped = 0
  for (const issue of finished) {
    const existing = await linear(
      `query Comments($id: String!) {
         issue(id: $id) { id comments(first: 100) { nodes { body } } }
       }`,
      { id: issue.id },
    )
    const marker = commentMarker(issue)
    const already = (existing.issue?.comments?.nodes ?? []).some((c) =>
      (c.body ?? '').includes(marker),
    )
    if (already) {
      process.stdout.write(`  · ${issue.id} already has this comment; not repeating it\n`)
      skipped += 1
      continue
    }
    await linear(
      `mutation Comment($issueId: String!, $body: String!) {
         commentCreate(input: { issueId: $issueId, body: $body }) { success }
       }`,
      { issueId: existing.issue.id, body: commentBody(issue) },
    )
    process.stdout.write(`  → commented on ${issue.id}\n`)
    posted += 1
  }
  return { posted, skipped }
}

/**
 * The Actions run page, not just its log.
 *
 * A daily job whose output lives only in a collapsed log group is the
 * "written but never read" failure this check was written to fix, so the
 * verdict is also rendered where the run itself shows it.
 */
function writeStepSummary(issues, report) {
  const path = process.env['GITHUB_STEP_SUMMARY']
  if (!path) return
  const counts = tally(issues)
  const finished = issues.filter((i) => i.verdict === PASS)
  const lines = ['## External-fact assertions', '']
  if (finished.length) {
    lines.push(`### ${finished.length} issue(s) look finished`, '')
    for (const issue of finished) lines.push(`- **${issue.id}** — every assertion passes`)
    lines.push('')
  }
  if (counts[UNKNOWN]) {
    lines.push(
      `### ⚠ ${counts[UNKNOWN]} assertion(s) could not be evaluated`,
      '',
      'Neither a pass nor a fail. The report below is incomplete.',
      '',
    )
  }
  lines.push(
    `\`pass ${counts[PASS]} · fail ${counts['FAIL']} · pending ${counts['PENDING']} · UNKNOWN ${counts[UNKNOWN]}\``,
    '',
    '<details><summary>Full report</summary>',
    '',
    '```',
    report,
    '```',
    '',
    '</details>',
  )
  try {
    appendFileSync(path, `${lines.join('\n')}\n`)
  } catch {
    /* Best effort; the log still carries the report. */
  }
}

// ── self-test ──────────────────────────────────────────────────────────────

/**
 * Proves the SCRIPT's own wiring, not the comparator's — that has its own
 * suite. What is checked here is the pair of things a change to this file
 * could plausibly break without any test noticing: that the bypass token is
 * scoped to our hosts, and that a missing Linear key is an error rather than
 * an empty, clean-looking report.
 */
async function selfTest() {
  const failures = []
  const check = (ok, what) => {
    if (!ok) failures.push(what)
  }

  for (const host of ['aglyn.com', 'app.aglyn.com', 'docs.aglyn.com', 'demo.aglyn.app']) {
    check(OUR_HOSTS.test(host), `${host} should be recognised as ours`)
  }
  for (const host of ['example.com', 'aglyn.com.evil.net', 'notaglyn.com', 'aglyn.dev']) {
    check(!OUR_HOSTS.test(host), `${host} must NOT receive the bypass token`)
  }

  const saved = process.env['LINEAR_API_KEY']
  delete process.env['LINEAR_API_KEY']
  let threw = false
  try {
    linearKey()
  } catch (error) {
    threw = /LINEAR_API_KEY is not set/.test(error.message)
  }
  if (saved !== undefined) process.env['LINEAR_API_KEY'] = saved
  check(threw, 'a missing LINEAR_API_KEY must throw, never yield an empty sweep')

  if (failures.length) {
    process.stderr.write(`self-test FAILED:\n${failures.map((f) => `  - ${f}`).join('\n')}\n`)
    process.exit(1)
  }
  process.stdout.write('check-external-facts self-test: ok\n')
  process.exit(0)
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.selfTest) return selfTest()

  if (!options.fromLinear && options.files.length === 0) {
    process.stderr.write(
      'Nothing to read. Pass --from-linear, or --file <path> for a local set.\n',
    )
    process.exit(2)
  }

  const issues = []
  for (const file of options.files) {
    issues.push({ id: file, title: file, description: readFileSync(file, 'utf8'), url: file })
  }
  if (options.fromLinear) issues.push(...(await issuesFromLinear()))

  if (issues.length === 0) {
    process.stderr.write(
      'No open issue carries an `aglyn-check` block.\n' +
        'That is exit 2, not a clean board: it is far likelier that nobody has\n' +
        'written an assertion yet than that every external fact is settled.\n',
    )
    process.exit(2)
  }

  const grouped = await evaluate(issues)
  const report = formatReport(grouped)
  process.stdout.write(`${report}\n`)

  if (!hasProbeToken() && report.includes('challenge')) {
    process.stdout.write(
      '\nAGLYN_PROBE_TOKEN is not set — the challenges above are OUR OWN firewall,\n' +
        'not the pages. Set it and re-run before believing anything here.\n',
    )
  }

  writeStepSummary(grouped, report)

  if (options.comment) {
    if (grouped.some((i) => i.verdict === PASS)) process.stdout.write('\nposting comments…\n')
    const { posted, skipped } = await postComments(grouped)
    process.stdout.write(`\n${posted} comment(s) posted, ${skipped} already present.\n`)
  } else if (grouped.some((i) => i.verdict === PASS)) {
    process.stdout.write('\nRe-run with --comment to say so on the issues themselves.\n')
  }

  process.exit(overallExitCode(grouped))
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(2)
})
