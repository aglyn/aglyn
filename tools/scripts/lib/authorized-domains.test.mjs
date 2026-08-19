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

// Guard the guard. check-authorized-domains.mjs is trusted to notice when
// Firebase starts trusting a hostname nobody approved, and a comparator that
// answers "no drift" because it compared nothing is indistinguishable from
// convergence. Every assertion below is written so it FAILS if the detector
// stops detecting — the drift cases assert the specific finding, not merely
// that `ok` is false.
//
//   npm run test:authorized-domains

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  compareAuthorizedDomains,
  fetchLiveAuthorizedDomains,
  formatReport,
  normalizeDomain,
  parseInventory,
} from './authorized-domains.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const entry = (domain, extra = {}) => ({
  domain,
  why: 'a rationale long enough to be a real rationale',
  ...extra,
})

const inventory = (domains, removed = []) => ({
  projectId: 'aglyn-main',
  domains: domains.map((d) => (typeof d === 'string' ? entry(d) : d)),
  removed: removed.map((d) => (typeof d === 'string' ? entry(d) : d)),
})

test('normalizeDomain folds case and a trailing dot', () => {
  assert.equal(normalizeDomain(' APP.Aglyn.com. '), 'app.aglyn.com')
})

test('parseInventory splits approved, stale and removed', () => {
  const parsed = parseInventory(
    inventory(
      ['app.aglyn.com', entry('api.aglyn.com', { stale: true })],
      ['aglyn-console.vercel.app'],
    ),
  )
  assert.deepEqual(parsed.expected, ['app.aglyn.com', 'api.aglyn.com'])
  assert.deepEqual(parsed.stale, ['api.aglyn.com'])
  assert.deepEqual(parsed.removed, ['aglyn-console.vercel.app'])
  assert.equal(parsed.projectId, 'aglyn-main')
})

test('parseInventory rejects an inventory it cannot compare honestly', () => {
  // Each of these would otherwise produce a partial list, and a partial list
  // compares green for everything it silently dropped.
  assert.throws(() => parseInventory(null), /not an object/)
  assert.throws(() => parseInventory({}), /`domains` must be an array/)
  assert.throws(
    () => parseInventory({ domains: [], removed: 'nope' }),
    /`removed` must be an array/,
  )
  assert.throws(
    () => parseInventory({ domains: ['app.aglyn.com'] }),
    /must be an object/,
  )
  assert.throws(
    () => parseInventory({ domains: [{ why: 'x'.repeat(30) }] }),
    /no `domain`/,
  )
  assert.throws(
    () => parseInventory({ domains: [{ domain: 'a.com', why: 'too short' }] }),
    /substantive `why`/,
  )
  assert.throws(
    () => parseInventory(inventory(['a.com', 'A.com'])),
    /listed twice/,
  )
  assert.throws(
    () => parseInventory(inventory(['a.com'], ['a.com'])),
    /in both `domains` and `removed`/,
  )
})

test('a matching pair is ok', () => {
  const result = compareAuthorizedDomains({
    expected: ['app.aglyn.com', 'auth.aglyn.com'],
    live: ['AUTH.aglyn.com', 'app.aglyn.com'],
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.liveOnly, [])
  assert.deepEqual(result.fileOnly, [])
  assert.deepEqual(result.readded, [])
})

test('a domain live trusts and no commit approved is LIVE-ONLY', () => {
  // The AGL-1940 shape, and the reason this check exists.
  const result = compareAuthorizedDomains({
    expected: ['app.aglyn.com'],
    live: ['app.aglyn.com', 'aglyn-console.vercel.app'],
  })
  assert.equal(result.ok, false)
  assert.deepEqual(result.liveOnly, ['aglyn-console.vercel.app'])
  assert.deepEqual(result.fileOnly, [])
  assert.match(formatReport(result), /LIVE-ONLY/)
})

test('a domain the file approves and live does not trust is FILE-ONLY', () => {
  const result = compareAuthorizedDomains({
    expected: ['app.aglyn.com', 'auth.aglyn.com'],
    live: ['app.aglyn.com'],
  })
  assert.equal(result.ok, false)
  assert.deepEqual(result.fileOnly, ['auth.aglyn.com'])
  assert.deepEqual(result.liveOnly, [])
  assert.match(formatReport(result), /FILE-ONLY/)
})

test('a removed domain that came back is RE-ADDED, not merely live-only', () => {
  // Undoing a security fix must not read as an ordinary unapproved entry.
  const result = compareAuthorizedDomains({
    expected: ['app.aglyn.com'],
    live: ['app.aglyn.com', 'aglyn-console.vercel.app'],
    removed: ['aglyn-console.vercel.app'],
  })
  assert.equal(result.ok, false)
  assert.deepEqual(result.readded, ['aglyn-console.vercel.app'])
  assert.deepEqual(
    result.liveOnly,
    [],
    'a re-added domain must be reported once, under the louder heading',
  )
  assert.match(formatReport(result), /RE-ADDED/)
})

test('a stale flag is a review note and never a failure', () => {
  const result = compareAuthorizedDomains({
    expected: ['app.aglyn.com', 'api.aglyn.com'],
    live: ['app.aglyn.com', 'api.aglyn.com'],
  })
  assert.equal(result.ok, true)
  const report = formatReport(result, { stale: ['api.aglyn.com'] })
  assert.match(report, /REVIEW \(not a failure\)/)
  assert.match(report, /api\.aglyn\.com/)
})

const stubFetch = (status, body) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
})

