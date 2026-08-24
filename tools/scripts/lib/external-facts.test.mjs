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

// The comparator's own tests (AGL-2193).
//
// The load-bearing ones are the UNKNOWN cases, and specifically
// `a challenge page never scores an absence assertion`. That single assertion
// is the reason this file exists: a checker that reports PASS on a page it
// never read manufactures a false close, and it does it silently, on the
// happy path, with a green tick beside it.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FAIL,
  PASS,
  PENDING,
  UNKNOWN,
  classifyHttp,
  classifyMalformed,
  classifyManual,
  commentBody,
  commentMarker,
  extractBlocks,
  groupByIssue,
  isChallenge,
  overallExitCode,
  parseBlock,
  parseIssue,
  tally,
} from './external-facts.mjs'

const http = (source) => parseBlock(source, { issue: 'AGL-1' })

// ── extraction ─────────────────────────────────────────────────────────────

test('extracts only aglyn-check fences', () => {
  const body = [
    'Prose.',
    '```bash',
    'curl https://example.com',
    '```',
    '```aglyn-check',
    'url: https://aglyn.com/x',
    'expect-status: 200',
    '```',
    'More prose.',
    '```aglyn-check',
    'confirm: a thing',
    '```',
  ].join('\n')
  const blocks = extractBlocks(body)
  assert.equal(blocks.length, 2)
  assert.match(blocks[0], /expect-status/)
  assert.match(blocks[1], /confirm/)
})

test('tolerates tilde fences, indentation and a trailing info word', () => {
  const body = ['~~~aglyn-check http', '  url: https://aglyn.com/x', '  expect-status: 200', '~~~'].join('\n')
  assert.equal(extractBlocks(body).length, 1)
})

test('a body with no blocks yields none, and does not throw on null', () => {
  assert.deepEqual(extractBlocks('nothing here'), [])
  assert.deepEqual(extractBlocks(null), [])
  assert.deepEqual(extractBlocks(undefined), [])
})

// ── parsing: the malformed cases are all UNKNOWN, never PASS ───────────────

test('an absence assertion WITHOUT a control is refused', () => {
  const parsed = http('url: https://aglyn.com/x\nexpect-absent: Up to 100 sites on Agency')
  assert.equal(parsed.kind, 'malformed')
  assert.match(parsed.reason, /requires a `control:`/)
  assert.equal(classifyMalformed(parsed).state, UNKNOWN)
})

test('an absence assertion WITH a control parses', () => {
  const parsed = http(
    'url: https://aglyn.com/x\nexpect-absent: Up to 100 sites on Agency\ncontrol: Enterprise',
  )
  assert.equal(parsed.kind, 'http')
  assert.deepEqual(parsed.absent, ['Up to 100 sites on Agency'])
  assert.equal(parsed.control, 'Enterprise')
  assert.equal(parsed.expectStatus, 200, 'a body assertion defaults to expecting 200')
})

test('a typo in a key is malformed, not silently ignored', () => {
  // The realistic mistake. Ignoring it would drop the only assertion in the
  // block and leave an issue that "passes" because it asserts nothing.
  const parsed = http('url: https://aglyn.com/x\nexpect_absent: gone\ncontrol: real')
  assert.equal(parsed.kind, 'malformed')
  assert.match(parsed.reason, /unknown key/)
})

test('a block that asserts nothing is malformed', () => {
  const parsed = http('url: https://aglyn.com/x')
  assert.equal(parsed.kind, 'malformed')
  assert.match(parsed.reason, /nothing is asserted/)
})

