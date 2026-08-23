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

// Nothing but a TEST HOOK may be stripped from the browser bundle (AGL-2486).
//
// `compiler.reactRemoveProperties` deletes JSX props whose name matches one of
// its patterns, in the browser build only. That is invisible to every test in
// this repo: jest compiles with a different transform which KEEPS the prop, so
// a component whose prop is being erased in production still renders correctly
// under test and its spec passes.
//
// It cost eight call sites. `displayName` was in the list — copied from the
// styled-components option of the same name, in the comment directly below it
// in the config — so `<MemberAvatar displayName={…} />` lost that prop
// everywhere, and avatars fell back to email initials or a bare `?` from
// AGL-1126 until 2026-08-23.
//
// This guard is deliberately a WHITELIST rather than a blacklist of known-bad
// names. A blacklist only ever knows about the props that have already been
// broken.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const CONFIG = join(import.meta.dirname, '..', '..', '..', 'with-aglyn.nextjs.config.js')
const source = readFileSync(CONFIG, 'utf8')

/** The patterns actually configured, read out of the config source. */
function configuredPatterns() {
  // Anchored at the start of a line so the `@example` lines in the docblock
  // directly above the real option — which contain the same text — cannot be
  // read as the configuration. They are prefixed with ` * `, and matching one
  // of them made this guard's first run pass against a value nothing uses.
  const match = source.match(
    /^\s*reactRemoveProperties:\s*\{\s*properties:\s*\[([^\]]*)\]/m,
  )
  assert.ok(match, 'reactRemoveProperties.properties not found in the config')
  return [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1])
}

describe('reactRemoveProperties (AGL-2486)', () => {
  it('reads the real config', () => {
    assert.ok(source.length > 1000)
    assert.ok(source.includes('reactRemoveProperties'))
  })

  it('strips test hooks and nothing else', () => {
    // A pattern that does not begin `^data-test` is, by construction, aimed at
    // a prop a component reads at runtime. Widening this list is how the
    // avatar bug happened, so widening it has to be a deliberate edit here
    // with a reason, not a one-word addition in the config.
    for (const pattern of configuredPatterns()) {
      assert.ok(
        pattern.startsWith('^data-test'),
        `reactRemoveProperties would delete a runtime prop: ${JSON.stringify(pattern)}. ` +
          'These are Rust regexes matched against JSX prop NAMES, in the ' +
          'browser build only — jest keeps the prop, so nothing else in this ' +
          'repo can catch it.',
      )
    }
  })

  it('does not strip displayName, the one that already cost us', () => {
    assert.ok(
      !configuredPatterns().includes('displayName'),
      'displayName is a prop components read; the styled-components option of ' +
        'the same name is unrelated and is configured elsewhere.',
    )
  })

  it('has at least one pattern, so the option is doing its job', () => {
    assert.ok(configuredPatterns().length > 0)
  })
})
