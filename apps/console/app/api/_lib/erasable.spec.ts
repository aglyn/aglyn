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
 * AGL-1050 follow-up: `/api/resources/erase` must not accept an org
 * resource under the host scope.
 *
 * This is a whitelist, so the assertions that matter are the NEGATIVE ones.
 * A spec that only checked the allowed pairs would pass just as well with
 * `'hosts'` still on `datasets` — which is the state being fixed.
 */

import { ERASABLE, isErasable } from './erasable'

describe('erasable kinds and scopes (AGL-945/946/947, AGL-1050)', () => {
  it('accepts the org resources under the org scope', () => {
    expect(isErasable('datasets', 'orgs')?.label).toBe('Dataset')
    expect(isErasable('lists', 'orgs')?.label).toBe('List')
  })

  it('refuses an org resource named under the host scope', () => {
    // The host branch of the route checks site `memberRoles` and never
    // consults `visibleTo`, so this pair asked for the weaker check —
    // skipping the AGL-1046 boundary entirely.
    expect(isErasable('datasets', 'hosts')).toBeNull()
    expect(isErasable('lists', 'hosts')).toBeNull()
  })

  it('keeps collections host-scoped, and only host-scoped', () => {
    // Not an org resource with a fallback: a collection lives on the host.
    expect(isErasable('collections', 'hosts')?.label).toBe('Collection')
    expect(isErasable('collections', 'orgs')).toBeNull()
  })

  it('refuses unknown kinds and unknown scopes', () => {
    expect(isErasable('members', 'orgs')).toBeNull()
    expect(isErasable('datasets', '')).toBeNull()
    expect(isErasable('', 'orgs')).toBeNull()
    // Not a path, a name — the route never takes a Firestore path.
    expect(isErasable('orgs/o1/datasets', 'orgs')).toBeNull()
  })

  it('has no kind reachable under both scopes', () => {
    // The property the fix establishes: one resource, one address. If a
    // future kind needs both, the route's two authorization branches have
    // to be reconciled first — see the note in `erasable.ts`.
    const bothScopes = Object.entries(ERASABLE).filter(
      ([, resource]) =>
        resource.scopes.includes('orgs') && resource.scopes.includes('hosts'),
    )
    expect(bothScopes).toEqual([])
  })
})