test('the other malformed shapes', () => {
  const cases = [
    ['', /empty block/],
    ['expect-status: 200', /needs either/],
    ['url: https://a.com/x\nconfirm: both', /never both/],
    ['url: not a url\nexpect-status: 200', /not a URL/],
    ['url: ftp://a.com/x\nexpect-status: 200', /must be http/],
    ['url: https://a.com/x\nexpect-status: 2000', /3-digit/],
    ['url: https://a.com/x\nexpect-status: ok', /3-digit/],
    ['url: https://a.com/x\nexpect-status: 200\nexpect-status: 404', /duplicate key/],
    ['url: https://a.com/x\nwhere: nowhere', /not valid in a `url:` block/],
    ['confirm: a thing\nexpect-status: 200', /not valid in a `confirm:` block/],
    ['url: https://a.com/x\nexpect-status: 200\ncontrol: x', /only meaningful/],
    ['this is not a key value line', /not `key: value`/],
  ]
  for (const [source, pattern] of cases) {
    const parsed = http(source)
    assert.equal(parsed.kind, 'malformed', `expected malformed: ${JSON.stringify(source)}`)
    assert.match(parsed.reason, pattern)
    assert.equal(classifyMalformed(parsed).state, UNKNOWN)
  }
})

test('comments and blank lines are allowed', () => {
  const parsed = http('# why\n\nurl: https://aglyn.com/x\nexpect-status: 200\n')
  assert.equal(parsed.kind, 'http')
})

// ── challenge detection ────────────────────────────────────────────────────

test('the Vercel challenge is detected by header and by bare 429', () => {
  assert.equal(isChallenge({ status: 429, headers: { 'x-vercel-mitigated': 'challenge' } }), true)
  assert.equal(isChallenge({ status: 429, headers: {} }), true, 'a bare 429 is still not a verdict')
  assert.equal(isChallenge({ status: 200, headers: { 'X-Vercel-Mitigated': 'challenge' } }), true)
  assert.equal(isChallenge({ status: 200, headers: {} }), false)
  assert.equal(isChallenge({ status: 404, headers: {} }), false)
})

test('a Headers instance works as well as a plain object', () => {
  const headers = new Headers({ 'x-vercel-mitigated': 'challenge' })
  assert.equal(isChallenge({ status: 429, headers }), true)
})

// ── classification: the vacuous pass, guarded three ways ───────────────────

test('⚑ a challenge page NEVER scores an absence assertion', () => {
  const parsed = http(
    'url: https://aglyn.com/solutions/enterprise\n' +
      'expect-absent: Up to 100 sites on Agency\n' +
      'control: Enterprise',
  )
  const result = classifyHttp(parsed, {
    status: 429,
    headers: { 'x-vercel-mitigated': 'challenge' },
    // The real challenge body. It contains NEITHER the forbidden string nor
    // the control — a two-state checker reads the first half and calls it a
    // pass.
    body: '<html><body>Vercel Security Checkpoint</body></html>',
  })
  assert.equal(result.state, UNKNOWN)
  assert.match(result.detail, /challenge/)
  assert.notEqual(result.state, PASS)
})

test('⚑ a 200 shell NEVER scores an absence assertion — the control catches it', () => {
  // No challenge header, a perfectly good 200, and a body that simply is not
  // the page. This is the case the challenge check alone would miss.
  const parsed = http(
    'url: https://aglyn.com/solutions/enterprise\n' +
      'expect-absent: Up to 100 sites on Agency\n' +
      'control: Enterprise',
  )
  const result = classifyHttp(parsed, {
    status: 200,
    headers: {},
    body: '<html><body><div id="root"></div></body></html>',
  })
  assert.equal(result.state, UNKNOWN)
  assert.match(result.detail, /control string absent/)
})

test('an absence assertion passes only when the control proves the page was read', () => {
  const parsed = http(
    'url: https://aglyn.com/solutions/enterprise\n' +
      'expect-absent: Up to 100 sites on Agency\n' +
      'control: Enterprise',
  )
  assert.equal(
    classifyHttp(parsed, { status: 200, headers: {}, body: 'Enterprise plans are contracted.' })
      .state,
    PASS,
  )
  assert.equal(
    classifyHttp(parsed, {
      status: 200,
      headers: {},
      body: 'Enterprise. Up to 100 sites on Agency.',
    }).state,
    FAIL,
  )
})

