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
 * AGL-1993 — the staff console 404 for `zach@aglyn.com`.
 *
 * The claim was never missing. Verified against BOTH pools on 2026-08-19:
 * `zach@aglyn.com` lives in GCIP tenant `aglyn-org-y5v14` (provider
 * `saml.aglyn-workspace`) carrying `{"staff":true,"staffRole":"super"}`, and
 * there is no project-pool twin. The break is on the READ side: the silent
 * cross-subdomain restore exchanged the tenant-minted custom token on an auth
 * instance still pointing at the project pool, so the ID token that reached
 * `useIsStaff` was not the tenant token that holds the claim.
 *
 * These cases are about the exchange staying in the token's own pool. The
 * final block asserts the gate itself is UNCHANGED — the fix must not be a
 * loosened `StaffGuard`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'

const mockSignIn = jest.fn(async () => ({ user: { uid: 'u1' } }))
jest.mock('firebase/auth', () => ({
  signInWithCustomToken: (...args: unknown[]) =>
    (mockSignIn as unknown as (...a: unknown[]) => unknown)(...args),
}))

let mockIsStaff: boolean | null = null
jest.mock('../hooks/use-is-staff', () => ({
  useIsStaff: () => mockIsStaff,
}))
const mockNotFound = jest.fn(() => {
  // Next's real `notFound()` throws to unwind the render; model that, or the
  // guard reads as "returned nothing" and a broken gate would pass.
  throw new Error('NEXT_NOT_FOUND')
})
jest.mock('next/navigation', () => ({ notFound: () => mockNotFound() }))

import {
  adoptRestoredPool,
  signInWithPooledCustomToken,
} from '../utils/pooled-custom-token'
import { StaffGuard } from '../components/staff-guard.component'

/**
 * Records the instance's pool AT THE MOMENT of the exchange, not afterwards.
 * Order is the whole point: `signInWithCustomToken` reads `auth.tenantId`
 * when it is called, so setting the pool after the call is the same bug.
 */
const spyingAuth = () => {
  const auth = { tenantId: null as string | null }
  mockSignIn.mockImplementation(async () => {
    poolAtExchange = auth.tenantId
    return { user: { uid: 'u1' } }
  })
  return auth
}
let poolAtExchange: string | null | undefined

beforeEach(() => {
  poolAtExchange = undefined
  mockSignIn.mockReset()
})

const TENANT = 'aglyn-org-y5v14'

describe('a custom token is exchanged in the pool it was minted in', () => {
  it('places the instance in the tenant BEFORE the exchange', async () => {
    const auth = spyingAuth()
    await signInWithPooledCustomToken(auth as never, 'tok', TENANT)
    // The assertion that fails on the original code: it read `null`.
    expect(poolAtExchange).toBe(TENANT)
  })

  it('clears a stale tenant for a project-pool token', async () => {
    // The reverse cross-pool exchange. `tenantId` is sticky instance state —
    // the SSO page sets it and nothing clears it — so a conditional
    // assignment would leave this sign-in aimed at the wrong pool.
    const auth = spyingAuth()
    auth.tenantId = TENANT
    await signInWithPooledCustomToken(auth as never, 'tok', null)
    expect(poolAtExchange).toBeNull()
  })

  it('treats an absent tenantId as the project pool, not as no opinion', async () => {
    const auth = spyingAuth()
    auth.tenantId = TENANT
    await signInWithPooledCustomToken(auth as never, 'tok', undefined)
    expect(poolAtExchange).toBeNull()
  })
})

/**
 * The RESTORE half (AGL-2486). AGL-1993 fixed the pool of an EXCHANGE, and
 * an exchange only happens when this origin has no local user. The commoner
 * path — a second visit, or a second tab — finds the user already in
 * IndexedDB, where `directlySetCurrentUser` sets `currentUser` and leaves
 * `tenantId` at the constructor's `null`. An SSO session restored that way
 * runs on an instance that believes it is on the project pool, and the
 * cross-tab sync path then throws `auth/tenant-id-mismatch` rather than
 * tracking what the rest of the browser profile is doing.
 */
