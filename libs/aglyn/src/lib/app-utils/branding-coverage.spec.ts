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
 *
 * ## Two blind spots this used to have, and the one line that closes them
 *
 * Erring strict is the right direction, but it is not free — it costs a FALSE
 * RED, which is indistinguishable from a real finding until someone spends an
 * hour on it. AGL-2286 paid that hour. Both blind spots are the same shape: a
 * `//` that is not a comment.
 *
 *  - **An escaped-slash regex.** `/^https:\/\//i` ends in `\/` `\/` `/`, whose
 *    last two characters are adjacent slashes — so the rest of that line
 *    vanished. A predicate call sitting beside an https test became invisible.
 *  - **A URL in a string.** `'https://aglyn.com/support'` truncates at the
 *    scheme, which is exactly the kind of line a BRANDING guard is looking at.
 *
 * The fix is to require the character before `//` to be neither a backslash
 * (an escaped slash) nor a colon (a URL scheme). Still not a JS parser, and
 * still strict in the same direction for everything else — but it no longer
 * blinds itself to the two constructs this repo's guards read most.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^\\:])\/\/.*$/gm, '$1 ')
}

/**
 * The instrument, before anything is measured with it.
 *
 * Every check in this file reads `stripComments` output, so a stripper that
 * ate too much would produce findings that are not there — and did, until
 * AGL-2286. These four cases pin both directions: comments really are removed,
 * and the two `//` constructs that are NOT comments really are not.
 */
