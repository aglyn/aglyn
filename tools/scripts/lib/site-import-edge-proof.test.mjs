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

// Guard the proof (AGL-4085). A proof that reports "proved" when the rule is
// missing, or when a near miss passed, is worse than none: it is the evidence
// the rule is applied on. No network here.
//
//   npm run test:firewall-posture

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { EXPECTED_POSTURE } from './firewall-posture.mjs'
import {
  AGLYN_BOT_USER_AGENT,
  EDGE_HEADER,
  classify,
  proofCases,
  targetProblem,
  tokenProblem,
  verdict,
  wrongTokenFor,
} from './site-import-edge-proof.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const TOKEN = 'not-the-real-site-import-secret-value-here'

const CHALLENGE = { status: 429, mitigated: 'challenge' }
const PASS = { status: 200, mitigated: null }

/** The answers a correctly applied rule gives, case by case. */
function healthyAnswers() {
  return proofCases(TOKEN, wrongTokenFor(TOKEN)).map((c) => ({ ...c, ...(c.expect === 'pass' ? PASS : CHALLENGE) }))
}

test('the cases are the declared rule, both ways', () => {
  const rule = EXPECTED_POSTURE.find((e) => e.project === 'aglyn-tenant').bypassRules.find(
    (r) => r.name === 'Site import crawler bypass',
  )
  assert.equal(rule.conditions[0].key, EDGE_HEADER, 'the proof sends the header the rule matches')
  assert.ok(new RegExp(rule.conditions[1].value).test(AGLYN_BOT_USER_AGENT), "the crawler's user agent matches the rule")

  const cases = proofCases(TOKEN, wrongTokenFor(TOKEN))
  const passes = cases.filter((c) => c.expect === 'pass' && !c.control)
  assert.equal(passes.length, 1, 'exactly one case may pass: the secret with AglynBot')
  assert.equal(passes[0].headers[EDGE_HEADER], TOKEN)
  assert.equal(passes[0].headers['user-agent'], AGLYN_BOT_USER_AGENT)
  for (const nearMiss of cases.filter((c) => c.expect === 'challenge')) {
    const header = nearMiss.headers[EDGE_HEADER]
    const agent = nearMiss.headers['user-agent']
    const bothRight = header === TOKEN && new RegExp(rule.conditions[1].value).test(agent)
    assert.equal(bothRight, false, `${nearMiss.name} would satisfy the rule and cannot be a near miss`)
  }
  // Each half alone, a wrong value, and the unanchored user agent are all covered.
  assert.deepEqual(
    cases.map((c) => c.id),
    ['control', 'secret-and-agent', 'agent-only', 'wrong-secret', 'secret-other-agent', 'secret-unanchored-agent', 'stranger'],
  )
  assert.equal(cases[0].headers[EDGE_HEADER], undefined, 'the control carries no secret')
})

test('the wrong secret is the same length and is never the secret', () => {
  let flip = 0
  // A random source that first reproduces the secret's own characters cannot
  // make it return the secret.
  const same = wrongTokenFor('aaaa', () => [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5][flip++ % 8])
  assert.notEqual(same, 'aaaa')
  assert.equal(wrongTokenFor(TOKEN).length, TOKEN.length)
})

test('a correctly applied rule is proved', () => {
  const { exitCode, lines } = verdict(healthyAnswers())
  assert.equal(exitCode, 0)
  assert.match(lines.join('\n'), /Proved: the secret with AglynBot passes/)
})

test('the rule missing (the secret is challenged) fails', () => {
  const answers = healthyAnswers().map((a) => (a.id === 'secret-and-agent' ? { ...a, ...CHALLENGE } : a))
  const { exitCode, lines } = verdict(answers)
  assert.equal(exitCode, 1)
  assert.match(lines.join('\n'), /FAIL the secret \+ AglynBot: 429 x-vercel-mitigated: challenge; expected passed/)
})

test('each near miss that passes fails: the rule is wider than declared', () => {
  for (const id of ['agent-only', 'wrong-secret', 'secret-other-agent', 'secret-unanchored-agent', 'stranger']) {
    const answers = healthyAnswers().map((a) => (a.id === id ? { ...a, ...PASS } : a))
    const { exitCode, lines } = verdict(answers)
    assert.equal(exitCode, 1, id)
    assert.match(lines.join('\n'), /wider than declared/, id)
  }
})

test('a refusal that is not the challenge (a deny, an error page, no answer) is never read as either', () => {
  assert.equal(classify({ status: 403, mitigated: 'deny' }), 'other')
  assert.equal(classify({ status: 503, mitigated: null }), 'other')
  assert.equal(classify({ status: 429, mitigated: null }), 'other', 'a 429 the edge did not mark is a rate limit, not the challenge')
  assert.equal(classify({ status: 200, mitigated: 'challenge' }), 'other')
  assert.equal(classify({ status: 0, mitigated: null }), 'other')
  assert.equal(classify({ status: 308, mitigated: null }), 'passed', 'a redirect is the app answering')
  const answers = healthyAnswers().map((a) => (a.id === 'wrong-secret' ? { ...a, status: 0, mitigated: null, error: 'TimeoutError' } : a))
  assert.equal(verdict(answers).exitCode, 1)
})

test('a control that is not admitted means nothing can be proved from here, never a pass or a plain fail', () => {
  const blind = healthyAnswers().map((a) => (a.control ? { ...a, ...CHALLENGE } : a))
  const { exitCode, lines } = verdict(blind)
  assert.equal(exitCode, 2)
  assert.match(lines.join('\n'), /Cannot prove from here/)
})

test('the secret goes only to hosts the tenant serves for Aglyn', () => {
  for (const ok of ['https://aglyn.com/', 'https://aglyn.com/pricing?x=1', 'https://marketing.aglyn.app/']) {
    assert.equal(targetProblem(ok), null, ok)
  }
  for (const refused of [
    'http://aglyn.com/',
    'https://aglyn.com:8443/',
    'https://user:pass@aglyn.com/',
    'https://app.aglyn.com/',
    'https://docs.aglyn.com/',
    'https://evil-aglyn.com/',
    'https://aglyn.com.evil.net/',
    'https://a.b.aglyn.app/',
    'https://rosies-bakery.com/',
    'not a url',
  ]) {
    assert.notEqual(targetProblem(refused), null, refused)
  }
})

test('a missing or malformed secret is refused, and the refusal never echoes it', () => {
  assert.match(tokenProblem(''), /not set/)
  assert.match(tokenProblem('short'), /shorter than 32/)
  const odd = `${'a'.repeat(40)} with spaces`
  assert.ok(!tokenProblem(odd).includes(odd))
  assert.equal(tokenProblem(TOKEN), null)
})

test('the proof prints names and answers, never a header it sent', () => {
  const source = readFileSync(join(here, '..', 'prove-site-import-edge.mjs'), 'utf8')
  // The JSON form maps each result to named fields; the headers are not among them.
  assert.match(source, /results\.map\(\(\{ id, name, expect, status, mitigated, error \}\)/)
  assert.doesNotMatch(source, /console\.(log|error)\([^)]*token/)
  const { lines } = verdict(healthyAnswers())
  assert.equal(lines.join('\n').includes(TOKEN), false)
})
