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
 * The super-only staff surface (AGL-2131).
 *
 * TWO KINDS OF CASE, deliberately, because either alone is satisfiable by a
 * broken product:
 *
 * 1. BEHAVIOUR of the shared affordance — it must disable and explain for a
 *    refused role, pass the control through untouched for an admitted one,
 *    and do NEITHER while the claim is still resolving. A gate that blocked
 *    during the unresolved window would flash a dead button at every super
 *    staff member on every admin page load, which is why `useStaffRole`
 *    distinguishes `null` from a role at all.
 *
 * 2. COVERAGE, derived rather than listed. The route set is read off disk:
 *    every /api/admin route that REFUSES on `actorRole` is discovered, and
 *    each must appear in `GATED_SURFACES` with a UI file that references a
 *    role gate. A new super-only route with a UI that offers it to everyone
 *    therefore fails here without anyone editing this file — which is the
 *    AGL-2115 lesson, where a hand-listed set let a real gap through.
 *
 *    It asserts a REFERENCE, not a rendering, and that is a real limit: this
 *    cannot prove the gate wraps the right control. Case group 1 is what
 *    proves the gate works at all; this proves nobody forgot to reach for it.
 */

import { render, screen } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Button } from '@mui/material'

let mockRole: string | null = null

// Only the claim hook is doubled — the component under test is real, and so
// is MUI's disabled handling. Mocking the component's own module would make
// every case below a test of the mock.
jest.mock('../hooks/use-is-staff', () => ({
  __esModule: true,
  useStaffRole: () => mockRole,
  useIsStaff: () => mockRole !== null,
}))

import {
  StaffRoleOnly,
  SuperStaffOnly,
  SuperStaffOnlyNotice,
} from '../components/staff-super-only.component'

const CONSOLE_ROOT = join(__dirname, '..')

