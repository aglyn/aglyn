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
 * Support's two surfaces (AGL-1158).
 *
 * Tickets and the forum were one page sharing one loader, one org gate and one
 * card layout. Splitting them puts a NEW decision on the critical path — which
 * channel `/[orgSlug]/support` forwards a workspace to — and that decision is
 * read from the org's plan, which is exactly the class of question that must
 * not be answered while the answer is still loading.
 *
 * These are the two things a UI pass cannot see:
 *   * the landing must stay derived from the same field the ticket route
 *     enforces, so the page a workspace gets cannot drift from the gate;
 *   * the landing must refuse to answer before the plan is trustworthy.
 */

import { SUPPORT_BY_PLAN, supportForPlan, type SupportCommitment } from '@aglyn/aglyn'
import { Route } from '../constants/route-links'
import { resolveActiveTab } from '../hooks/use-secondary-nav'
import orgNavTabItems from '../constants/org-nav-tabs'
import {
  primarySupportSurface,
  supportLandingRoute,
  supportSurfaceRoute,
} from '../utils/support-surfaces'

const ORG = 'acme'

describe('which Support channel a plan lands on (AGL-1158)', () => {
  it.each(Object.keys(SUPPORT_BY_PLAN))(
    '%s lands on the channel its commitment actually carries',
    (plan) => {
      const commitment = supportForPlan(plan as never)
      // Derived from the SAME field `/api/support/tickets` gates POST on.
      // A plan list here would be a second copy of the ladder, and the two
      // would drift the first time a plan was added — which is the bug
      // AGL-1103 fixed in the routes and this repeats for the routing.
      expect(`${plan}: ${primarySupportSurface(commitment)}`).toBe(
        `${plan}: ${commitment.firstResponse !== null ? 'tickets' : 'forum'}`,
      )
    },
  )

  it('sends the forum-only tiers to the forum', () => {
    // The whole point of the split: Free and Starter get a page, not the
    // smaller half of one dominated by a ticket card they cannot use.
    expect(primarySupportSurface(supportForPlan('free'))).toBe('forum')
    expect(primarySupportSurface(supportForPlan('starter'))).toBe('forum')
  })

  it('sends every ticket-bearing tier to tickets', () => {
    for (const plan of ['pro', 'business', 'scale', 'advanced', 'agency', 'enterprise'] as const) {
      expect(`${plan}: ${primarySupportSurface(supportForPlan(plan))}`).toBe(
        `${plan}: tickets`,
      )
    }
  })
})

describe('the Support landing refuses to guess (AGL-1158)', () => {
  const enterprise = supportForPlan('enterprise')

  it('answers nothing until the plan is trustworthy', () => {
    // THE load-bearing case. `org` is undefined both in flight and when there
    // is no org doc, so a landing computed before `ready` sends an Enterprise
    // workspace to the forum and presents it as their support channel — the
    // same shape as reading a loading default as the free tier.
    expect(supportLandingRoute(enterprise, ORG, false)).toBeNull()
  })

  it('answers nothing without an org slug', () => {
    // `buildRoute` would happily emit `/undefined/support/tickets`.
    expect(supportLandingRoute(enterprise, '', true)).toBeNull()
    expect(supportLandingRoute(null, ORG, true)).toBeNull()
  })

  it('forwards once the plan is known', () => {
    expect(supportLandingRoute(enterprise, ORG, true)).toBe(
      `/${ORG}/support/tickets`,
    )
    expect(supportLandingRoute(supportForPlan('free'), ORG, true)).toBe(
      `/${ORG}/support/forum`,
    )
  })

  it('never forwards to the page doing the forwarding', () => {
    // A landing that resolves to `/[orgSlug]/support` is an infinite replace
    // loop in the address bar — the same failure `collaboratorRedirect` is
    // shaped to avoid, and the reason both are pure modules with tests.
    for (const commitment of Object.values(SUPPORT_BY_PLAN) as SupportCommitment[]) {
      expect(supportLandingRoute(commitment, ORG, true)).not.toBe(`/${ORG}/support`)
    }
  })
})

describe('Support is still ONE nav section (AGL-1158)', () => {
  it('keeps both channels beneath the Support route', () => {
    expect(Route.MANAGE_SUPPORT_TICKETS.startsWith(`${Route.MANAGE_SUPPORT}/`)).toBe(true)
    expect(Route.MANAGE_SUPPORT_FORUM.startsWith(`${Route.MANAGE_SUPPORT}/`)).toBe(true)
  })

  it('highlights the Support tab on both channels', () => {
    // The umbrella promise, mechanically. `resolveActiveTab` matches the first
    // segment below the section base, so a sub-route keeps its parent tab —
    // but nothing asserted that for a section that had never had one, and a
    // split that silently unhighlights the nav reads as leaving the section.
    const support = `/${ORG}/support`
    for (const path of [
      support,
      supportSurfaceRoute('tickets', ORG),
      supportSurfaceRoute('forum', ORG),
    ]) {
      expect(`${path} -> ${resolveActiveTab(path, `/${ORG}`, orgNavTabItems(ORG))}`).toBe(
        `${path} -> ${support}`,
      )
    }
  })
})
