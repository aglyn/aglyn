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

import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { PLATFORM_BRANDING_PROFILE } from './plan-entitlements'

/**
 * White-Label Phase 2/3 coverage guard.
 *
 * Every branded surface MUST read its brand through the ONE shared
 * `resolveBrandingProfile` (directly, or via the `useBranding` hook that wraps
 * it, or via the pre-resolved `PLATFORM_BRANDING_PROFILE` fallback) — never a new
 * hard-coded "Aglyn". This is the whole safety story: a white-label org can
 * never partly-render as Aglyn because there is a single source (the
 * multi-surface drift that dogged `removeBranding`).
 *
 * This is a static guard, not a render test: it asserts each wired file still
 * routes through the resolver, so ripping the resolver call out of a surface —
 * or adding an org-context email that sends without a branded from-name — trips
 * here rather than silently reverting a surface to Aglyn. It reads the repo
 * source directly (paths relative to this file), so it is independent of the
 * jest project's cwd.
 */
const REPO_ROOT = resolve(__dirname, '../../../../..')

function read(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')
}

/**
 * Source with comments removed, so prose about a field cannot pass for a
 * reader of it.
 *
 * Block comments first, then line comments. A `//` inside a string literal
 * loses its tail, which is imprecise in one direction only: it can HIDE a
 * match, never invent one, so the guard errs strict.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ')
}

describe('white-label branding coverage (Phase 2/3)', () => {
  // Surfaces that render the brand (chrome, site badge, settings, metadata).
  // Each must reference the resolver, the hook that wraps it, or the shared
  // Aglyn default — i.e. it goes through the single source, not a fresh literal.
  const RENDER_SURFACES: Array<{ file: string; mustContain: string[] }> = [
    {
      // Published-site "Made with …" badge reads props.branding, falling back
      // to the shared Aglyn default rather than a hard-coded brand.
      file: 'apps/tenant/app/[host]/[[...slug]]/catch-all-client.tsx',
      mustContain: ['props.branding', 'PLATFORM_BRANDING_PROFILE'],
    },
    {
      // Tenant <title>/OG fallback reads props.branding.productName.
      file: 'apps/tenant/app/[host]/[[...slug]]/page.tsx',
      mustContain: ['props.branding'],
    },
    {
      // The console useBranding hook is the single chrome entry point.
      file: 'apps/console/hooks/use-branding.ts',
      mustContain: ['resolveBrandingProfile', 'checkEntitlement'],
    },
    {
      // App-bar logo/product name via useBranding.
      file: 'apps/console/components/layouts/main.layout.tsx',
      mustContain: ['useBranding'],
    },
    {
      // Favicon + primary-color effects via useBranding.
      file: 'apps/console/components/console-branding-effects.component.tsx',
      mustContain: ['useBranding'],
    },
    {
      // Brand-settings editor, gated on the whiteLabel entitlement.
      file: 'apps/console/components/org-branding-card.component.tsx',
      mustContain: ['resolveBrandingProfile', "checkEntitlement(org, 'whiteLabel')"],
    },
    {
      // Persist path writes brandingProfile, gated on the whiteLabel entitlement.
      file: 'apps/console/app/api/orgs/settings/route.ts',
      mustContain: ['brandingProfile', 'checkEntitlement', "'whiteLabel'"],
    },
  ]

  it.each(RENDER_SURFACES)(
    'brand-rendering surface routes through the resolver: $file',
    ({ file, mustContain }) => {
      const source = read(file)
      for (const token of mustContain) {
        expect(source).toContain(token)
      }
    },
  )

  // Transactional/notification senders that have an org context: each MUST
  // resolve the brand and pass the white-label `fromName` to sendEmail, so a
  // white-label org's mail reads as its brand and never as Aglyn.
  const ORG_EMAIL_SENDERS: string[] = [
    'apps/console/app/api/billing/usage-email/route.ts', // Phase 1 reference
    'apps/console/app/api/orgs/invites/route.ts',
    'apps/console/app/api/orgs/members/route.ts',
    'apps/console/app/api/admin/erasure-request/route.ts',
    'apps/console/app/api/admin/run-erasures/route.ts',
    'libs/plugins/commerce/src/lib/server/billing-webhook.ts',
    'libs/plugins/commerce/src/lib/server/process-abandoned.ts',
    'libs/plugins/commerce/src/lib/server/process-restock.ts',
    'libs/plugins/commerce/src/lib/server/member-post.ts',
    'libs/plugins/commerce/src/lib/server/membership-recover.ts',
    'libs/plugins/commerce/src/lib/server/membership-admin-password.ts',
    'libs/plugins/bookings/src/lib/server.ts',
    'libs/plugins/bookings/src/lib/server/billing-webhook.ts',
    'libs/plugins/marketing/src/lib/server/campaign-send.ts',
  ]

  it.each(ORG_EMAIL_SENDERS)(
    'org-context email sender threads a branded from-name: %s',
    (file) => {
      const source = read(file)
      expect(source).toContain('resolveBrandingProfile')
      expect(source).toContain('fromName')
    },
  )

  /**
   * FIELD-LEVEL coverage (AGL-2139) — the half this guard was missing.
   *
   * Everything above asserts that each wired FILE reaches the resolver. That
   * is satisfiable while a resolved field renders nowhere at all, and that is
   * exactly what happened: `emailLogoUrl` was a first-class field of
   * `OrgBrandingProfile`, resolved by `resolveBrandingProfile`, collected in
   * the branding editor, https-validated and persisted by
   * `/api/orgs/settings` — and read at ZERO render sites. An agency admin on
   * the tier that costs the most filled it in, the form saved, the value
   * round-tripped, and it appeared in no email ever, while every check here
   * stayed green. A green check only proves what it reads.
   *
   * So every key of `ResolvedBrandingProfile` must have a consumer OUTSIDE
   * the three places that would otherwise satisfy it — the resolver that
   * produces it, the editor that collects it, and the route that stores it.
   * A field with only those three is a field nothing renders.
   */
  const BRANDING_PLUMBING = [
    'libs/aglyn/src/lib/app-utils/plan-entitlements.ts',
    'libs/aglyn/src/lib/foundation/definitions/org-billing.types.ts',
    'apps/console/components/org-branding-card.component.tsx',
    'apps/console/app/api/orgs/settings/route.ts',
  ]

  /**
   * Where a consumer may live. `git grep` rather than a walk so `.next/`
   * build output — which inlines the resolver and would satisfy every field
   * at once — cannot count, and so an untracked scratch file cannot either.
   */
  function consumers(field: string): string[] {
    let output = ''
    try {
      output = execFileSync('git', ['grep', '-l', '--', field, '--', 'apps', 'libs'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      })
    } catch {
      return []
    }
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((file) => /\.tsx?$/.test(file))
      .filter((file) => !/\.spec\.tsx?$/.test(file))
      .filter((file) => !BRANDING_PLUMBING.includes(file))
      // A MENTION IS NOT A CONSUMER. Verified by deleting the fix and
      // watching this stay green: `emailLogoUrl` survived in the docblocks
      // explaining what it is for, in the two files that had just stopped
      // reading it. A guard satisfied by the comment describing a field is
      // a guard that certifies its absence.
      .filter((file) =>
        stripComments(read(file)).includes(field),
      )
  }

  /**
   * Resolved fields with NO consumer, and the reason. A reason is mandatory:
   * the point of this sweep is that "we decided" is written down, not that
   * the list is empty.
   *
   * Found BY this guard the moment it stopped counting comments — the second
   * dead field of exactly the shape `emailLogoUrl` was, which is the argument
   * for the guard existing.
   */
  const FIELD_EXEMPT: Record<string, string> = {
    customConsoleDomain:
      'Validated, persisted, resolved and editable — and routed nowhere. ' +
      'Unlike emailLogoUrl this cannot be closed by adding a render site: ' +
      'serving the console from an agency-owned hostname needs the domain ' +
      'provisioned at Vercel, a certificate, and the session cookie scoped ' +
      'to it — the auth cookie is the hard part, because a console on a ' +
      'second origin either cannot read the session or has to be issued one, ' +
      'which is an authentication-boundary decision and not a render gap. ' +
      'Recorded here rather than quietly wired to something that looks like ' +
      'a consumer. media-ref.ts:335 already anticipates it in a comment.',
  }

  const BRANDING_FIELDS = Object.keys(PLATFORM_BRANDING_PROFILE)

  it('enumerates the branding fields at all', () => {
    // A field sweep over an empty set passes vacuously.
    expect(BRANDING_FIELDS.length).toBeGreaterThanOrEqual(8)
    expect(BRANDING_FIELDS).toContain('emailLogoUrl')
  })

  it('can tell a consumed field from an unconsumed one', () => {
    // The instrument, before it is trusted: `productName` is rendered all
    // over; a field that does not exist is rendered nowhere.
    expect(consumers('productName').length).toBeGreaterThan(0)
    expect(consumers('brandFieldThatDoesNotExist')).toEqual([])
  })

  it.each(BRANDING_FIELDS)(
    'resolved branding field %s has a consumer outside the plumbing',
    (field) => {
      if (FIELD_EXEMPT[field]) {
        // An exemption must still be a real gap. A field that gained a
        // consumer while exempt should lose the exemption, not keep it.
        expect(consumers(field)).toEqual([])
        return
      }
      const found = consumers(field)
      expect(`${field}: ${found.length ? 'consumed' : 'NO CONSUMER'}`).toBe(
        `${field}: consumed`,
      )
    },
  )
})