describe('the shared super-only affordance', () => {
  afterEach(() => {
    mockRole = null
  })

  it('disables the control and says why for support staff', () => {
    mockRole = 'support'
    render(
      <SuperStaffOnly>
        <Button onClick={() => undefined}>{'Lock the platform'}</Button>
      </SuperStaffOnly>,
    )
    expect(
      screen.getByRole('button', { name: 'Lock the platform' }),
    ).toHaveProperty('disabled', true)
    // The reason must reach the DOM, not only the props: a Tooltip on a
    // disabled button never fires, which is why the component wraps a span.
    expect(
      screen.getByLabelText(/requires the super staff role/i),
    ).toBeTruthy()
  })

  it('leaves the control alone for super staff', () => {
    mockRole = 'super'
    render(
      <SuperStaffOnly>
        <Button onClick={() => undefined}>{'Lock the platform'}</Button>
      </SuperStaffOnly>,
    )
    expect(
      screen.getByRole('button', { name: 'Lock the platform' }),
    ).toHaveProperty('disabled', false)
    expect(screen.queryByLabelText(/requires the super/i)).toBeNull()
  })

  it('blocks NOTHING while the claim is still resolving', () => {
    // `null` is the pre-resolution state. Blocking here would disable the
    // button for a super-staff member for as long as the token read takes.
    mockRole = null
    render(
      <SuperStaffOnly>
        <Button onClick={() => undefined}>{'Lock the platform'}</Button>
      </SuperStaffOnly>,
    )
    expect(
      screen.getByRole('button', { name: 'Lock the platform' }),
    ).toHaveProperty('disabled', false)
  })

  it('admits billing where the ROUTE admits billing', () => {
    // /api/admin/org-override takes `super` or `billing`. A gate that could
    // only say "super" would disable the override dialog for the one role
    // whose entire purpose is plan and quota writes.
    mockRole = 'billing'
    render(
      <StaffRoleOnly roles={['super', 'billing']}>
        <Button onClick={() => undefined}>{'Override'}</Button>
      </StaffRoleOnly>,
    )
    expect(screen.getByRole('button', { name: 'Override' })).toHaveProperty(
      'disabled',
      false,
    )
  })

  it('still refuses support on that same wider gate', () => {
    mockRole = 'support'
    render(
      <StaffRoleOnly roles={['super', 'billing']}>
        <Button onClick={() => undefined}>{'Override'}</Button>
      </StaffRoleOnly>,
    )
    expect(screen.getByRole('button', { name: 'Override' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(
      screen.getByLabelText(/requires the super or billing staff role/i),
    ).toBeTruthy()
  })

  it('shows the page notice only to a refused, RESOLVED role', () => {
    mockRole = 'super'
    const { rerender, container } = render(
      <SuperStaffOnlyNotice what="Locking and lifting" />,
    )
    expect(container.innerHTML).toBe('')
    mockRole = null
    rerender(<SuperStaffOnlyNotice what="Locking and lifting" />)
    expect(container.innerHTML).toBe('')
    mockRole = 'support'
    rerender(<SuperStaffOnlyNotice what="Locking and lifting" />)
    expect(screen.getByText(/requires the super staff role/i)).toBeTruthy()
  })
})

/**
 * Every /api/admin route that refuses a request on the caller's staff role,
 * mapped to the console surface that offers the act — and how that surface
 * expresses the gate.
 *
 * `flags/page.tsx` reads the role off its OWN endpoint's response rather than
 * from the claim hook, and has done since before this issue. That is a
 * legitimate second mechanism (the route is the authority either way), so the
 * matcher accepts it instead of forcing a rewrite of a page that was already
 * honest. AGL-2131's finding table listed it as a gap; it was not.
 */
const GATED_SURFACES: Record<string, { ui: string[]; via: RegExp }> = {
  'flags/route.ts': {
    ui: ['app/(app)/admin/flags/page.tsx'],
    via: /canEdit/,
  },
  'host/route.ts': {
    ui: [
      'app/(app)/admin/orgs/[orgId]/host/[hostId]/page.tsx',
      // The route's SECOND super-only action (AGL-2011). Its control lives in
      // the card, not the page, so listing only the page would have left the
      // Re-attach button covered by a gate on a different button.
      'components/staff-domain-card.component.tsx',
    ],
    via: /SuperStaffOnly/,
  },
  'lockdown/route.ts': {
    ui: [
      'app/(app)/admin/lockdown/page.tsx',
      'components/staff-org-actions.component.tsx',
    ],
    via: /useSuperStaffGate|SuperStaffOnly/,
  },
  'org-override/route.ts': {
    ui: ['components/staff-org-actions.component.tsx'],
    via: /StaffRoleOnly/,
  },
  'sign-plugin/route.ts': {
    ui: ['app/(app)/admin/plugin-reviews/[listingId]/page.tsx'],
    via: /SuperStaffOnly/,
  },
  // Staff refunds (AGL-2486). The only entry here whose gate is not "which
  // role are you" but "how much is this": support may refund up to a cap and
  // escalates above it, so a `SuperStaffOnly` wrapper would refuse every
  // support refund including the ones the cap exists to allow. The card reads
  // the role — from the route's own response, falling back to the claim hook
  // — and disables on the AMOUNT, stating the ceiling above the form so the
  // boundary is legible before anything is typed.
  'org-refund/route.ts': {
    ui: ['components/staff-org-refund-card.component.tsx'],
    via: /useStaffRole/,
  },
  'users/manage/route.ts': {
    ui: ['app/(app)/admin/users/page.tsx'],
    via: /useSuperStaffGate/,
  },
  // Both of these gate a REDACTION rather than an action — the response omits
  // reporter identity for `support` — and both already say so in the UI, so
  // there is no button to disable. They are listed so the derivation below
  // stays exhaustive rather than being narrowed to make it pass.
  'abuse-reports/route.ts': {
    ui: ['app/(app)/admin/abuse-reports/page.tsx'],
    via: /staff role/,
  },
  // The marketplace half of the same job (AGL-2310). Like `abuse-reports` it
  // REDACTS rather than refuses — triage is open to every staff role and the
  // reporter's account is not — so the surface it maps to is the sentence
  // that says so, not a disabled control.
  'marketplace-reports/route.ts': {
    ui: ['app/(app)/admin/marketplace-reports/page.tsx'],
    via: /access level/,
  },
  // The platform hourly send ceiling (AGL-2409). Reading it is open to every
  // staff role — during an incident the question "are we at the ceiling" must
  // be answerable by whoever is on — and SETTING it is `super`, the same bar
  // as `flags`, because the value decides whether every merchant's campaigns
  // go out. Like `flags/page.tsx`, the card reads the role off its OWN
  // endpoint's response rather than the claim hook; the route is the authority
  // either way.
  'email-send-rate/route.ts': {
    ui: ['components/staff-email-send-rate-card.component.tsx'],
    via: /isSuper/,
  },
  // The free-workspace ceiling (AGL-2265). Reading it is open to every staff
  // role — support fields "why can't I make another workspace" and must be
  // able to answer it — and SETTING it is `super`, the same bar as `flags`,
  // because a low enough number is indistinguishable from signups being
  // switched off. Like `flags/page.tsx` and the send-rate card, the card
  // reads the role off its OWN endpoint's response rather than the claim
  // hook; the route is the authority either way.
  'free-workspace-cap/route.ts': {
    ui: ['components/staff-free-workspace-cap-card.component.tsx'],
    via: /isSuper/,
  },
  'media-quarantine/route.ts': {
    ui: ['app/(app)/admin/media-quarantine/page.tsx'],
    via: /useStaffRole/,
  },
}

/** Every route.ts under app/api/admin, relative to that directory. */
function adminRoutes(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return adminRoutes(full, `${prefix}${entry}/`)
    return entry === 'route.ts' ? [`${prefix}${entry}`] : []
  })
}

describe('every role-refusing admin route has a role-aware surface', () => {
  const apiRoot = join(CONSOLE_ROOT, 'app/api/admin')

  /**
   * A route REFUSES on the role when it reads `actorRole` and returns a 403
   * off it. Routes that merely report the claim back (users, users/detail)
   * are not enforcement and are correctly not in the map.
   */
  const enforcing = adminRoutes(apiRoot).filter((relative) => {
    const source = readFileSync(join(apiRoot, relative), 'utf8')
    // Two spellings in the tree — a named `actorRole` and the inline
    // `String(decoded['staffRole'] ?? 'support') !== 'super'` in sign-plugin.
    // Keying on the named one alone silently dropped a real gate from the
    // derived set, which is the exact way a coverage guard goes quiet.
    return (
      /decoded\['staffRole'\]/.test(source) && /403/.test(source)
    )
  })

  it('discovers the enforcing routes rather than trusting a list', () => {
    // If this drops to zero the whole suite below passes vacuously, which is
    // the failure mode a derived guard is most prone to.
    expect(enforcing.length).toBeGreaterThanOrEqual(6)
    expect(enforcing).toContain('lockdown/route.ts')
  })

  it('maps every one of them to a surface — a new gate cannot ship unmapped', () => {
    expect(enforcing.filter((r) => !GATED_SURFACES[r])).toEqual([])
  })

  it.each(Object.entries(GATED_SURFACES))(
    '%s — its console surface expresses the gate',
    (route, { ui, via }) => {
      // The map may not outlive the route it describes either.
      expect(enforcing).toContain(route)
      for (const file of ui) {
        expect(readFileSync(join(CONSOLE_ROOT, file), 'utf8')).toMatch(via)
      }
    },
  )

  it('no admin route defaults a missing staffRole to super (AGL-2131)', () => {
    // The security half of this issue, pinned where it cannot regress
    // quietly: one route read `?? 'super'` while the rest read `?? 'support'`.
    const offenders = adminRoutes(apiRoot).filter((relative) =>
      /decoded\['staffRole'\] \?\? 'super'/.test(
        readFileSync(join(apiRoot, relative), 'utf8'),
      ),
    )
    expect(offenders).toEqual([])
  })

  it('no console SOURCE file defaults a missing staffRole to super (AGL-2024)', () => {
    // WIDER THAN THE ROUTE GUARD ABOVE, because the route guard is what let
    // this through. AGL-2131 brought the last two fail-OPEN defaults down to
    // `support` and pinned both — but it pinned them where the gates are, and
    // `app/(app)/admin/users/[uid]/page.tsx` was still rendering
    // `staffRole ?? 'super'` into the chip that TELLS a staff member what a
    // claim-less account can do. Not a gate, so no guard looked at it; the one
    // surface that reports the answer gave the opposite of the real one.
    //
    // Walks the console tree rather than /api/admin so any spelling in any
    // file is caught. Specs are excluded because they must be free to quote
    // the string they forbid — this very file does.
    const offenders: string[] = []
    const walk = (dir: string, prefix = '') => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '.next') continue
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full, `${prefix}${entry}/`)
          continue
        }
        if (!/\.tsx?$/.test(entry) || /\.spec\.tsx?$/.test(entry)) continue
        if (/staffRole['"\]]* \?\? 'super'/.test(readFileSync(full, 'utf8'))) {
          offenders.push(`${prefix}${entry}`)
        }
      }
    }
    for (const top of ['app', 'components', 'hooks', 'utils']) {
      walk(join(CONSOLE_ROOT, top), `${top}/`)
    }
    expect(offenders).toEqual([])
  })

  it('the Firestore rules do not either', () => {
    const rules = readFileSync(
      join(CONSOLE_ROOT, '../../cloud/firebase-firestore.rules'),
      'utf8',
    )
    expect(rules).toContain("request.auth.token.get('staffRole', 'support')")
    expect(rules).not.toContain("request.auth.token.get('staffRole', 'super')")
  })
})
