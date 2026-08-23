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

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withProbeHeaders, hasProbeToken } from './probe-headers.mjs'

const TOKEN = 'AGLYN_PROBE_TOKEN'

/** Run `fn` with the token env set to `value` (or unset for `null`). */
function withEnv(value, fn) {
  const before = process.env[TOKEN]
  if (value === null) delete process.env[TOKEN]
  else process.env[TOKEN] = value
  try {
    return fn()
  } finally {
    if (before === undefined) delete process.env[TOKEN]
    else process.env[TOKEN] = before
  }
}

test('withProbeHeaders — the bypass header', async (t) => {
  await t.test('sends the header when a token is configured', () => {
    withEnv('sentinel', () => {
      assert.equal(withProbeHeaders()['x-aglyn-probe'], 'sentinel')
    })
  })

  await t.test('omits the header entirely when no token is set', () => {
    withEnv(null, () => {
      // Not "sends an empty header" — an empty value would MATCH a Vercel
      // rule keyed on presence and is worse than sending nothing.
      assert.ok(!('x-aglyn-probe' in withProbeHeaders()))
    })
  })

  await t.test('treats an empty string as absent, not as a token', () => {
    withEnv('', () => {
      assert.ok(!('x-aglyn-probe' in withProbeHeaders()))
    })
  })

  await t.test('never throws when the secret is missing', () => {
    // A checker that crashes without a secret is a checker nobody can run
    // locally, which is how a guard quietly stops being run at all.
    withEnv(null, () => {
      assert.doesNotThrow(() => withProbeHeaders({ accept: 'text/html' }))
    })
  })

  await t.test('preserves the caller headers it was given', () => {
    withEnv('sentinel', () => {
      const headers = withProbeHeaders({
        'user-agent': 'aglyn-uptime-probe',
        accept: 'text/html',
      })
      assert.equal(headers['user-agent'], 'aglyn-uptime-probe')
      assert.equal(headers.accept, 'text/html')
      assert.equal(headers['x-aglyn-probe'], 'sentinel')
    })
  })

  await t.test('lets a caller override the bypass header', () => {
    withEnv('sentinel', () => {
      assert.equal(withProbeHeaders({ 'x-aglyn-probe': 'mine' })['x-aglyn-probe'], 'mine')
    })
  })

  await t.test('returns a fresh object, never the caller argument', () => {
    withEnv(null, () => {
      const base = { accept: 'text/html' }
      assert.notEqual(withProbeHeaders(base), base)
      assert.deepEqual(base, { accept: 'text/html' })
    })
  })

  await t.test('hasProbeToken reports what is configured', () => {
    withEnv('sentinel', () => assert.equal(hasProbeToken(), true))
    withEnv(null, () => assert.equal(hasProbeToken(), false))
  })
})

/**
 * Scripts that must carry the header, DERIVED plus a pinned floor.
 *
 * The hand-written list below was the whole guard until AGL-2486, and it
 * failed in the way a hand-written list fails: `check-retired-colours.mjs`
 * was written afterwards, fetches https://aglyn.com directly, was never
 * added — and the census answered `HTTP 429` on all three of its routes for
 * two days while this test stayed green over the three names it did know.
 * A guard whose scope is a literal cannot notice a fourth file; that is the
 * same shape as the bug it was written for, one level up.
 *
 * So the set is now discovered: every `tools/scripts/*.mjs` that calls
 * `fetch(` AND names one of our own hosts in CODE. Comments are stripped
 * first, deliberately — `setup-stripe.mjs` mentions app.aglyn.com in a usage
 * example and fetches api.stripe.com only, and sending our bypass token to a
 * third party is the one thing probe-headers.mjs says never to do.
 *
 * The literal names stay as a FLOOR: if the heuristic is ever narrowed by
 * accident, the three files this guard was born for still fail rather than
 * quietly leaving the derived set empty.
 */
function scriptsThatFetchAnAglynHost(scripts, { readFileSync, readdirSync, join }) {
  const withoutComments = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const derived = readdirSync(scripts)
    .filter((name) => name.endsWith('.mjs'))
    .filter((name) => {
      const code = withoutComments(readFileSync(join(scripts, name), 'utf8'))
      return /fetch\(/.test(code) && /https:\/\/[a-z0-9.-]*aglyn\.(com|app)/.test(code)
    })
  return [
    ...new Set([
      // The floor — the three the guard was written for (AGL-1611).
      'probe-uptime.mjs',
      'legal-doc-diff.mjs',
      'check-legal-index-dates.mjs',
      ...derived,
    ]),
  ].sort()
}

test('every script that fetches an Aglyn host uses the helper', async () => {
  // The defect this whole file exists for: the header was added to two of the
  // three live-fetch scripts, so the uptime probe and the drift diff went
  // green while `check-legal-index-dates.mjs` kept failing 429 in the SAME
  // workflow run. Reviewing three files for a missing ternary is exactly the
  // job a guard should hold.
  const { readFileSync, readdirSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const { join, dirname } = await import('node:path')
  const scripts = dirname(dirname(fileURLToPath(import.meta.url)))

  const names = scriptsThatFetchAnAglynHost(scripts, { readFileSync, readdirSync, join })
  // A derived set that collapsed to the floor would pass this test while
  // covering nothing new, which is the failure the floor cannot catch.
  assert.ok(
    names.length > 3,
    `expected the discovery to find live-fetch scripts beyond the three pinned names, got ${names.join(', ')}`,
  )

  for (const name of names) {
    const source = readFileSync(join(scripts, name), 'utf8')
    assert.match(
      source,
      /withProbeHeaders/,
      `${name} fetches an Aglyn host but does not use withProbeHeaders — it will be challenged with a 429 in CI`,
    )
    assert.doesNotMatch(
      source,
      /process\.env\[['"]AGLYN_PROBE_TOKEN['"]\]/,
      `${name} reads AGLYN_PROBE_TOKEN directly; go through withProbeHeaders so the reasoning has one home`,
    )
  }
})
