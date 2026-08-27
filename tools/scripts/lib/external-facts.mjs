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

// The `aglyn-check` assertion block — parsing, classification and reporting
// (AGL-2193). Pure: no network, no Linear, no process. `check-external-facts.mjs`
// is the I/O half.
//
// ## WHY THIS EXISTS
//
// On 2026-08-24 a reconciliation of the 38 launch blockers found SIX — 16% —
// already complete and still open. Not one could have been caught by
// `check:shipped-not-closed`, because not one was closed by a commit. They
// were closed by a state filing (Texas Form 401, effective 08/14, found nine
// days late), a live read of a payments profile, two config screens, a
// besigner publish with no commit at all (AGL-2396, `/newsroom`), and a
// decision. `check:shipped-not-closed` reads the git log and is therefore
// STRUCTURALLY BLIND to every one of them: there was no path at all from "an
// external fact changed" to "the board knows".
//
// This is that path. The issue itself carries a machine-runnable statement of
// what would make it finished, and something re-reads that statement daily.
//
// ## THE FOUR STATES, AND WHY THREE WERE NOT ENOUGH
//
//   PASS     the assertion was evaluated and is true
//   FAIL     the assertion was evaluated and is false — genuinely not done
//   UNKNOWN  the assertion COULD NOT BE EVALUATED
//   PENDING  a human-confirmable fact nobody has confirmed yet
//
// UNKNOWN is the whole design. `aglyn.com` sits behind Vercel Bot Protection:
// every non-browser client gets `429` with `x-vercel-mitigated: challenge`, on
// EVERY path, whether or not the page exists. A two-state checker reads that
// as "the string is absent" — which fails a presence assertion for the wrong
// reason and, far worse, PASSES AN ABSENCE ASSERTION VACUOUSLY, because the
// challenge page contains none of the strings anybody is looking for. That is
// this repository's signature bug: a check that is green because it read
// nothing (`feedback_a_green_check_only_proves_what_it_reads`, and
// `check:legal-index-dates` reporting drift when it had actually been
// firewalled). So a challenge, a timeout, a DNS failure, any non-2xx, and any
// malformed block are all UNKNOWN, and UNKNOWN dominates the exit code.
//
// ## THE `control:` KEY IS MANDATORY ON EVERY ABSENCE ASSERTION
//
// Detecting the challenge is necessary and not sufficient — a 200 can still be
// an empty shell, a login wall, or an error page rendered with a good status.
// So `expect-absent` is REFUSED without a `control:` string that must be
// present to prove the fetch read the real page. An absence assertion with no
// control is malformed, and malformed is UNKNOWN, never PASS. This is the same
// positive control `check-week-one-preflight.mjs` uses on the legal census,
// promoted from a habit into something the parser enforces.
//
// ## THE NON-HTTP FORM IS NOT A TODO CHECKBOX
//
// A `confirm:` block states a fact only a human can read — a filing number, a
// Workspace setting, a registrar field. It NEVER passes on its own; it reports
// PENDING until a human writes the evidence into `confirmed:` in the issue
// body. Filling that line is the act that converts "one person saw the filing"
// into "the record holds it", which is precisely the nine-day gap that opened
// on the Form 401. The
// checker's job is to keep the unconfirmed ones on a list that something reads
// every day, and to broadcast the moment one is filled in.

import { createHash } from 'node:crypto'

export const PASS = 'PASS'
export const FAIL = 'FAIL'
export const UNKNOWN = 'UNKNOWN'
export const PENDING = 'PENDING'

/** The fence language that marks a block as ours. */
export const FENCE_TAG = 'aglyn-check'

/**
 * Every key the block understands. An unrecognised key is a MALFORMED block,
 * not an ignorable comment: the realistic mistake is `expect_absent` or
 * `expect-missing`, and silently ignoring it would drop the only assertion in
 * the block and leave a passing-looking result behind. Typos must be loud.
 */
const HTTP_KEYS = new Set([
  'url',
  'expect-status',
  'expect-present',
  'expect-absent',
  'control',
  'note',
])
const MANUAL_KEYS = new Set(['confirm', 'where', 'confirmed', 'note'])

/** Keys that may legitimately appear more than once in one block. */
const REPEATABLE = new Set(['expect-present', 'expect-absent', 'note'])

