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

// The sandbox CSP that ACTUALLY ships (AGL-1092). Standalone harness in the
// style of tools/eslint-rules/*.test.mjs, because this deployment is not part
// of an nx project and had no coverage at all: the only tested plugin CSP was
// an uncalled helper in libs/aglyn that disagreed with this one.
//
//   node tools/plugin-loader/origin/api/load.csp.test.mjs
//
// Wired into CI via the `test:plugin-loader` npm script.

import assert from 'node:assert/strict'
import { csp, sanitizeAncestors, sanitizeNetwork } from './load.mjs'

let failures = 0
function test(name, fn) {
  try {
    fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL ${name}\n     ${error.message}`)
  }
}

test('caps a plugin with no declared network at its own origin', () => {
  const policy = csp([], [])
  assert.match(policy, /connect-src 'self';/)
  assert.match(policy, /default-src 'none'/)
  // 'self' is load-bearing — the frame fetches its own bundle from here — so
  // the header must NOT be 'none', which is what the dead helper emitted.
  assert.doesNotMatch(policy, /connect-src 'none'/)
})

test('appends declared origins to connect-src, and nothing else', () => {
  const policy = csp(['https://api.example.com', 'https://cdn.example.com'], [])
  assert.match(
    policy,
    /connect-src 'self' https:\/\/api\.example\.com https:\/\/cdn\.example\.com;/,
  )
})

test('keeps the frame unable to re-point URLs or post a form', () => {
  const policy = csp([], [])
  assert.match(policy, /base-uri 'none'/)
  assert.match(policy, /form-action 'none'/)
})

test('always allows the app origin to frame it, plus verified domains', () => {
  const base = csp([], [])
  assert.match(base, /frame-ancestors https:\/\/app\.aglyn\.com https:\/\/\*\.aglyn\.app$/)
  const widened = csp([], ['https://shop.example.com'])
  assert.match(widened, /https:\/\/\*\.aglyn\.app https:\/\/shop\.example\.com$/)
})

test('drops anything that is not a bare https origin', () => {
  // The values come from a public HTTP endpoint, so a rogue one must not be
  // able to close the directive and open another.
  assert.deepEqual(
    sanitizeNetwork([
      'https://ok.example.com',
      "https://evil.example; script-src 'unsafe-eval'",
      'http://insecure.example.com',
      'https://path.example.com/x',
      'javascript:alert(1)',
      '',
      null,
      42,
    ]),
    ['https://ok.example.com'],
  )
})

test('caps the declared list so the header cannot be bloated', () => {
  const many = Array.from({ length: 40 }, (_, i) => `https://h${i}.example.com`)
  assert.equal(sanitizeNetwork(many).length, 20)
})

test('lower-cases and shape-checks extra ancestors, capped at four', () => {
  assert.deepEqual(
    sanitizeAncestors([
      'https://SHOP.example.com',
      'https://shop.example.com/path',
      'http://shop.example.com',
      'https://a.example.com',
      'https://b.example.com',
      'https://c.example.com',
      'https://d.example.com',
    ]),
    [
      'https://shop.example.com',
      'https://a.example.com',
      'https://b.example.com',
      'https://c.example.com',
    ],
  )
})

test('treats a missing or malformed list as empty, never as permissive', () => {
  assert.deepEqual(sanitizeNetwork(undefined), [])
  assert.deepEqual(sanitizeNetwork('https://evil.example'), [])
  assert.deepEqual(sanitizeAncestors(null), [])
  assert.match(csp(sanitizeNetwork(undefined), sanitizeAncestors(null)), /connect-src 'self';/)
})

if (failures) {
  console.error(`\n${failures} failing assertion(s)`)
  process.exit(1)
}
console.log('\nplugin loader CSP: all checks passed')
