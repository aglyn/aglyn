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

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  PLATFORM_BRANDING_PROFILE,
  resolveBrandingProfile,
} from '@aglyn/aglyn'

import { brandSupportLine } from '../app/api/_lib/brand-support-line'

const REPO_ROOT = resolve(__dirname, '../../..')

/**
 * A white-label organization's customer is never routed to Aglyn (AGL-2428).
 *
 * The old behaviour was not a bug in the ordinary sense — every branding
 * field bottomed out at the same `?? PLATFORM_BRANDING_PROFILE.x`, and the
 * docs described the result faithfully. The decision is that the described
 * behaviour was wrong: an organization that white-labels, sets a product
 * name and leaves Support URL blank sent transactional mail reading *Acme*
 * throughout with a "Need help?" pointing at **our** desk. Our desk cannot
 * help that recipient with anything, and the link identifies Acme's vendor
 * to a person who was never told one exists.
 *
 * Blank therefore means NO LINK, matching what `emailLogoUrl` already does
 * one field over.
 */
describe('a white-label org with no Support URL links nowhere', () => {
  const whiteLabel = (profile: Record<string, unknown>) =>
    resolveBrandingProfile({
      plan: 'agency',
      brandingProfile: profile,
    } as never)

  it('emits NO support line for an org that left the field blank', () => {
    for (const profile of [
      { productName: 'Acme Sites' },
      { productName: 'Acme Sites', supportUrl: '' },
      { productName: 'Acme Sites', supportUrl: '  ' },
    ]) {
      expect(brandSupportLine(whiteLabel(profile))).toBe('')
    }
  })

  it('and no dangling separator either — the line carries its own blank lines', () => {
    // A caller that concatenated the newlines itself would leave two empty
    // lines at the end of the message for exactly the orgs this exists for:
    // the gap-that-reads-as-broken the email logo already avoids.
    const body = `Usage summary${brandSupportLine(whiteLabel({}))}`
    expect(body).toBe('Usage summary')
    expect(body.endsWith('\n')).toBe(false)
  })

  it('THE CONTROL: an org that SET one still gets its own', () => {
    // Without this, everything above is satisfied by a build that emits no
    // support line for anybody — which would be a different defect, not a fix.
    expect(brandSupportLine(whiteLabel({ supportUrl: 'https://acme.test/help' })))
      .toBe('\n\nNeed help? https://acme.test/help')
  })

  it('THE SECOND CONTROL: a NON-white-label org still gets Aglyn’s desk', () => {
    // The platform default is not being deleted. An org without the
    // concealment entitlement is an Aglyn customer whose support desk really
    // is ours, and its mail must keep saying so.
    const line = brandSupportLine(resolveBrandingProfile({ plan: 'pro' } as never))
    expect(line).toContain(PLATFORM_BRANDING_PROFILE.supportUrl!)
    expect(line.startsWith('\n\nNeed help? ')).toBe(true)
  })

  it('the live email path uses the helper rather than interpolating the field', () => {
    // The usage email is the shipped surface the issue names
    // (`usage-email/route.ts` rendered `Need help? ${branding.supportUrl}`).
    // A future edit that went back to interpolating the field directly would
    // reinstate the leak while every assertion above stayed green, because
    // they test the helper and not the caller.
    const route = readFileSync(
      join(REPO_ROOT, 'apps/console/app/api/billing/usage-email/route.ts'),
      'utf8',
    )
    expect(route).toContain('brandSupportLine(branding)')
    expect(route).not.toMatch(/Need help\?\s*\$\{/)
  })

  it('the docs no longer promise Aglyn’s support page as the fallback', () => {
    // The standing rule is to change the product to match the advertising.
    // Here the advertising described the defect exactly, so both had to move
    // together — and a doc left behind would put them out of step in the
    // direction the rule forbids.
    const doc = readFileSync(
      join(REPO_ROOT, 'apps/docs/docs/workspace-and-billing/white-label.md'),
      'utf8',
    )
    expect(doc).not.toContain("Your **Support URL**, or Aglyn's support page")
    expect(doc).toContain('| `{{brand.supportUrl}}` | Your **Support URL**, or **empty** |')
  })
})