/**
 * Pull every ```aglyn-check block out of an issue body.
 *
 * Tolerant of the info string carrying extra words (```aglyn-check http`) and
 * of ~~~ fences, because a body is hand-typed into a web textarea and the
 * convention is worthless if a stray character silently drops the assertion.
 *
 * @param text - the raw issue description (markdown)
 * @returns the inner source of each block, in document order
 */
export function extractBlocks(text) {
  const blocks = []
  const source = String(text ?? '')
  // A fence of 3+ backticks or tildes, whose info string STARTS with our tag,
  // closed by a fence of the same character and at least the same length.
  const fence = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^\n]*)\n([\s\S]*?)^[ \t]*\2[ \t]*$/gm
  for (const match of source.matchAll(fence)) {
    const info = (match[3] ?? '').trim().toLowerCase()
    if (info !== FENCE_TAG && !info.startsWith(`${FENCE_TAG} `)) continue
    blocks.push(match[4])
  }
  return blocks
}

/**
 * Parse one block's source into an assertion, or into a malformed record.
 *
 * Never throws. A malformed block is a RESULT (`kind: 'malformed'`), because
 * the caller has to report it as UNKNOWN against a real issue rather than
 * crash the whole sweep over one person's typo.
 */
export function parseBlock(source, { issue = null, index = 0 } = {}) {
  const raw = String(source ?? '')
  const digest = createHash('sha256')
    .update(raw.replace(/\r\n/g, '\n').trim())
    .digest('hex')
    .slice(0, 12)
  const base = { issue, index, digest, source: raw.trim() }
  const bad = (reason) => ({ ...base, kind: 'malformed', reason })

  const fields = new Map()
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const colon = trimmed.indexOf(':')
    if (colon < 1) {
      return bad(`line is not \`key: value\` — ${JSON.stringify(trimmed.slice(0, 60))}`)
    }
    const key = trimmed.slice(0, colon).trim().toLowerCase()
    const value = trimmed.slice(colon + 1).trim()
    if (!HTTP_KEYS.has(key) && !MANUAL_KEYS.has(key)) {
      return bad(`unknown key \`${key}\``)
    }
    if (fields.has(key) && !REPEATABLE.has(key)) {
      return bad(`duplicate key \`${key}\``)
    }
    if (REPEATABLE.has(key)) fields.set(key, [...(fields.get(key) ?? []), value])
    else fields.set(key, value)
  }

  if (fields.size === 0) return bad('empty block')

  const isHttp = fields.has('url')
  const isManual = fields.has('confirm')
  if (isHttp && isManual) return bad('a block has either `url:` or `confirm:`, never both')
  if (!isHttp && !isManual) return bad('a block needs either `url:` or `confirm:`')

  return isHttp ? parseHttp(fields, base, bad) : parseManual(fields, base, bad)
}

function parseHttp(fields, base, bad) {
  for (const key of fields.keys()) {
    if (!HTTP_KEYS.has(key)) return bad(`\`${key}\` is not valid in a \`url:\` block`)
  }

  const url = fields.get('url')
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return bad(`\`url\` is not a URL — ${JSON.stringify(url)}`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return bad(`\`url\` must be http(s), got ${parsed.protocol}`)
  }

  let expectStatus = null
  if (fields.has('expect-status')) {
    const value = fields.get('expect-status')
    if (!/^\d{3}$/.test(value)) return bad(`\`expect-status\` must be a 3-digit code, got ${JSON.stringify(value)}`)
    expectStatus = Number(value)
  }

  const present = (fields.get('expect-present') ?? []).filter(Boolean)
  const absent = (fields.get('expect-absent') ?? []).filter(Boolean)
  const control = fields.get('control') ?? null

  if (expectStatus === null && present.length === 0 && absent.length === 0) {
    return bad('nothing is asserted — add `expect-status`, `expect-present` or `expect-absent`')
  }

  // THE VACUOUS-PASS GUARD. See the header. An absence assertion with no
  // positive control cannot distinguish "the text is gone" from "we were
  // served a challenge, a shell, or an error page", and the second reads as a
  // pass. Refuse to accept the block at all rather than evaluate it and be
  // wrong in the direction that closes an unfinished issue.
  if (absent.length > 0 && !control) {
    return bad(
      '`expect-absent` requires a `control:` string that MUST be present — ' +
        'without one, a challenge page or an empty shell passes vacuously',
    )
  }
  if (control && absent.length === 0 && present.length === 0) {
    return bad('`control` is only meaningful alongside `expect-present`/`expect-absent`')
  }

  return {
    ...base,
    kind: 'http',
    url: parsed.toString(),
    expectStatus: expectStatus ?? (present.length || absent.length ? 200 : expectStatus),
    present,
    absent,
    control,
    note: (fields.get('note') ?? []).join(' '),
  }
}

