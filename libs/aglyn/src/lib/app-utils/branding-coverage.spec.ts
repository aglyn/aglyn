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

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * White-Label Phase 2/3 coverage guard.
 *
 * Every branded surface MUST read its brand through the ONE shared
 * `resolveBrandingProfile` (directly, or via the `useBranding` hook that wraps
 * it, or via the pre-resolved `AGLYN_BRANDING_PROFILE` fallback) — never a new
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

describe('white-label branding coverage (Phase 2/3)', () => {
  // Surfaces that render the brand (chrome, site badge, settings, metadata).
  // Each must reference the resolver, the hook that wraps it, or the shared
  // Aglyn default — i.e. it goes through the single source, not a fresh literal.
  const RENDER_SURFACES: Array<{ file: string; mustContain: string[] }> = [
    {
      // Published-site "Made with …" badge reads props.branding, falling back
      // to the shared Aglyn default rather than a hard-coded brand.
      file: 'apps/tenant/app/[host]/[[...slug]]/catch-all-client.tsx',
      mustContain: ['props.branding', 'AGLYN_BRANDING_PROFILE'],
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
})