test('fetchLiveAuthorizedDomains returns the live list', async () => {
  const live = await fetchLiveAuthorizedDomains({
    token: 't',
    projectId: 'aglyn-main',
    apiBase: 'https://stub.invalid',
    fetchImpl: stubFetch(
      200,
      JSON.stringify({ authorizedDomains: ['App.Aglyn.com', 'localhost'] }),
    ),
  })
  assert.deepEqual(live, ['app.aglyn.com', 'localhost'])
})

test('fetchLiveAuthorizedDomains sends the token to the config resource', async () => {
  let seenUrl
  let seenAuth
  await fetchLiveAuthorizedDomains({
    token: 'the-token',
    projectId: 'aglyn-main',
    apiBase: 'https://stub.invalid',
    fetchImpl: async (url, init) => {
      seenUrl = url
      seenAuth = init.headers.Authorization
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ authorizedDomains: [] }),
      }
    },
  })
  assert.equal(
    seenUrl,
    'https://stub.invalid/admin/v2/projects/aglyn-main/config',
  )
  assert.equal(seenAuth, 'Bearer the-token')
})

test('an API refusal throws rather than reporting an empty allowlist', async () => {
  await assert.rejects(
    fetchLiveAuthorizedDomains({
      token: 't',
      projectId: 'aglyn-main',
      apiBase: 'https://stub.invalid',
      fetchImpl: stubFetch(403, '{"error":{"status":"PERMISSION_DENIED"}}'),
    }),
    /403/,
  )
})

test('a response without authorizedDomains is cannot-check, not empty', async () => {
  // The dangerous shape: an empty list would render every approved domain as
  // FILE-ONLY — a loud red that says nothing true — and, worse, a response
  // shape change would stop reporting LIVE-ONLY entries entirely.
  await assert.rejects(
    fetchLiveAuthorizedDomains({
      token: 't',
      projectId: 'aglyn-main',
      apiBase: 'https://stub.invalid',
      fetchImpl: stubFetch(200, '{"signIn":{}}'),
    }),
    /refusing/,
  )
  await assert.rejects(
    fetchLiveAuthorizedDomains({
      token: 't',
      projectId: 'aglyn-main',
      apiBase: 'https://stub.invalid',
      fetchImpl: stubFetch(200, '<html>not json</html>'),
    }),
    /not JSON/,
  )
})

test('the committed inventory parses and every entry carries a rationale', () => {
  const parsed = parseInventory(
    JSON.parse(
      readFileSync(join(repoRoot, 'cloud/firebase-auth-domains.json'), 'utf8'),
    ),
  )
  assert.equal(parsed.projectId, 'aglyn-main')
  assert.ok(parsed.expected.includes('app.aglyn.com'))
  assert.ok(parsed.expected.includes('auth.aglyn.com'))
  assert.ok(
    parsed.removed.includes('aglyn-console.vercel.app'),
    'the domain AGL-1940 removed must stay in the removed ledger so a ' +
      're-add is reported as a re-add',
  )
  assert.ok(
    !parsed.expected.includes('aglyn-console.vercel.app'),
    'AGL-1940 removed this from live; approving it again would make the ' +
      'checker bless the vector it was written to catch',
  )
})