function parseManual(fields, base, bad) {
  for (const key of fields.keys()) {
    if (!MANUAL_KEYS.has(key)) return bad(`\`${key}\` is not valid in a \`confirm:\` block`)
  }
  const confirm = fields.get('confirm')
  if (!confirm) return bad('`confirm` needs the fact to be confirmed')
  const confirmed = (fields.get('confirmed') ?? '').trim()
  return {
    ...base,
    kind: 'manual',
    confirm,
    where: fields.get('where') ?? null,
    // Empty is the normal, expected state — PENDING, not malformed.
    confirmed: confirmed || null,
    note: (fields.get('note') ?? []).join(' '),
  }
}

/** Every assertion in one issue body, malformed ones included. */
export function parseIssue(issue) {
  const blocks = extractBlocks(issue?.description)
  return blocks.map((source, index) =>
    parseBlock(source, { issue: issue?.id ?? null, index }),
  )
}

/**
 * Was this response a Vercel Bot Protection challenge?
 *
 * `x-vercel-mitigated: challenge` is the authoritative signal and the status
 * is a corroborating one — checked in that order, because the header is what
 * Vercel documents and the 429 is what it happens to send today. Either alone
 * is enough to refuse a verdict: a 429 from anywhere is a rate limit, and a
 * rate-limited read is no more conclusive than a challenged one.
 */
export function isChallenge({ status, headers }) {
  const mitigated = headerOf(headers, 'x-vercel-mitigated')
  if (mitigated) return true
  return status === 429
}

function headerOf(headers, name) {
  if (!headers) return null
  if (typeof headers.get === 'function') return headers.get(name)
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value
  }
  return null
}

/**
 * Turn one fetched response (or one transport error) into a verdict.
 *
 * PURE ON PURPOSE — it takes the response's parts rather than a Response, so a
 * test can hand it a 429-plus-challenge-header, a DNS failure and a 200 shell
 * without a network or a mock server. The AGL-1778 lesson: the thing that
 * decides must be testable away from the thing that fetches, or the deciding
 * is never actually tested.
 *
 * @param assertion - a parsed `http` assertion
 * @param observed  - `{ status, headers, body }`, or `{ error }`
 */
export function classifyHttp(assertion, observed) {
  const at = (state, detail) => ({ assertion, state, detail })

  if (observed?.error) {
    const error = observed.error
    const aborted = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    return at(
      UNKNOWN,
      aborted
        ? 'no response before the timeout'
        : `unreachable (${error?.cause?.code ?? error?.code ?? error?.name ?? 'error'})`,
    )
  }

  const { status, headers, body = '' } = observed ?? {}

  if (isChallenge({ status, headers })) {
    return at(
      UNKNOWN,
      `HTTP ${status} bot-protection challenge (x-vercel-mitigated: ` +
        `${headerOf(headers, 'x-vercel-mitigated') ?? 'n/a'}) — set AGLYN_PROBE_TOKEN`,
    )
  }

  // A status assertion is the ONLY thing that can legitimately want a non-2xx,
  // and it is the whole assertion when no body strings are named. `/developers`
  // 404ing today (AGL-2397) is a fact about the status line; there is no body
  // to control for, and demanding one would make the commonest assertion in
  // the set unwritable.
  const statusOnly = assertion.present.length === 0 && assertion.absent.length === 0
  if (statusOnly) {
    return status === assertion.expectStatus
      ? at(PASS, `HTTP ${status} as expected`)
      : at(FAIL, `HTTP ${status}, expected ${assertion.expectStatus}`)
  }

  // Body assertions need a body that is actually the page. Anything other than
  // the expected status means we are reading something else — an error page, a
  // redirect stub, a 404 shell — and its contents say nothing about the claim.
  if (status !== assertion.expectStatus) {
    return at(UNKNOWN, `HTTP ${status} (expected ${assertion.expectStatus}) — body not comparable`)
  }

  // THE CONTROL. Checked BEFORE the assertion it protects, so a shell can
  // never be scored. A 200 that does not contain the control is not a failing
  // page, it is an unread one.
  if (assertion.control && !body.includes(assertion.control)) {
    return at(
      UNKNOWN,
      `control string absent (${short(assertion.control)}) — read ${body.length}b ` +
        'that are not the expected page, so nothing here is a verdict',
    )
  }

  const missing = assertion.present.filter((needle) => !body.includes(needle))
  const lingering = assertion.absent.filter((needle) => body.includes(needle))

  if (missing.length === 0 && lingering.length === 0) {
    const parts = []
    if (assertion.present.length) parts.push(`${assertion.present.length} present`)
    if (assertion.absent.length) parts.push(`${assertion.absent.length} absent`)
    return at(PASS, `HTTP ${status}, ${parts.join(' + ')} as expected`)
  }

  const detail = [
    ...missing.map((n) => `missing ${short(n)}`),
    ...lingering.map((n) => `still present ${short(n)}`),
  ].join('; ')
  return at(FAIL, detail)
}

