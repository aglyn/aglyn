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
 * Every enforced API scope is grantable in the console (AGL-2127).
 *
 * `API_SCOPES` in `@aglyn/tenant-data-admin` is what the v1 pipeline enforces.
 * `SCOPE_OPTIONS` in the org API-keys card is what a customer can actually
 * tick when minting a key. They were two hand-maintained lists with nothing
 * holding them together, which fails in both directions and neither one loudly:
 *
 *  - a scope in `API_SCOPES` but not in the picker is a scope **nobody can
 *    grant**, so the endpoints behind it ship closed to every customer while
 *    every test of those endpoints passes;
 *  - a scope in the picker but not in `API_SCOPES` is mintable and grants
 *    nothing — `normalizeScopes` filters it out on the way in, so the key
 *    silently comes back without it. That is the AGL-899 defect, which is why
 *    `contacts:write` was deleted rather than left as a promise.
 *
 * Read as SOURCE, not imported. `api-keys.ts` reaches `firebase-admin`, and
 * the card is a `'use client'` component wired to Firestore and MUI: importing
 * either into a node-environment spec buys a mocking exercise, for a question
 * that is answerable from the two literals. Same shape as
 * `plugin-help-topics.spec.ts`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '../../..')
const API_KEYS_SOURCE = join(
  REPO_ROOT,
  'libs/tenant/data/admin/src/lib/server/api-keys.ts',
)
const PICKER_SOURCE = join(
  REPO_ROOT,
  'apps/console/components/org-api-keys-card.component.tsx',
)

/** The `resource:action` strings inside a named array literal. */
function scopesInArray(source: string, declaration: RegExp): string[] {
  const start = source.search(declaration)
  if (start < 0) return []
  const open = source.indexOf('[', start)
  const close = source.indexOf(']', open)
  if (open < 0 || close < 0) return []
  return [...source.slice(open, close).matchAll(/'([a-z]+:[a-z]+)'/g)].map(
    (match) => match[1],
  )
}

const enforced = scopesInArray(
  readFileSync(API_KEYS_SOURCE, 'utf8'),
  /export const API_SCOPES =/,
)
const grantable = scopesInArray(
  readFileSync(PICKER_SOURCE, 'utf8'),
  /const SCOPE_OPTIONS:/,
)

describe('API scope picker coverage (AGL-2127)', () => {
  // The anti-vacuity half. Both extractors are regexes over source, so a
  // rename, a reformat, or a move turns them into functions that find nothing
  // — and "no scopes are missing" is trivially true of two empty lists. If
  // this fails, the parser has rotted; fix the parser, never the assertion.
  it('found both lists, non-empty', () => {
    expect(enforced.length).toBeGreaterThan(5)
    expect(grantable.length).toBeGreaterThan(5)
  })

  it('offers every enforced scope in the console', () => {
    const missing = enforced.filter((scope) => !grantable.includes(scope))
    if (missing.length > 0) {
      throw new Error(
        `API_SCOPES enforces ${missing.join(
          ', ',
        )}, which the org API-keys card does not offer. Nobody can grant them, so every endpoint behind them is closed to every customer. Add them to SCOPE_OPTIONS in apps/console/components/org-api-keys-card.component.tsx.`,
      )
    }
  })

  it('offers no scope the API does not enforce', () => {
    const phantom = grantable.filter((scope) => !enforced.includes(scope))
    if (phantom.length > 0) {
      throw new Error(
        `The org API-keys card offers ${phantom.join(
          ', ',
        )}, which is not in API_SCOPES. normalizeScopes() drops it, so a customer ticks a box and the key comes back without it — the AGL-899 defect. Remove it, or ship the endpoint that enforces it.`,
      )
    }
  })

  it('documents every enforced scope in the API reference', () => {
    // The third copy. A scope a customer can grant but cannot find in the docs
    // is a scope they will not use, and the docs page is a table of exactly
    // this list.
    const reference = readFileSync(
      join(REPO_ROOT, 'apps/docs/api/authentication.md'),
      'utf8',
    )
    const undocumented = enforced.filter(
      (scope) => !reference.includes(`\`${scope}\``),
    )
    expect(undocumented).toEqual([])
  })
})
