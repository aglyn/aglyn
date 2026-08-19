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

import { AGLYN_BRANDING_PROFILE } from './plan-entitlements'

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

  /**
   * FIELD-level coverage (AGL-2139) — the half the suite above cannot do.
   *
   * Every assertion before this one is about a FILE: does this surface still
   * route through the resolver. None of them can notice a field that the
   * resolver resolves and nothing renders, and that is not hypothetical —
   * `emailLogoUrl` was collected in the branding editor, https-validated,
   * persisted, and resolved, with this guard fully green, while being read at
   * ZERO render sites. An agency admin on the most expensive tier filled it
   * in, the console confirmed the save, and it appeared in no email ever sent.
   *
   * So: every key of `ResolvedBrandingProfile` must be READ somewhere that is
   * not the resolver, the editor, or the persist path. Those three are where a
   * dead field looks alive — they are how it gets collected, stored and
   * resolved — so they are exactly what must not count as a consumer.
   *
   * A miss here means one of two things, and both are bugs: either the field
   * renders nowhere (delete it, or wire it), or its consumer lives in a file
   * not listed below, in which case add the file. Deleting the field from this
   * list is never the fix — that is how the guard stops guarding.
   */
  describe('every resolved branding field has a consumer (AGL-2139)', () => {
    // Files that RENDER the brand. Deliberately excludes plan-entitlements.ts
    // (the resolver + Aglyn default), org-branding-card (the editor) and
    // orgs/settings/route.ts (the persist path).
    const CONSUMERS: string[] = [
      'apps/tenant/app/[host]/[[...slug]]/catch-all-client.tsx',
      'apps/tenant/app/[host]/[[...slug]]/page.tsx',
      'apps/console/components/layouts/main.layout.tsx',
      'apps/console/components/console-branding-effects.component.tsx',
      'apps/console/hooks/use-branding.ts',
      'libs/tenant/data/admin/src/lib/server/console-domains.ts',
      'libs/shared/util/email/src/lib/email-render.ts',
      'libs/shared/util/email/src/lib/send-email.ts',
      'apps/console/app/api/_lib/render-system-email.ts',
    ]

    /**
     * Comments stripped, because a MENTION is not a consumer.
     *
     * The first draft of this guard used a plain substring test and stayed
     * green when the real consumer was renamed away — the doc comment that
     * explains `emailLogoUrl` was enough to satisfy it. A guard that a
     * paragraph of prose can satisfy is the same class of thing as the
     * file-level guard it was written to reinforce, so it is stripped and
     * then matched as an identifier: `.emailLogoUrl`, `emailLogoUrl:` or a
     * destructured binding, never the word inside a sentence.
     */
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

    // The org-context senders are brand consumers too — `fromName` is read
    // nowhere else — so the corpus is the render surfaces plus every sender
    // the suite above already pins.
    const corpus = [...CONSUMERS, ...ORG_EMAIL_SENDERS]
      .map((file) => stripComments(read(file)))
      .join('\n')

    // Read off the resolver's own default so a field added to the interface
    // cannot be silently omitted from this list — the keys ARE the contract.
    const ALL_FIELDS = Object.keys(AGLYN_BRANDING_PROFILE)

    /**
     * The ONE field this rule does not apply to, and why.
     *
     * `customConsoleDomain` is routing state, not a rendered brand value. Its
     * authoritative copy is the `consoleDomains` reservation collection, which
     * is keyed BY domain so an incoming request can resolve host → org in one
     * read; `resolveConsoleDomain` and the console middleware serve from
     * there, and the settings route writes both. The copy on the resolved
     * profile is therefore never rendered by anything, which is correct rather
     * than broken — a per-org profile cannot answer "which org owns this
     * hostname" without a scan.
     *
     * Named explicitly, one entry, so the exemption stays a decision rather
     * than a hole: a second name appearing here should be argued for, not
     * added to make a red go away.
     */
    const NOT_A_RENDERED_FIELD = ['customConsoleDomain']
    const FIELDS = ALL_FIELDS.filter(
      (field) => !NOT_A_RENDERED_FIELD.includes(field),
    )

    it('covers every field the interface declares', () => {
      // Guards the guard: an empty or truncated key list would make every
      // assertion below vacuous.
      expect(ALL_FIELDS.length).toBeGreaterThanOrEqual(8)
      expect(FIELDS).toContain('emailLogoUrl')
      // The exemption stays narrow, and every name in it is really a field —
      // a typo there would silently exempt nothing while looking deliberate.
      expect(NOT_A_RENDERED_FIELD).toHaveLength(1)
      for (const field of NOT_A_RENDERED_FIELD) {
        expect(ALL_FIELDS).toContain(field)
      }
    })

    it.each(FIELDS)('a surface outside the resolver reads: %s', (field) => {
      // Property access, object key, or destructured binding — code, not prose.
      expect(corpus).toMatch(new RegExp(`\\b${field}\\b`))
    })

    it('a comment alone does not satisfy the guard', () => {
      // The guard-on-the-guard: proves `stripComments` is load-bearing, so a
      // future edit that drops it fails here rather than silently restoring
      // the substring test this replaced.
      expect(
        stripComments('/** mentions emailLogoUrl */\nconst x = 1'),
      ).not.toMatch(/\bemailLogoUrl\b/)
      expect(stripComments('// emailLogoUrl\nconst x = 1')).not.toMatch(
        /\bemailLogoUrl\b/,
      )
      expect(stripComments('a.emailLogoUrl')).toMatch(/\bemailLogoUrl\b/)
    })
  })
})