test('a status-only assertion passes and fails on the status line', () => {
  const parsed = http('url: https://aglyn.com/developers\nexpect-status: 200')
  assert.equal(classifyHttp(parsed, { status: 200, headers: {}, body: '' }).state, PASS)
  const failed = classifyHttp(parsed, { status: 404, headers: {}, body: '' })
  assert.equal(failed.state, FAIL, 'a 404 against expect-status 200 is a real FAIL, not UNKNOWN')
  assert.match(failed.detail, /HTTP 404, expected 200/)
})

test('a body assertion against an unexpected status is UNKNOWN, not FAIL', () => {
  // The distinction matters: a 500 tells you nothing about whether the copy
  // was edited, so scoring it as "not done" would be a guess wearing a verdict.
  const parsed = http('url: https://aglyn.com/x\nexpect-present: Shipped today')
  assert.equal(classifyHttp(parsed, { status: 500, headers: {}, body: 'oops' }).state, UNKNOWN)
  assert.equal(classifyHttp(parsed, { status: 404, headers: {}, body: '' }).state, UNKNOWN)
})

test('transport failures are UNKNOWN', () => {
  const parsed = http('url: https://nope.aglyn.invalid/x\nexpect-status: 200')
  const dns = classifyHttp(parsed, { error: { name: 'TypeError', cause: { code: 'ENOTFOUND' } } })
  assert.equal(dns.state, UNKNOWN)
  assert.match(dns.detail, /ENOTFOUND/)

  const timeout = classifyHttp(parsed, { error: { name: 'TimeoutError' } })
  assert.equal(timeout.state, UNKNOWN)
  assert.match(timeout.detail, /timeout/)
})

test('presence and absence combine, and the detail names what went wrong', () => {
  const parsed = http(
    'url: https://aglyn.com/x\nexpect-present: ships today\nexpect-absent: in active planning\ncontrol: Enterprise',
  )
  const result = classifyHttp(parsed, {
    status: 200,
    headers: {},
    body: 'Enterprise: SSO is in active planning.',
  })
  assert.equal(result.state, FAIL)
  assert.match(result.detail, /missing/)
  assert.match(result.detail, /still present/)
})

// ── the manual form ────────────────────────────────────────────────────────

test('an unconfirmed fact is PENDING — never PASS, never FAIL', () => {
  const parsed = http('confirm: Form 401 is on file\nwhere: SOSDirect\nconfirmed:')
  assert.equal(parsed.kind, 'manual')
  const result = classifyManual(parsed)
  assert.equal(result.state, PENDING)
  assert.match(result.detail, /SOSDirect/)
})

test('an omitted `confirmed:` line is the same as an empty one', () => {
  assert.equal(classifyManual(http('confirm: a thing')).state, PENDING)
})

test('a confirmed fact passes and carries the evidence', () => {
  const parsed = http('confirm: Form 401 is on file\nconfirmed: 2026-08-14 · filing 804000000')
  const result = classifyManual(parsed)
  assert.equal(result.state, PASS)
  assert.match(result.detail, /804000000/)
})

// ── grouping and exit codes ────────────────────────────────────────────────

const results = (...states) =>
  states.map((state, index) => ({
    assertion: { issue: 'AGL-1', index, kind: 'http', url: `https://a/${index}`, digest: `d${index}` },
    state,
    detail: state,
  }))

test('an issue looks finished only when EVERY assertion passes', () => {
  assert.equal(groupByIssue(results(PASS, PASS))[0].verdict, PASS)
  assert.equal(groupByIssue(results(PASS, FAIL))[0].verdict, FAIL)
  assert.equal(groupByIssue(results(PASS, PENDING))[0].verdict, PENDING)
})

test('⚑ one UNKNOWN makes the whole issue undecidable, even beside passes', () => {
  // The missing assertion is exactly the one that might have said otherwise.
  assert.equal(groupByIssue(results(PASS, UNKNOWN))[0].verdict, UNKNOWN)
  assert.equal(groupByIssue(results(FAIL, UNKNOWN))[0].verdict, UNKNOWN)
})

