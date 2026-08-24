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

import {
  APEX_LABELS,
  WORKSPACE_DOMAIN,
  isServableWorkspaceHost,
  originPersistenceClass,
  workspaceSlugFromHost,
} from './workspace-domain'

describe('workspace domain', () => {
  it('defaults to aglyn.com when the env var is unset', () => {
    // The whole defect: this constant existed eight times, and the ONE copy
    // without this default was the host gate. If this assertion ever fails
    // because someone removed the fallback, the gate silently switches off in
    // production again.
    expect(WORKSPACE_DOMAIN).toBe('aglyn.com')
  })

  describe('workspaceSlugFromHost', () => {
    it('names the slug on a workspace subdomain', () => {
      expect(workspaceSlugFromHost('zgover.aglyn.com')).toBe('zgover')
      expect(workspaceSlugFromHost('aglyn-org.aglyn.com')).toBe('aglyn-org')
    })

    it('names a slug for a subdomain that is not a registered workspace', () => {
      // Shape, not existence — this function must NOT be the thing that
      // decides a slug is real, or the gate becomes a regex instead of a
      // lookup.
      expect(workspaceSlugFromHost('billing-security-update.aglyn.com')).toBe(
        'billing-security-update',
      )
    })

    it('names no slug for the apex or a reserved label', () => {
      expect(workspaceSlugFromHost('aglyn.com')).toBeNull()
      for (const label of APEX_LABELS) {
        expect(workspaceSlugFromHost(`${label}.aglyn.com`)).toBeNull()
      }
    })

    it('keeps auth.aglyn.com reserved — the OAuth handshake lives there', () => {
      // AGL-462: redirecting this breaks Google sign-in outright.
      expect(workspaceSlugFromHost('auth.aglyn.com')).toBeNull()
    })

    it('names no slug off the workspace domain', () => {
      expect(workspaceSlugFromHost('localhost')).toBeNull()
      expect(workspaceSlugFromHost('aglyn-console.vercel.app')).toBeNull()
      expect(workspaceSlugFromHost('example.com')).toBeNull()
      // A lookalike suffix must not be mistaken for the real domain.
      expect(workspaceSlugFromHost('evil-aglyn.com')).toBeNull()
      expect(workspaceSlugFromHost('aglyn.com.evil.test')).toBeNull()
    })

    it('ignores a port and is case-insensitive', () => {
      expect(workspaceSlugFromHost('ZGover.Aglyn.Com:3000')).toBe('zgover')
    })

    it('names no slug for a deeper nesting', () => {
      expect(workspaceSlugFromHost('a.b.aglyn.com')).toBeNull()
    })

    it('tolerates a missing host header', () => {
      expect(workspaceSlugFromHost(null)).toBeNull()
      expect(workspaceSlugFromHost('')).toBeNull()
    })
  })

  describe('isServableWorkspaceHost', () => {
    const known = (slug: string) => ['zgover', 'aglyn-org'].includes(slug)

    it('serves registered workspaces, the apex and reserved labels', () => {
      expect(isServableWorkspaceHost('zgover.aglyn.com', known)).toBe(true)
      expect(isServableWorkspaceHost('aglyn.com', known)).toBe(true)
      expect(isServableWorkspaceHost('app.aglyn.com', known)).toBe(true)
    })

    it('refuses an unregistered workspace subdomain', () => {
      expect(
        isServableWorkspaceHost('billing-security-update.aglyn.com', known),
      ).toBe(false)
      expect(isServableWorkspaceHost('test-org.aglyn.com', known)).toBe(false)
    })

    it('leaves hosts off the workspace domain alone', () => {
      // Negative control: a gate that returned false for everything would
      // pass the test above and take localhost and previews down with it.
      expect(isServableWorkspaceHost('localhost:4200', known)).toBe(true)
      expect(isServableWorkspaceHost('aglyn-console.vercel.app', known)).toBe(
        true,
      )
    })
  })

  /**
   * AGL-1099c. `FirebaseServicesProvider`'s `authPersistence` prop, the
   * `setPersistence` seal (AGL-1379) and the memory Firestore cache
   * (AGL-1456) were all built and all defaulted to `durable`, because nobody
   * ever passed the prop. This function is the declaration they were waiting
   * for, so the assertions that matter are about its POLARITY: everything not
   * recognised must come back `ephemeral`.
   */
  describe('originPersistenceClass', () => {
    it('keeps the workspace domain durable — a 14-day session is the product', () => {
      expect(originPersistenceClass('app.aglyn.com')).toBe('durable')
      expect(originPersistenceClass('auth.aglyn.com')).toBe('durable')
      expect(originPersistenceClass('aglyn.com')).toBe('durable')
      expect(originPersistenceClass('zgover.aglyn.com')).toBe('durable')
    })

    it('keeps localhost and previews durable — we own that DNS too', () => {
      expect(originPersistenceClass('localhost:4200')).toBe('durable')
      expect(originPersistenceClass('127.0.0.1:4200')).toBe('durable')
      expect(originPersistenceClass('aglyn-console-aglyn.vercel.app')).toBe(
        'durable',
      )
    })

    it('makes a custom console domain ephemeral — the whole point', () => {
      // The origin AGL-1099 exists to serve. A refresh token in this
      // origin's IndexedDB outlives every revocation lever we hold, because
      // `securetoken.googleapis.com` is not App Check enforced.
      expect(originPersistenceClass('console.acme-agency.com')).toBe(
        'ephemeral',
      )
      expect(originPersistenceClass('app.youragency.com')).toBe('ephemeral')
    })

    it('answers ephemeral for a host it does not recognise, including none', () => {
      // The polarity IS the design. A host wrongly called `ephemeral` costs a
      // re-authentication; a host wrongly called `durable` writes a refresh
      // token somewhere it can be stolen. So the default is `ephemeral` and
      // `durable` is the allowlist — never the inverse.
      expect(originPersistenceClass(null)).toBe('ephemeral')
      expect(originPersistenceClass(undefined)).toBe('ephemeral')
      expect(originPersistenceClass('')).toBe('ephemeral')
      expect(originPersistenceClass('evil.example')).toBe('ephemeral')
    })

    it('is not fooled by a hostname that merely CONTAINS ours', () => {
      // A suffix test written as `includes` — or without the leading dot —
      // hands `durable` to any attacker who can register the name. Both of
      // these are attacker-registrable and neither is ours.
      expect(originPersistenceClass('aglyn.com.evil.example')).toBe('ephemeral')
      expect(originPersistenceClass('notaglyn.com')).toBe('ephemeral')
      expect(originPersistenceClass('evil-vercel.app')).toBe('ephemeral')
    })

    it('ignores port and case, like every other gate in this module', () => {
      // A host normalized differently here than in the code that grants a
      // session is the bug this module was created to close.
      expect(originPersistenceClass('APP.AGLYN.COM:443')).toBe('durable')
      expect(originPersistenceClass('Console.Acme-Agency.com')).toBe(
        'ephemeral',
      )
    })
  })
})