describe('a restored session is put back in its own pool', () => {
  it('adopts the tenant of a user restored from persistence', () => {
    const auth = { tenantId: null as string | null }
    adoptRestoredPool(auth as never, { tenantId: TENANT })
    // The assertion that fails on the original code: it stayed `null`, and
    // every request from that instance went to the project pool.
    expect(auth.tenantId).toBe(TENANT)
  })

  it('clears a stale tenant for a restored project-pool user', () => {
    // The reverse. `tenantId` is sticky instance state, so a conditional
    // assignment would leave a project-pool account pointed at a tenant.
    const auth = { tenantId: TENANT as string | null }
    adoptRestoredPool(auth as never, { tenantId: null })
    expect(auth.tenantId).toBeNull()
  })

  it('treats an absent tenantId as the project pool, not as no opinion', () => {
    const auth = { tenantId: TENANT as string | null }
    adoptRestoredPool(auth as never, {})
    expect(auth.tenantId).toBeNull()
  })

  it('never invents a pool when there is no user to read one from', () => {
    const auth = { tenantId: null as string | null }
    adoptRestoredPool(auth as never, null)
    expect(auth.tenantId).toBeNull()
  })

  it('is wired into the RESTORE branch, and only there', () => {
    const hook = readFileSync(
      join(__dirname, '..', 'hooks', 'use-session-cookie.tsx'),
      'utf8',
    )
    // A correct helper nothing calls is precisely the failure AGL-1993 was
    // made of — the server carried a comment asserting the client set
    // `auth.tenantId`, and the client never did.
    expect(hook).toContain('adoptRestoredPool(auth')
    // Exactly one call site. A second one would be a sign-in path, where
    // adopting the OUTGOING user's pool aims the in-flight sign-in at the
    // wrong one — the same cross-pool bug pointed backwards.
    expect(hook.match(/adoptRestoredPool\(auth/g)).toHaveLength(1)
  })
})

/**
 * The wiring half. A correct helper nothing calls is the failure mode this
 * issue is made of — the server already carried a comment asserting the
 * client set `auth.tenantId`, and the client never did. So walk the console
 * tree and require every exchange to go through the helper.
 */
describe('every console custom-token exchange goes through the helper', () => {
  const ROOT = join(__dirname, '..')
  const SKIP = new Set(['node_modules', '.next', 'dist', 'specs', '.turbo'])
  const HELPER = join(ROOT, 'utils', 'pooled-custom-token.ts')

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full, out)
      else if (/\.tsx?$/.test(full) && !/\.spec\.tsx?$/.test(full)) out.push(full)
    }
    return out
  }

  it('has no bare signInWithCustomToken call outside the helper', () => {
    const offenders = walk(ROOT)
      .filter((file) => file !== HELPER)
      .filter((file) =>
        // A CALL, not a mention: the doc comments legitimately name it.
        /\bsignInWithCustomToken\s*\(/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => file.slice(ROOT.length + 1))
    expect(offenders).toEqual([])
  })

  it('reaches the files this issue was about', () => {
    // Guards that scan nothing pass for free. Prove the walk sees the two
    // call sites that carried the bug.
    const seen = walk(ROOT).map((file) => file.slice(ROOT.length + 1))
    expect(seen).toContain('hooks/use-session-cookie.tsx')
    expect(seen).toContain('components/staff-impersonation-dialog.component.tsx')
  })

  it('passes the pool through at every exchange site', () => {
    // The helper can be called with the tenant dropped — `(auth, token)` is
    // a compile error only because the parameter is required, and a caller
    // could still pass a literal. Require the payload's own tenantId.
    for (const file of [
      'hooks/use-session-cookie.tsx',
      'hooks/use-delegate-workspace-signin.tsx',
      'components/staff-impersonation-dialog.component.tsx',
    ]) {
      const source = readFileSync(join(ROOT, file), 'utf8')
      const calls = source.match(/signInWithPooledCustomToken\([\s\S]*?\)/g) ?? []
      expect(calls.length).toBeGreaterThan(0)
      for (const call of calls) expect(call).toMatch(/payload\.tenantId/)
    }
  })
})

/**
 * The gate is NOT the fix. A staff member reaching the console because the
 * guard stopped guarding would be a worse bug than the 404.
 */
describe('StaffGuard still refuses a non-staff session', () => {
  beforeEach(() => mockNotFound.mockClear())

  it('calls notFound() when the claim is false', () => {
    mockIsStaff = false
    expect(() =>
      render(
        <StaffGuard>
          <div>staff console</div>
        </StaffGuard>,
      ),
    ).toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })

  it('holds without refusing while the claim is still resolving', () => {
    // `null` is not `false`: refusing here would flash a 404 at every staff
    // member on every admin page load.
    mockIsStaff = null
    render(
      <StaffGuard>
        <div>staff console</div>
      </StaffGuard>,
    )
    expect(mockNotFound).not.toHaveBeenCalled()
    expect(screen.queryByText('staff console')).toBeNull()
  })

  it('admits a staff session', async () => {
    mockIsStaff = true
    render(
      <StaffGuard>
        <div>staff console</div>
      </StaffGuard>,
    )
    await waitFor(() => expect(screen.getByText('staff console')).toBeTruthy())
    expect(mockNotFound).not.toHaveBeenCalled()
  })
})