test('exit 1 only when something looks finished AND everything was readable', () => {
  assert.equal(overallExitCode(groupByIssue(results(PASS, PASS))), 1)
  assert.equal(overallExitCode(groupByIssue(results(FAIL))), 0)
  assert.equal(overallExitCode(groupByIssue(results(PENDING))), 0)
})

test('⚑ UNKNOWN dominates — it can never print as 0 or 1', () => {
  assert.equal(overallExitCode(groupByIssue(results(PASS, UNKNOWN))), 2)
  assert.equal(overallExitCode(groupByIssue(results(FAIL, UNKNOWN))), 2)
  assert.equal(overallExitCode(groupByIssue(results(UNKNOWN))), 2)
})

test('⚑ an empty sweep is 2 — "nobody told me anything" is not "nothing to do"', () => {
  assert.equal(overallExitCode([]), 2)
  assert.equal(overallExitCode(groupByIssue([])), 2)
})

test('issues sort finished-first, then undecidable', () => {
  const grouped = groupByIssue([
    { assertion: { issue: 'AGL-3', kind: 'http', digest: 'a' }, state: FAIL, detail: '' },
    { assertion: { issue: 'AGL-2', kind: 'http', digest: 'b' }, state: UNKNOWN, detail: '' },
    { assertion: { issue: 'AGL-1', kind: 'http', digest: 'c' }, state: PASS, detail: '' },
  ])
  assert.deepEqual(
    grouped.map((i) => i.id),
    ['AGL-1', 'AGL-2', 'AGL-3'],
  )
})

test('tally counts every assertion once', () => {
  const counts = tally(groupByIssue(results(PASS, FAIL, UNKNOWN, PENDING)))
  assert.equal(counts.assertions, 4)
  assert.equal(counts[PASS], 1)
  assert.equal(counts[UNKNOWN], 1)
})

// ── the comment ────────────────────────────────────────────────────────────

test('the marker is stable for the same assertions and differs for others', () => {
  const one = groupByIssue(results(PASS, PASS))[0]
  const two = groupByIssue(results(PASS, PASS))[0]
  assert.equal(commentMarker(one), commentMarker(two), 'a re-run must not post twice')
  const other = groupByIssue([
    { assertion: { issue: 'AGL-1', kind: 'http', digest: 'zzz' }, state: PASS, detail: '' },
  ])[0]
  assert.notEqual(commentMarker(one), commentMarker(other))
})

test('the comment says what passed and explicitly does not close anything', () => {
  const issue = groupByIssue(results(PASS))[0]
  const body = commentBody(issue, { when: new Date('2026-08-24T09:00:00Z') })
  assert.match(body, /^<!-- aglyn-check:[0-9a-f]{12} -->/)
  assert.match(body, /now passes/)
  assert.match(body, /NOT changed/)
  assert.match(body, /2026-08-24 09:00Z/)
})

// ── end to end over a realistic issue body ─────────────────────────────────

test('a whole issue body parses into the assertions it carries', () => {
  const issue = {
    id: 'AGL-1941',
    description: [
      '## The contradiction',
      'Prose that mentions `expect-absent:` inline and must not be parsed.',
      '',
      '```aglyn-check',
      'url: https://aglyn.com/solutions/enterprise',
      'expect-absent: Up to 100 sites on Agency',
      'control: Enterprise',
      '```',
      '',
      '```aglyn-check',
      'confirm: the roadmap block no longer lists a public status page',
      'where: /solutions/enterprise, besigner',
      'confirmed:',
      '```',
    ].join('\n'),
  }
  const parsed = parseIssue(issue)
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].kind, 'http')
  assert.equal(parsed[0].issue, 'AGL-1941')
  assert.equal(parsed[1].kind, 'manual')
  assert.equal(parsed[1].confirmed, null)
})
