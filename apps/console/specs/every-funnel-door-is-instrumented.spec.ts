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
 * AGL-2587 — every sign-in door reports a `login` naming its method, and every
 * org-creation door reports an `org_created` that survives what happens next.
 *
 * ## What was actually broken, and what only looked broken
 *
 * The property's whole history, read through the Data API, separates the two:
 * `login` had arrived 281 times and `sign_up` 7, while `org_created` had
 * arrived ZERO times against nine workspaces that exist in Firestore. The
 * sign-in doors were instrumented; the activation event was emitted and then
 * thrown away.
 *
 * Thrown away by the AGL-1580 mechanism, which this repo had already measured
 * once: the console's transport is Firebase `logEvent`, which awaits the SDK's
 * initialization promise before it reaches gtag, and both org doors navigate
 * the document immediately afterwards — the signup door by design ("a hard
 * navigation on purpose"), the org dialog once workspace subdomains are live.
 * On a fresh signup session that promise is still pending, so the continuation
 * was scheduled behind the teardown and never ran. `sign_up`, fired from the
 * same page seconds earlier with no navigation behind it, arrived every time.
 * Same page, same transport, opposite outcomes — which is what makes the
 * navigation the cause rather than the consent gate or the tag.
 *
 * ## Why source assertions
 *
 * The same reason as `begin-checkout-survives-navigation.spec.ts`, whose shape
 * this follows. The delivery contract is properly exercised with fakes in
 * `libs/aglyn/src/lib/app-utils/analytics-events.spec.ts`. What no behavioural
 * test can see is whether the call sites still CALL it: these emits sit inside
 * long async handlers behind an authenticated session, a network round trip
 * and a document navigation, and nothing downstream observes a fire-and-forget
 * event. Deleting any one of them produced zero reds before this file.
 *
 * The stronger claim this file makes is about the doors that do NOT appear
 * below. A new sign-in door, or a fourth way to make an org, is exactly how
 * this gap opened; the completeness assertions at the bottom fail when one
 * appears, so adding a door forces a decision about counting it rather than
 * letting the metric quietly lose a fraction nobody can name.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const REPO_ROOT = join(__dirname, '..', '..', '..')

/** Comments discuss all of this at length; only CODE is asserted on. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function read(file: string): string {
  return stripComments(readFileSync(join(REPO_ROOT, file), 'utf8'))
}

/* ========================================================================= *
 * SIGN-IN DOORS
 * ========================================================================= */

/**
 * Every door a person can walk through and end up signed in, and the `method`
 * each reports. A door reports a LITERAL, never `user.providerId`: the
 * Identity Toolkit password response carries no provider, so the commonest
 * door reported `method: null` for months (AGL-1561).
 */
const SIGN_IN_DOORS = [
  {
    file: 'apps/console/app/(auth)/signin/page.tsx',
    what: 'the email/password and desktop Google doors',
    // One emit, one ternary: the two desktop doors resolve through the same
    // `.then`, and `values` is what tells them apart.
    methods: ['password', 'google_popup', 'passkey'],
    emits: 2,
  },
  {
    file: 'apps/console/hooks/use-google-redirect-result.tsx',
    what: 'the mobile Google redirect door',
    methods: ['google_redirect'],
    emits: 1,
  },
  {
    file: 'apps/console/app/(auth)/sso/page.tsx',
    what: 'the SSO door (both the discovery and the callback halves)',
    methods: ['sso'],
    emits: 2,
  },
] as const

/**
 * Sign-in machinery that must stay SILENT, and why. Counting any of these
 * would make `login` mean something other than "a person signed in", and a
 * metric that quietly includes a robot or a re-prompt is worse than one that
 * is missing, because it reads as healthy.
 */
const DELIBERATE_NON_DOORS = [
  {
    file: 'apps/console/app/auth/handoff/page.tsx',
    why: 'the second half of ONE sign-in — the person already signed in on the auth host, which counted it; counting here would double every workspace-subdomain login',
  },
  {
    file: 'apps/console/components/session-reauth-dialog.component.tsx',
    why: 'a re-prompt inside a session that is already signed in, not a new sign-in',
  },
  {
    file: 'apps/console/components/staff-impersonation-dialog.component.tsx',
    why: 'staff acting as a customer — a support action, and counting it would put our own operations into the customer funnel',
  },
] as const

describe('every sign-in door reports a login (AGL-2587)', () => {
  describe.each(SIGN_IN_DOORS)('$what', ({ file, methods, emits }) => {
    it('still emits login, exactly as many times as it should', () => {
      // Counted, not merely present: losing ONE branch of a two-door file is
      // the failure this is here for, and a bare presence check would stay
      // green through it.
      const found = read(file).match(/trackEvent\(\s*'login'/g) ?? []
      expect(found).toHaveLength(emits)
    })

    it('names the method on every emit, so a per-door drought is visible', () => {
      const source = read(file)
      // A `login` without `method` is the shape that produced 258 events of
      // `(not set)` in the property — present, and useless for telling which
      // door stopped working.
      for (const emit of source.match(/trackEvent\(\s*'login',[^)]*\)/g) ?? []) {
        expect(emit).toMatch(/method:/)
      }
      for (const method of methods) {
        expect(source).toMatch(new RegExp(`'${method}'`))
      }
    })

    it('reports a literal method, never the credential provider', () => {
      // AGL-1561: `credential.providerId` is empty on the password response,
      // which is precisely the door that matters most.
      const source = read(file)
      const emits = source.match(/trackEvent\(\s*'login',[\s\S]{0,200}?\)/g) ?? []
      for (const emit of emits) expect(emit).not.toMatch(/providerId/)
    })
  })

  describe.each(DELIBERATE_NON_DOORS)('$file stays silent', ({ file, why }) => {
    it(`emits no login — ${why}`, () => {
      // Asserted as an ABSENCE with its reason attached. Someone will
      // eventually read one of these files, notice it signs a person in, and
      // "fix" the missing event; this is the note that reaches them.
      expect(read(file)).not.toMatch(/trackEvent\w*\(\s*'login'/)
    })
  })

  it('no sign-in door has appeared that this file does not know about', () => {
    // The completeness half. A new door is how the gap opened in the first
    // place, and a list that is never checked against the tree is a list that
    // silently goes stale.
    const known = new Set<string>([
      ...SIGN_IN_DOORS.map((d) => d.file),
      ...DELIBERATE_NON_DOORS.map((d) => d.file),
      // Not doors: the shared helpers the doors above are built out of, the
      // server routes that mint credentials for them, and the middleware.
      'apps/console/middleware.ts',
      'apps/console/utils/pooled-custom-token.ts',
      'apps/console/utils/auth-delegation.ts',
      'apps/console/utils/interactive-signin.ts',
      'apps/console/utils/signin-bounce.ts',
      'apps/console/utils/legal-consent.ts',
      'apps/console/utils/is-mobile-browser.ts',
      'apps/console/utils/popup-loading-guard.ts',
      'apps/console/utils/passkeys.ts',
      'apps/console/hooks/use-presence.ts',
      'apps/console/hooks/use-session-cookie.tsx',
      'apps/console/hooks/use-delegate-workspace-signin.tsx',
      'apps/console/components/account/account-security-card.component.tsx',
      'apps/console/app/(app)/admin/users/page.tsx',
      'apps/console/app/(auth)/signup/page.tsx',
    ])
    const found: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(REPO_ROOT, dir))) {
        if (entry === 'node_modules' || entry === 'specs') continue
        const rel = `${dir}/${entry}`
        if (statSync(join(REPO_ROOT, rel)).isDirectory()) {
          walk(rel)
          continue
        }
        if (!/\.tsx?$/.test(entry)) continue
        // A test that drives a door is not itself a door.
        if (/\.(spec|test)\.tsx?$/.test(entry)) continue
        // Client-side sign-in only. An `app/api/**` route verifies or mints;
        // it does not put a browser into a signed-in state, and it has no
        // consent state or gtag to report through if it wanted to.
        if (rel.includes('/app/api/')) continue
        if (/\bsignInWith[A-Z]/.test(readFileSync(join(REPO_ROOT, rel), 'utf8'))) {
          found.push(rel)
        }
      }
    }
    for (const dir of [
      'apps/console/app',
      'apps/console/components',
      'apps/console/hooks',
      'apps/console/utils',
    ]) {
      walk(dir)
    }
    expect(found.filter((f) => !known.has(f))).toEqual([])
  })
})

