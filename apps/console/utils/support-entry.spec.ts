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

import { buildRoute, Route } from '../constants/route-links'
import { billingHrefFor } from './billing-entry'
import { resolveOrgEntry } from './org-entry'
import { resolveSupportEntry, supportHrefFor } from './support-entry'

/**
 * The one decision behind `/support` (AGL-3265), driven per branch.
 *
 * The href is asserted through `buildRoute`, never as a hand-typed string:
 * the whole point of the entry point is that one static link resolves to
 * whatever the route table says support is, so a spec that transcribed
 * `/acme/support` would keep passing after the table moved.
 */
describe('resolveSupportEntry', () => {
  it('sends a single-workspace account straight to its support page', () => {
    expect(
      resolveSupportEntry([{ $id: 'o1', slug: 'acme', orgName: 'Acme' }]),
    ).toEqual({
      kind: 'one',
      href: supportHrefFor('acme'),
      org: { $id: 'o1', slug: 'acme', orgName: 'Acme' },
    })
  })

  it('offers a choice when the account belongs to several', () => {
    const destination = resolveSupportEntry([
      { $id: 'o1', slug: 'acme' },
      { $id: 'o2', slug: 'globex' },
    ])
    expect(destination.kind).toBe('choose')
    expect(
      destination.kind === 'choose'
        ? destination.orgs.map((org) => supportHrefFor(org.slug))
        : [],
    ).toEqual([supportHrefFor('acme'), supportHrefFor('globex')])
  })

  it('says so when there is no workspace at all', () => {
    expect(resolveSupportEntry([])).toEqual({ kind: 'no-workspace' })
    expect(resolveSupportEntry(null)).toEqual({ kind: 'no-workspace' })
    expect(resolveSupportEntry(undefined)).toEqual({ kind: 'no-workspace' })
  })

  it('drops an unlinkable row BEFORE counting, so one good org still goes straight through', () => {
    // A membership row with no slug would build `/undefined/support`. Counted
    // rather than dropped, it would also turn a single-workspace account into
    // a picker with a dead card in it.
    expect(resolveSupportEntry([{ $id: 'o1' }, { $id: 'o2', slug: 'acme' }])).toEqual(
      { kind: 'one', href: supportHrefFor('acme'), org: { $id: 'o2', slug: 'acme' } },
    )
    expect(resolveSupportEntry([{ $id: 'o1' }, { $id: 'o2', slug: '' }])).toEqual({
      kind: 'no-workspace',
    })
  })

  it('lands on the umbrella, never on one of its two channels', () => {
    // `MANAGE_SUPPORT` forwards by tier (AGL-1158). Linking past it from here
    // would copy that plan decision, and the copy is the one that sends a Free
    // workspace to a ticket form it cannot use.
    expect(supportHrefFor('acme')).toBe(
      buildRoute(Route.MANAGE_SUPPORT, { orgSlug: 'acme' }),
    )
    expect(supportHrefFor('acme')).not.toBe(
      buildRoute(Route.MANAGE_SUPPORT_TICKETS, { orgSlug: 'acme' }),
    )
    expect(supportHrefFor('acme')).not.toBe(
      buildRoute(Route.MANAGE_SUPPORT_FORUM, { orgSlug: 'acme' }),
    )
  })
})

describe('resolveOrgEntry, the resolver both entry points read', () => {
  const orgs = [{ $id: 'o1', slug: 'acme' }, { $id: 'o2', slug: 'globex' }]

  it('differs between its callers in the destination and nothing else', () => {
    // The extraction's whole claim. Same rows, same branch, same order — only
    // `hrefFor` changes, so a future case added to one entry point cannot
    // quietly fail to reach the other.
    const support = resolveOrgEntry(orgs, supportHrefFor)
    const billing = resolveOrgEntry(orgs, billingHrefFor)
    expect(support.kind).toBe(billing.kind)
    expect(support.kind === 'choose' ? support.orgs : []).toEqual(
      billing.kind === 'choose' ? billing.orgs : [],
    )
    expect(resolveOrgEntry([orgs[0]], supportHrefFor)).toEqual({
      kind: 'one',
      href: supportHrefFor('acme'),
      org: orgs[0],
    })
    expect(resolveOrgEntry([orgs[0]], billingHrefFor)).toEqual({
      kind: 'one',
      href: billingHrefFor('acme'),
      org: orgs[0],
    })
  })
})
