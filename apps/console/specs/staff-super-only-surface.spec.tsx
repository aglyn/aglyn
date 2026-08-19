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
    ui: ['app/(app)/admin/orgs/[orgId]/host/[hostId]/page.tsx'],
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

  it('the Firestore rules do not either', () => {
    const rules = readFileSync(
      join(CONSOLE_ROOT, '../../cloud/firebase-firestore.rules'),
      'utf8',
    )
    expect(rules).toContain("request.auth.token.get('staffRole', 'support')")
    expect(rules).not.toContain("request.auth.token.get('staffRole', 'super')")
  })
})
