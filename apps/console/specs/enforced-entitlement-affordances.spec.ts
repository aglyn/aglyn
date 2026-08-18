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
 * AGL-2081: four entitlements that are ENFORCED and had no console surface
 * at all now have one, and it is reachable.
 *
 * The call-site discipline matters more here than anywhere else in this
 * sweep, because the thing being asserted is the existence of a surface. A
 * spec that checked the entitlement helper would pass against a console that
 * renders nothing — which is precisely the state these four were in. So each
 * check names the file that must render it and the wire it must carry, and
 * the reachability check below walks from the page that mounts it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLAN_ENTITLEMENTS, planGrantingFeature } from '@aglyn/aglyn'
import { TENANT_EMAILS } from '@aglyn/shared-util-email'

const ROOT = join(__dirname, '..')

function source(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8')
}

/** Body only — an import names a symbol without using it. */
function body(file: string): string {
  return source(file)
    .split('\n')
    .filter((line) => !/^\s*import\b/.test(line) && !/^\s*}\s*from\s/.test(line))
    .join('\n')
}

/**
 * flag → the console file that must now render its state.
 *
 * `declaresFlag` is false where the surface resolves the flag from DATA
 * instead of naming it — the emails card reads `email.requiresFeature` off
 * the catalog, so a card that special-cased `'abandonedCart'` would be the
 * WORSE implementation, and asserting the literal there would have pushed
 * toward it. Those rows are pinned by the catalog and generic-resolution
 * tests further down instead.
 */
const AFFORDANCES: Array<{
  feature: string
  file: string
  declaresFlag: boolean
}> = [
  {
    feature: 'videoMedia',
    file: 'components/media/media-library.component.tsx',
    declaresFlag: true,
  },
  {
    feature: 'mediaCdn',
    file: 'components/media/media-library.component.tsx',
    declaresFlag: true,
  },
  {
    feature: 'removeBranding',
    file: 'components/site-branding-badge-card.component.tsx',
    declaresFlag: true,
  },
  {
    feature: 'abandonedCart',
    file: 'components/site-emails-card.component.tsx',
    declaresFlag: false,
  },
]

describe('AGL-2081 · enforced entitlements have a console affordance', () => {
  it('asserts over a real table against real flags', () => {
    const flags = Object.keys(PLAN_ENTITLEMENTS.free.features)
    expect(flags.length).toBeGreaterThanOrEqual(30)
    expect(AFFORDANCES.length).toBe(4)
    for (const { feature } of AFFORDANCES) {
      expect(flags).toContain(feature)
      // Every one of these must be nameable in an upsell.
      expect(planGrantingFeature(feature as never)).toBeDefined()
    }
    for (const { file } of AFFORDANCES) {
      expect(body(file).length).toBeGreaterThan(500)
    }
  })

  it.each(AFFORDANCES.filter((row) => row.declaresFlag))(
    '$file names $feature directly',
    ({ file, feature }) => {
      expect(body(file)).toMatch(new RegExp(`['"]${feature}['"]`))
    },
  )

  it('at least one surface names its flag directly', () => {
    // Keeps the filter above from silently emptying: if every row were
    // flipped to `declaresFlag: false`, the test it feeds would vanish
    // rather than fail, and `it.each([])` is a passing suite.
    expect(AFFORDANCES.filter((row) => row.declaresFlag).length).toBeGreaterThanOrEqual(3)
  })

  it.each(AFFORDANCES)(
    '$file waits for the plan before saying no ($feature)',
    ({ file }) => {
      // `checkEntitlement(undefined)` resolves the FREE tier. Every one of
      // these four states is a claim about what the customer's plan does
      // NOT include, so rendering one before the org settles accuses a
      // paying customer.
      const text = body(file)
      expect(text).toMatch(/orgReady/)
    },
  )

  it('the video gate refuses before the bytes, not after', () => {
    // The whole point of AGL-2081's sharpest case: a free-tier video upload
    // "just failed", server-side, with nothing naming the cause. A gate
    // that only labels the accepted types still sends the file.
    const text = body('components/media/media-library.component.tsx')
    expect(text).toContain('requiresFileUploadEntitlement')
    // And it must sit inside the upload path, after the ready guard.
    const readyAt = text.indexOf('if (!orgReady)')
    const gateAt = text.indexOf('requiresFileUploadEntitlement(contentType)')
    expect(readyAt).toBeGreaterThan(-1)
    expect(gateAt).toBeGreaterThan(readyAt)
  })

  it('the branding card is mounted on a real page, not merely written', () => {
    // A component nobody renders is the same gap with more code in it.
    const page = source('app/(app)/[orgSlug]/hosts/[host]/setup/page.tsx')
    expect(page).toContain('SiteBrandingBadgeCard')
    // Mounted as an element, not just imported.
    expect(body('app/(app)/[orgSlug]/hosts/[host]/setup/page.tsx')).toContain(
      '<SiteBrandingBadgeCard',
    )
  })

  it('the abandoned-cart template declares the flag that gates its send', () => {
    const entry = TENANT_EMAILS.find((email) => email.key === 'abandoned-cart')
    expect(entry).toBeDefined()
    expect(entry?.requiresFeature).toBe('abandonedCart')
  })

  it('every requiresFeature in the email catalog is a real flag', () => {
    // The field is a plain string to keep the email lib off the billing
    // lib's dependency edge, so this is the check that keeps it honest.
    const flags = Object.keys(PLAN_ENTITLEMENTS.free.features)
    const gated = TENANT_EMAILS.filter((email) => email.requiresFeature)
    expect(gated.length).toBeGreaterThanOrEqual(1)
    for (const email of gated) {
      expect(flags).toContain(email.requiresFeature)
    }
  })

  it('the emails card resolves requiresFeature rather than hard-coding a key', () => {
    // A card that special-cased 'abandoned-cart' would leave the next gated
    // template silently unmarked — the same gap, one template later.
    const text = body('components/site-emails-card.component.tsx')
    expect(text).toContain('email.requiresFeature')
    expect(text).toContain('checkEntitlement')
    expect(text).not.toContain(`=== 'abandoned-cart'`)
  })

  it('the branding card routes its upgrade through AppLink', () => {
    const text = source('components/site-branding-badge-card.component.tsx')
    expect(text).toContain('<AppLink')
    expect(text).toContain('/billing')
    expect(text).not.toMatch(/<Button[^>]*\bhref=/)
  })
})