/* ========================================================================= *
 * ORG-CREATION DOORS — the event that had never once arrived.
 * ========================================================================= */

/**
 * Every way a workspace comes into existence, and what has to happen after
 * the emit on each.
 *
 * `navigates` is the whole point. Where the document is torn down next, the
 * emit MUST be awaited through `trackEventBeforeNavigation`, or the hit dies
 * in a pending initialization promise exactly as it did for nine workspaces.
 */
const ORG_DOORS = [
  {
    file: 'apps/console/app/(auth)/signup/page.tsx',
    what: 'the workspace auto-provisioned at signup',
    navigates: true,
  },
  {
    file: 'apps/console/components/create-org-dialog.component.tsx',
    what: 'the create-an-organization dialog',
    navigates: true,
  },
  {
    file: 'apps/console/components/create-host-dialog.component.tsx',
    what: 'the workspace the server provisions on the way to a first site',
    navigates: false,
  },
] as const

describe('every org-creation door reports an org_created (AGL-2587)', () => {
  describe.each(ORG_DOORS)('$what', ({ file, navigates }) => {
    it('emits org_created exactly once', () => {
      const found = read(file).match(/trackEvent\w*\(\s*'org_created'/g) ?? []
      expect(found).toHaveLength(1)
    })

    it('emits through the delivery helper its navigation demands', () => {
      const source = read(file)
      if (!navigates) {
        // The dialog renders the result in place; the navigation-safe helper
        // would be borrowed machinery. Asserted as an absence so a future
        // hard navigation cannot appear here and stay green.
        expect(source).toMatch(/(?<!e)trackEvent\(\s*'org_created'/)
        return
      }
      expect(source).toMatch(/trackEventBeforeNavigation\(\s*'org_created'/)
      // Awaited, not merely called. An un-awaited call to the navigation-safe
      // helper is the fire-and-forget bug wearing the fix's name.
      expect(source).toMatch(/await\s+trackEventBeforeNavigation\(\s*'org_created'/)
    })
  })

  it('the server door hands the fact back so a browser can report it', () => {
    // `ensureOrgForUser` creates workspaces on the server, where there is no
    // gtag and no consent state to consult, so the event cannot be sent from
    // there — the fact travels in the response and the client emits it
    // through the same consent-gated transport as everything else.
    expect(read('apps/console/app/api/hosts/create/route.ts')).toMatch(
      /orgCreated:\s*orgMembership\.created === true/,
    )
    expect(
      read('libs/tenant/data/admin/src/lib/server/organizations.ts'),
    ).toMatch(/created:\s*true/)
    // And the client only counts a workspace the server says it made — a site
    // created in an existing workspace must count nothing.
    expect(
      read('apps/console/components/create-host-dialog.component.tsx'),
    ).toMatch(/payload\.orgCreated === true/)
  })

  it('org_created is never sent before consent, like every other event', () => {
    // The constraint this issue was written under: emit the events that are
    // already meant to exist, never widen what is collected. Every door goes
    // through the taxonomy module, whose transport is absent entirely until
    // consent loads gtag — so no door may reach `window.gtag` on its own.
    for (const { file } of ORG_DOORS) {
      expect(read(file)).toMatch(
        /from '@aglyn\/aglyn\/app-utils\/analytics-events'/,
      )
      expect(read(file)).not.toMatch(/window\.gtag/)
    }
  })
})
