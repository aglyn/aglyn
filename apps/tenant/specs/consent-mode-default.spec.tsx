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
 * The consent-mode `default`, and the line it must never cross (AGL-1622).
 *
 * Zach's decision, 2026-08-14: load-then-restrict is approved for the UNITED
 * STATES — GA may load under the existing implied-consent posture, and the
 * consent-mode signals restrict the tag that is legitimately resident. EU and
 * UK are left "as legally implied", i.e. as the law requires: the prior-consent
 * gate keeps meaning the tag NEVER LOADS without an explicit accept, because
 * loading an analytics tag before consent is the specific act ePrivacy/GDPR
 * prohibits. Load-then-restrict is therefore strictly ADDITIVE — a second
 * restraint on a tag that is already there — and never a replacement for the
 * AGL-1498 gate.
 *
 * ## The guard this file exists for
 *
 * "No prior-consent region emits ANY GA artefact before consent" is the
 * assertion that outlives this conversation. The tempting misreading of the
 * decision is to hoist the `default` declaration into the page for everyone —
 * that is, after all, how every third-party CMP does it — which would put a
 * `gtag('consent', 'default', …)` block and the tag behind it in front of an EU
 * visitor who has answered nothing. That change compiles, keeps every other
 * consent spec green, and is a compliance defect. It goes red here.
 *
 * The guard runs over EVERY member of `PRIOR_CONSENT_COUNTRY_CODES`, so adding
 * a country to that set enrols it automatically, and it asserts the banner IS
 * present in the same breath — a spec that only checks for absence passes
 * vacuously the day the component throws.
 *
 * ## Non-vacuity, run in this order
 *
 * - Source unchanged, spec added: the seven "US posture" / "declaration"
 *   cases fail (no `default` is declared anywhere), the guard passes.
 * - Default emitted OUTSIDE the `analyticsAllowed` condition: the guard fails
 *   on the first prior-consent country, and on the unknown-region case.
 * - Shipped source: all cases pass.
 *
 * Siblings: `ga-consent-gate.spec.tsx` (the gate itself),
 * `consent-resident-tag.spec.tsx` (AGL-1608's silence-on-withdrawal),
 * `consent-cookie-cleanup.spec.tsx` (AGL-1606's sweep).
 */
import {
  analyticsConsentSignals,
  GA_CONSENT_DEFAULT_SNIPPET,
  PRIOR_CONSENT_COUNTRY_CODES,
  setResidentAnalyticsTags,
  storeVisitorConsent,
} from '@aglyn/aglyn'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SiteAnalytics from '../app/[host]/[[...slug]]/site-analytics'

// Unlike the gate spec's mock, this one renders the CHILDREN: the whole
// question here is what the inline block SAYS, not merely that it exists.
jest.mock('next/script', () => ({
  __esModule: true,
  default: (props: Record<string, any>) => (
    <script data-testid={props.id} data-gasrc={props.src}>
      {props.children}
    </script>
  ),
}))

const HOST_ID = 'consent-default-host'
const GA_ID = 'G-TEST1234'
const GA_HOST = { $id: HOST_ID, analytics: { gaMeasurementId: GA_ID } }

function plantRegion(country: string | null) {
  ;(global as any).fetch = jest.fn(async (input: any) => {
    const url = String(input)
    if (!url.includes('/api/consent/region')) {
      throw new Error(`Unexpected fetch in spec: ${url}`)
    }
    return { ok: true, json: async () => ({ country }) }
  })
}

async function renderPage(host: Record<string, any>) {
  let result!: ReturnType<typeof render>
  await act(async () => {
    result = render(<SiteAnalytics host={host as any} />)
  })
  return result
}

const gaInit = () => screen.queryByTestId('ga-init')
const gaScript = () => screen.queryByTestId('ga-src')
const askBanner = () => document.querySelector('[data-aglyn-consent-banner]')

/** The consent payload the rendered inline block actually declares. */
function declaredDefault(): Record<string, string> | null {
  const text = gaInit()?.textContent ?? ''
  const match = /gtag\('consent', 'default', (\{.*?\})\);/.exec(text)
  return match ? JSON.parse(match[1]) : null
}

describe('the consent-mode default (AGL-1622)', () => {
  afterEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/')
    delete (navigator as Record<string, any>)['globalPrivacyControl']
    delete (global as any).fetch
    delete (window as unknown as Record<string, any>).gtag
    delete (window as unknown as Record<string, any>).dataLayer
  })

  describe('EU/UK: the gate still means the tag never LOADS', () => {
    it('no prior-consent country emits any GA artefact before consent', async () => {
      // Every code in the set, so a country added to it is guarded on the day
      // it is added rather than the day someone remembers this file.
      for (const country of [...PRIOR_CONSENT_COUNTRY_CODES].sort()) {
        window.localStorage.clear()
        window.sessionStorage.clear()
        plantRegion(country)
        const view = await renderPage(GA_HOST)
        // Not a vacuous pass: the machinery ran and chose to ASK.
        await waitFor(() => expect(askBanner()).toBeTruthy())

        const html = document.body.innerHTML
        expect(`${country}:${html.includes('googletagmanager')}`).toBe(
          `${country}:false`,
        )
        expect(`${country}:${html.includes('gtag(')}`).toBe(`${country}:false`)
        expect(`${country}:${html.includes("'default'")}`).toBe(
          `${country}:false`,
        )
        expect(gaInit()).toBeNull()
        expect(gaScript()).toBeNull()
        view.unmount()
      }
    })

    it('an UNKNOWN region gets no default either — no signal is not a licence', async () => {
      plantRegion(null)
      await renderPage(GA_HOST)
      await waitFor(() => expect(askBanner()).toBeTruthy())
      expect(document.body.innerHTML).not.toContain('gtag(')
      expect(gaInit()).toBeNull()
    })

    it("a host in 'strict' mode gets no default, even in the US", async () => {
      plantRegion('US')
      await renderPage({ ...GA_HOST, consent: { mode: 'strict' } })
      await waitFor(() => expect(askBanner()).toBeTruthy())
      expect(document.body.innerHTML).not.toContain('gtag(')
      expect(gaInit()).toBeNull()
    })

    it('a declined EU visitor gets no default on the next pageview', async () => {
      storeVisitorConsent(HOST_ID, { status: 'declined', country: 'DE' })
      plantRegion('DE')
      await renderPage(GA_HOST)
      expect(gaInit()).toBeNull()
      expect(document.body.innerHTML).not.toContain('gtag(')
    })

    it('an EU accept declares the default only THEN — after the explicit yes', async () => {
      plantRegion('FR')
      await renderPage(GA_HOST)
      await waitFor(() => expect(askBanner()).toBeTruthy())
      expect(gaInit()).toBeNull()
      fireEvent.click(screen.getByText('Allow'))
      expect(declaredDefault()).toEqual(analyticsConsentSignals(true))
    })
  })

  describe('US: load-then-restrict, on a tag the posture already allows', () => {
    it('an implied US visitor gets the default, granting analytics only', async () => {
      plantRegion('US')
      await renderPage(GA_HOST)
      await waitFor(() => expect(gaInit()).toBeTruthy())
      expect(declaredDefault()).toEqual({
        analytics_storage: 'granted',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      })
    })

    it('the default precedes `config` — no hit before the tag is told', async () => {
      plantRegion('US')
      await renderPage(GA_HOST)
      await waitFor(() => expect(gaInit()).toBeTruthy())
      const text = gaInit()?.textContent ?? ''
      const declaredAt = text.indexOf("gtag('consent', 'default'")
      const configuredAt = text.indexOf("gtag('config'")
      expect(declaredAt).toBeGreaterThanOrEqual(0)
      expect(configuredAt).toBeGreaterThan(declaredAt)
    })

    it('the inline block precedes the library it configures', async () => {
      plantRegion('US')
      await renderPage(GA_HOST)
      await waitFor(() => expect(gaInit()).toBeTruthy())
      const scripts = Array.from(document.querySelectorAll('script'))
      expect(scripts.indexOf(gaInit() as HTMLScriptElement)).toBeGreaterThanOrEqual(0)
      expect(scripts.indexOf(gaInit() as HTMLScriptElement)).toBeLessThan(
        scripts.indexOf(gaScript() as HTMLScriptElement),
      )
    })

    it('a withdrawal still restricts the resident tag, from the same payload', async () => {
      const updates: Record<string, string>[] = []
      const scope = window as unknown as Record<string, any>
      scope.gtag = (...args: any[]) => {
        if (args[0] === 'consent' && args[1] === 'update') updates.push(args[2])
      }
      setResidentAnalyticsTags(false)
      expect(updates).toEqual([analyticsConsentSignals(false)])
      expect(updates[0].analytics_storage).toBe('denied')
    })

    it('the declared default and the withdrawal update share one source', async () => {
      // Two hand-written literals that disagree is how a tag ends up believing
      // a state the visitor never chose; this pins them to one builder.
      plantRegion('US')
      await renderPage(GA_HOST)
      await waitFor(() => expect(gaInit()).toBeTruthy())
      expect(declaredDefault()).toEqual(analyticsConsentSignals(true))
      expect(Object.keys(declaredDefault() ?? {}).sort()).toEqual(
        Object.keys(analyticsConsentSignals(false)).sort(),
      )
    })
  })

  describe('boundaries', () => {
    it('a host running their own CMP gets NO default from us', async () => {
      // `consent.disabled` means the host's own solution owns the default; a
      // second one racing it would overwrite their visitor's answer with ours.
      plantRegion('US')
      await renderPage({ ...GA_HOST, consent: { disabled: true } })
      await waitFor(() => expect(gaScript()).toBeTruthy())
      expect(gaInit()?.textContent ?? '').not.toContain("'default'")
      expect(declaredDefault()).toBeNull()
    })

    it('a GPC browser in the US gets no tag and no default', async () => {
      Object.defineProperty(navigator, 'globalPrivacyControl', {
        value: true,
        configurable: true,
      })
      plantRegion('US')
      await renderPage(GA_HOST)
      expect(gaInit()).toBeNull()
      expect(document.body.innerHTML).not.toContain('gtag(')
    })

    it('the snippet carries no interpolated input (AGL-138)', async () => {
      // It lands inside an inline script, so it must be a literal built from
      // the closed signal set — never anything host-configured.
      expect(GA_CONSENT_DEFAULT_SNIPPET).toBe(
        `gtag('consent', 'default', ${JSON.stringify(
          analyticsConsentSignals(true),
        )});`,
      )
      expect(GA_CONSENT_DEFAULT_SNIPPET).not.toContain('<')
      expect(GA_CONSENT_DEFAULT_SNIPPET).not.toContain(GA_ID)
    })
  })
})