/** A `confirm:` block never self-evaluates. It waits for a human. */
export function classifyManual(assertion) {
  return assertion.confirmed
    ? { assertion, state: PASS, detail: `confirmed: ${assertion.confirmed}` }
    : {
        assertion,
        state: PENDING,
        detail: assertion.where
          ? `awaiting a human — ${assertion.where}`
          : 'awaiting a human',
      }
}

export function classifyMalformed(assertion) {
  return { assertion, state: UNKNOWN, detail: `malformed block — ${assertion.reason}` }
}

function short(text, max = 48) {
  const one = String(text).replace(/\s+/g, ' ')
  return JSON.stringify(one.length > max ? `${one.slice(0, max)}…` : one)
}

/**
 * Group per-assertion results by issue and decide what each issue looks like.
 *
 * An issue "looks finished" only when it has at least one assertion and EVERY
 * one of them passed. Any UNKNOWN makes the issue undecidable — deliberately
 * stronger than "the others passed", because the missing one is exactly the
 * assertion that would have said otherwise.
 */
export function groupByIssue(results) {
  const byIssue = new Map()
  for (const result of results) {
    const id = result.assertion.issue ?? '(no issue)'
    if (!byIssue.has(id)) byIssue.set(id, [])
    byIssue.get(id).push(result)
  }
  const issues = []
  for (const [id, list] of byIssue) {
    const states = new Set(list.map((r) => r.state))
    let verdict
    if (states.has(UNKNOWN)) verdict = UNKNOWN
    else if (list.every((r) => r.state === PASS)) verdict = PASS
    else if (states.has(FAIL)) verdict = FAIL
    else verdict = PENDING
    issues.push({ id, verdict, results: list })
  }
  // Finished first — the actionable half of the report should not need
  // scrolling to. Then the undecidable, which is the other thing a human must
  // act on. Failing and pending issues are the expected steady state.
  const rank = { [PASS]: 0, [UNKNOWN]: 1, [PENDING]: 2, [FAIL]: 3 }
  issues.sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.id.localeCompare(b.id))
  return issues
}

const GLYPH = { [PASS]: '✔', [FAIL]: '✘', [UNKNOWN]: '⚠ UNKNOWN', [PENDING]: '·' }

/**
 * The human report.
 *
 * UNKNOWN is spelled out rather than given a glyph, because the requirement it
 * serves is that it can never be skimmed past as either outcome. A tick and a
 * cross are a matched pair the eye reads as a binary; the word breaks that.
 */