describe('the comment stripper itself', () => {
  it('removes a line comment', () => {
    expect(stripComments('const a = 1 // productName lives here')).not.toContain(
      'productName',
    )
  })

  it('removes a block comment', () => {
    expect(stripComments('/* productName */ const a = 1')).not.toContain(
      'productName',
    )
  })

  it('KEEPS code after an escaped-slash regex on the same line', () => {
    // `/^https:\/\//i` ends in two adjacent slashes. Treating them as a
    // comment hid the call beside them and produced a false red (AGL-2286).
    const line = String.raw`if (!/^https:\/\//i.test(v) && !isMediaCdnPath(v)) {`
    expect(stripComments(line)).toContain('isMediaCdnPath')
  })

  it('KEEPS code after a URL in a string on the same line', () => {
    // Exactly the line a BRANDING guard reads most.
    const line = `const supportUrl = 'https://aglyn.com/support' // note`
    const stripped = stripComments(line)
    expect(stripped).toContain('supportUrl')
    expect(stripped).toContain('aglyn.com/support')
    expect(stripped).not.toContain('note')
  })
})

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
      // Favicon, primary-color AND TAB TITLE effects via useBranding.
      //
      // The title was the surface this list did not know about (AGL-2270).
      // `page-title.ts` builds the tab from `PLATFORM_BRAND_NAME` — the
      // DEPLOYMENT brand — which AGL-2170 correctly made an env var for
      // self-hosters and which can never carry a PER-ORG brand. So every tab
      // in a white-label org's console read "· Aglyn" while the favicon two
      // lines above here had already been replaced, and this guard was green
      // throughout: a file-level check is satisfied by any one surface.
      //
      // `document.title` is named rather than just `useBranding` because that
      // is the wire. The component reached `useBranding` for the favicon alone
      // and would go on doing so with the title effect deleted.
      file: 'apps/console/components/console-branding-effects.component.tsx',
      mustContain: ['useBranding', 'document.title', 'MutationObserver'],
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
   * ACCOUNT-SCOPED senders (AGL-2326) — the class this guard could not see.
   *
   * Every entry in `ORG_EMAIL_SENDERS` has an org in hand, so "resolve the
   * brand" is a mechanical instruction. These four do not: a password reset,
   * an email verification, a new-device alert and an admin-initiated reset
   * notice all belong to a PERSON, and a person can be a member of several
   * organizations. They were absent from every list above, which is why the
   * guard was green on all four while none of them resolved any brand at all.
   *
   * ## Why they are not simply added to `ORG_EMAIL_SENDERS`
   *
   * Because the answer is not known yet, and the wrong answer is worse than
   * the current one. Guessing an org for a recipient who belongs to two means
   * **mailing Agency A's brand to somebody who is also Agency B's user** —
   * one customer's identity delivered into another customer's user's inbox.
   * `render-system-email.ts` states the sharper half for the reset path
   * specifically: it *"deliberately refuses to look one up because that would
   * be an enumeration oracle"*. AGL-2352 records that decision as correct and
   * asks that nobody "fix" it into one.
   *
   * So the decision AGL-2326 needs — the org an action originated in, the
   * user's sole org when they have exactly one, or the platform brand when
   * ambiguous — is a product decision, and it has to be made before the
   * wiring rather than during it.
   *
   * ## What this block DOES assert, and why it is worth having anyway
   *
   * Invisibility was half the defect. These files are now named, so:
   *
   *  1. the brand still arrives from CONFIGURATION — `PLATFORM_BRAND_NAME`
   *     (which is what makes self-host rename cleanly) or a designed template
   *     through `renderSystemEmail` — and never from fresh hand-written copy;
   *  2. the exemption stays a REAL gap. A file that starts resolving an org
   *     brand must MOVE to `ORG_EMAIL_SENDERS` and be held to the from-name
   *     rule, not sit here half-wired. Same discipline `FIELD_EXEMPT` applies
   *     below: an exemption that has been closed should be deleted, not kept.
   *
   * The literal half of AGL-2326 is already closed — AGL-2319 replaced the
   * hardcoded `'Aglyn'` in all four, and `check:brand-literals` holds that.
   * What is left is the org resolution, and that is what (2) watches for.
   */
  const ACCOUNT_SCOPED_SENDERS: string[] = [
    'apps/console/app/api/auth/send-password-reset/route.ts',
    'apps/console/app/api/auth/send-verification/route.ts',
    'apps/console/app/api/_lib/security-alerts.ts',
    'apps/console/app/api/_lib/password-admin.ts',
  ]

  it.each(ACCOUNT_SCOPED_SENDERS)(
    'account-scoped sender brands from configuration, not a literal: %s',
    (file) => {
      const source = stripComments(read(file))
      expect(
        source.includes('PLATFORM_BRAND_NAME') ||
          source.includes('renderSystemEmail'),
      ).toBe(true)
    },
  )

  it.each(ACCOUNT_SCOPED_SENDERS)(
    'account-scoped exemption is still a real gap: %s',
    (file) => {
      // If this goes red, AGL-2326 was decided and wired — which is the win.
      // Move the row up into ORG_EMAIL_SENDERS so the from-name rule applies
      // to it, rather than deleting this assertion.
      expect(stripComments(read(file))).not.toContain('resolveBrandingProfile')
    },
  )

  /**
   * The list is CLOSED, so a new sender cannot be invisible the way these
   * four were.
   *
   * Enumerated from `git ls-files` rather than a walk, for the reason the
   * consumer sweep below gives: build output and untracked scratch files must
   * not be able to satisfy — or escape — a guard.
   */
  it('every auth send-* route is classified as org- or account-scoped', () => {
    const tracked = execFileSync(
      'git',
      ['ls-files', '--', 'apps/console/app/api/auth'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /\/send-[^/]+\/route\.ts$/.test(line))

    // Guard the premise: an enumeration that found nothing would classify
    // nothing and pass.
    expect(tracked.length).toBeGreaterThanOrEqual(2)

    const classified = new Set([...ORG_EMAIL_SENDERS, ...ACCOUNT_SCOPED_SENDERS])
    expect(tracked.filter((file) => !classified.has(file))).toEqual([])
  })

  /**
   * PRE-AUTH surfaces (AGL-2322) — the other class this guard could not see.
   *
   * `white-label.md` sells "the console your team signs in to". These render
   * BEFORE the org is known, so none of them can reach `useBranding` — which
   * deliberately returns the platform profile off org-scoped routes, because
   * `useUrlNamesOrg` has no org to name. They were simply ABSENT from every
   * list above, and absence reads as coverage: the guard was green on all
   * seven auth screens, the boot splash, the PWA manifest and the OS
   * credential prompt.
   *
   * ## The blocker, named rather than estimated
   *
   * Branding these needs the org resolved from the REQUEST HOST, i.e.
   * `brandingProfile.customConsoleDomain` actually routing. `FIELD_EXEMPT`
   * below already records why that is not a render gap: serving the console
   * from an agency hostname needs the domain provisioned, a certificate, and
   * **the session cookie scoped to it — the auth cookie is the hard part**,
   * because a console on a second origin either cannot read the session or
   * has to be ISSUED one. That is an authentication-boundary decision
   * (AGL-1099d) gating console-domain routing (AGL-1099c), and it is owed
   * before any of this is buildable. Everything here unblocks together the
   * moment a host→org branding lookup exists.
   *
   * ## What this block DOES assert
   *
   *  1. the brand still arrives from CONFIGURATION — `PLATFORM_BRAND_NAME`,
   *     which is what makes a SELF-HOST rename cleanly — and never from fresh
   *     hand-written copy. That half is genuinely fixed and must not regress;
   *     it is also the half a reader most easily mistakes for the whole.
   *  2. the exemption stays a REAL gap. A file that starts resolving a
   *     per-org brand must MOVE into `RENDER_SURFACES`, not sit here
   *     half-wired — the same discipline `ACCOUNT_SCOPED_SENDERS` applies.
   */
  const PRE_AUTH_SURFACES: string[] = [
    'apps/console/app/(auth)/signin/page.tsx',
    'apps/console/app/(auth)/signup/page.tsx',
    'apps/console/app/(auth)/verify-email/page.tsx',
    'apps/console/app/(auth)/reset-password/page.tsx',
    'apps/console/app/(auth)/account-recovery/page.tsx',
    'apps/console/app/(auth)/sso/page.tsx',
    'apps/console/app/(auth)/signout/page.tsx',
    // The installed home-screen / desktop app name for a white-label org's
    // staff. `ConsoleBrandingEffects` patches the tab title and favicon at
    // runtime (AGL-2270) and CANNOT patch a manifest.
    'apps/console/app/manifest.ts',
    // `RP_NAME` — the OS credential prompt ("Save a passkey for …?").
    'apps/console/app/api/_lib/passkeys.ts',
    // The maintenance screen, which by construction shows to non-staff only,
    // i.e. exactly this population.
    'apps/console/components/platform-lockdown-gate.component.tsx',
  ]

  it.each(PRE_AUTH_SURFACES)(
    'pre-auth surface names the brand only from configuration: %s',
    (file) => {
      // A DISJUNCTION, not a required token. Four of these seven screens —
      // reset-password, account-recovery, sso, signout — never name the
      // product at all, and requiring `PLATFORM_BRAND_NAME` of them would be
      // demanding a brand mention where none belongs. (The first draft of
      // this block did exactly that and went red on all four; the failure was
      // the assertion's, not the code's.) The real rule is that the brand,
      // WHERE named, arrives from configuration — so a self-host rename
      // reaches it — and never from a fresh literal.
      const source = stripComments(read(file))
      expect(source).not.toContain('Aglyn')
    },
  )

  it.each(PRE_AUTH_SURFACES)(
    'pre-auth exemption is still a real gap: %s',
    (file) => {
      // If this goes red, the AGL-1099d auth-boundary decision was made and
      // wired — which is the win. Move the row into `RENDER_SURFACES` so the
      // resolver rule applies to it, rather than deleting this assertion.
      const source = stripComments(read(file))
      expect(source).not.toContain('useBranding')
      expect(source).not.toContain('resolveBrandingProfile')
    },
  )

  /**
   * The list is CLOSED, so a new auth screen cannot be invisible the way
   * these seven were. Same `git ls-files` enumeration as the sender check,
   * for the same reason: untracked scratch files must neither satisfy nor
   * escape a guard.
   */
  it('every (auth) screen is classified as a pre-auth surface', () => {
    const tracked = execFileSync(
      'git',
      ['ls-files', '--', 'apps/console/app/(auth)'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /\/page\.tsx$/.test(line))

    // Guard the premise: an enumeration that found nothing classifies nothing
    // and passes. Seven screens exist today.
    expect(tracked.length).toBeGreaterThanOrEqual(7)

    const classified = new Set(PRE_AUTH_SURFACES)
    expect(tracked.filter((file) => !classified.has(file))).toEqual([])
  })

  /**
   * The WORDMARK, which carries the brand with no string at all (AGL-2350
   * §3).
   *
   * `auth-form.component.tsx` renders `<AglynLogoFull>` on all seven screens
   * above. No detector that greps source can see it: `check:brand-literals`
   * reads string tokens, and this brand is a set of SVG paths. An agency
   * routing its clients to `app.acme.com` lands them on the agency's own
   * domain showing OUR logo before they type a password — and every
   * string-based gate in the repo is green on it.
   *
   * Pinned by call site rather than by content, so the day the auth form
   * learns a per-org logo this fails and the row moves up with the rest.
   */
  it('the shared auth form still renders the platform wordmark', () => {
    const source = stripComments(read('apps/console/components/auth-form.component.tsx'))
    expect(source).toContain('AglynLogoFull')
    expect(source).not.toContain('useBranding')
  })

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