export function formatReport(issues, { title = 'external-fact assertions' } = {}) {
  const lines = []
  const counts = tally(issues)

  lines.push(`${title} · ${counts.assertions} assertion(s) across ${issues.length} issue(s)`)
  lines.push('')

  for (const issue of issues) {
    lines.push(`${GLYPH[issue.verdict]}  ${issue.id}`)
    for (const result of issue.results) {
      const what =
        result.assertion.kind === 'http'
          ? result.assertion.url
          : result.assertion.kind === 'manual'
            ? result.assertion.confirm
            : `block #${result.assertion.index + 1}`
      lines.push(`      ${GLYPH[result.state]} ${what}`)
      lines.push(`         ${result.detail}`)
    }
    lines.push('')
  }

  const finished = issues.filter((i) => i.verdict === PASS)
  if (finished.length) {
    lines.push(
      `${finished.length} issue(s) LOOK FINISHED — every assertion passes: ` +
        `${finished.map((i) => i.id).join(', ')}`,
    )
    lines.push('Go and read them. This check comments; it never changes status.')
  } else {
    lines.push('No issue has all of its assertions passing.')
  }

  if (counts[UNKNOWN]) {
    lines.push('')
    lines.push(
      `⚠ ${counts[UNKNOWN]} assertion(s) COULD NOT BE EVALUATED. That is not a pass ` +
        'and not a fail —\n  the report above is incomplete and no verdict in it is safe to act on.',
    )
  }

  lines.push('')
  lines.push(
    `pass ${counts[PASS]} · fail ${counts[FAIL]} · pending ${counts[PENDING]} · ` +
      `UNKNOWN ${counts[UNKNOWN]}`,
  )
  return lines.join('\n')
}

export function tally(issues) {
  const counts = { [PASS]: 0, [FAIL]: 0, [UNKNOWN]: 0, [PENDING]: 0, assertions: 0 }
  for (const issue of issues) {
    for (const result of issue.results) {
      counts[result.state] += 1
      counts.assertions += 1
    }
  }
  return counts
}

/**
 * EXIT CODES — cannot-check must never masquerade as either answer.
 *
 *   0  nothing looks newly finished, and everything was readable
 *   1  at least one issue's assertions ALL pass — a status is probably stale
 *   2  at least one assertion could not be evaluated, or there was nothing to
 *      evaluate at all
 *
 * 2 DOMINATES 1, which is the opposite of `check-week-one-preflight.mjs` and
 * deliberate. There, an UNKNOWN sits beside verdicts that stand on their own.
 * Here an UNKNOWN means the sweep did not see the whole board, so "nothing is
 * finished" is unsupported — and this job's silence is the thing being
 * designed against. An empty sweep is 2 for the same reason it is in
 * `check-shipped-not-closed.mjs`: "nobody told me anything" must never print
 * as "nothing to do".
 */
export function overallExitCode(issues) {
  const counts = tally(issues)
  if (counts.assertions === 0) return 2
  if (counts[UNKNOWN] > 0) return 2
  return issues.some((i) => i.verdict === PASS) ? 1 : 0
}

/**
 * The comment posted to the issue whose assertions now all pass.
 *
 * Carries the digest of every assertion it is reporting on, which is what
 * makes re-posting detectable: the same issue passing again tomorrow produces
 * a byte-identical marker, and the poster skips it. Without that, a daily job
 * would leave 365 identical comments a year on every finished issue and
 * everybody would mute the project.
 */
export function commentMarker(issue) {
  const digests = issue.results
    .map((r) => r.assertion.digest)
    .sort()
    .join(',')
  const hash = createHash('sha256').update(digests).digest('hex').slice(0, 12)
  return `<!-- aglyn-check:${hash} -->`
}

export function commentBody(issue, { when = new Date() } = {}) {
  const lines = [commentMarker(issue), '']
  lines.push(
    '**Every `aglyn-check` assertion on this issue now passes.** This issue may ' +
      'already be done.',
  )
  lines.push('')
  for (const result of issue.results) {
    const what =
      result.assertion.kind === 'http'
        ? `\`${result.assertion.url}\``
        : result.assertion.confirm
    lines.push(`- ✔ ${what} — ${result.detail}`)
  }
  lines.push('')
  lines.push(
    `Checked ${when.toISOString().slice(0, 16).replace('T', ' ')}Z by ` +
      '`check:external-facts`.',
  )
  lines.push('')
  lines.push(
    '_Status was deliberately NOT changed._ The assertion says an external fact ' +
      'is now true; only a person can say the issue is done, and a wrong auto-close ' +
      'costs more than a late one.',
  )
  return lines.join('\n')
}
