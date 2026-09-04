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
 * Consent-gated advertising tags for `docs.aglyn.com`.
 *
 * A deliberate STANDALONE copy of the vendor descriptors in
 * `libs/aglyn/src/lib/app-utils/advertising-tags.ts` and of the mount and
 * teardown in `advertising-tag-mounts.tsx`. This app cannot import `libs/` —
 * standalone `node_modules`, its own tsconfig, and a Vercel project that
 * builds with `sourceFilesOutsideRootDirectory: false` (AGL-1595) — so the
 * shared modules are out of reach by construction. It is the same treatment
 * the consent-mode default, the internal-traffic stamp and the error beacon
 * already get, and for the same reason: a copy that drifts still runs without
 * error and still reads like a working one.
 *
 * `apps/console/specs/docs-advertising-tags.spec.ts` compares every boot
 * snippet, script URL and cookie list here against the shipping constants and
 * fails on any drift.
 *
 * ## The consent gate: the console's record, read through the mirror
 *
 * The docs site has no consent dialog, no region endpoint and no per-visitor
 * record of its own — `docusaurus.config.ts` explains why porting the tenant's
 * gate here would be a third implementation of consent, which is the outcome
 * AGL-1579 ruled out. Its analytics posture is a region-conditional
 * `gtag('consent','default',…)`, and Google resolves the region from the
 * request IP. That is enough for a Google tag and it is worth nothing to a
 * Meta or LinkedIn tag, neither of which reads Consent Mode.
 *
 * So the gate here is the SAME record the console resolved, reached through
 * the `aglyn_consent` mirror the console writes at the registrable domain.
 * `docs.aglyn.com` is a sibling of `app.aglyn.com` and `auth.aglyn.com`, so
 * the cookie is readable here; nothing in this file resolves a posture,
 * derives a region or writes a record. It asks the console's answer and obeys
 * it.
 *
 * ⚠️ THE COST, stated rather than glossed: a visitor who has never been to the
 * console has NO record, so this file mounts nothing for them. That is the
 * fail-safe direction and it is also a real limit on how much docs traffic
 * these tags can ever see — a reader arriving from a search result is not
 * retargeted from here, and the audiences this surface feeds are drawn from
 * people who have already touched `app.aglyn.com`. GA4-sourced audiences do
 * not have that limit, because the docs GA tag runs on the region default and
 * needs no record.
 *
 * ⚠️ The mirror does not carry on Vercel PREVIEW deployments — the registrable
 * domain of a `*.vercel.app` hostname is a public suffix the browser refuses a
 * cookie for. It fails safe (no record, no tags), and this project has
 * preview deployments disabled outright, but nothing here may assume the carry
 * works off production.
 *
 * ## Withdrawal, across an origin boundary
 *
 * The console's consent-changed event does not cross origins, so an open docs
 * tab cannot be told the moment a visitor withdraws in the console. What it
 * can do is re-read the mirror whenever it is looked at again, which is what
 * `visibilitychange` and every SPA route change are used for here. A withdrawal
 * therefore takes effect on the docs tab's next activation rather than in the
 * same instant, and the teardown that then runs is the full one: the vendor's
 * own revoke, the script elements removed, and the cookies swept, in that
 * order — sweeping first deletes cookies a resident tag immediately rewrites.
 */

import siteConfig from '@generated/docusaurus.config'

/**
 * The attribute every script element this module renders carries.
 *
 * ⚠️ VERBATIM COPY of `ADVERTISING_TAG_ATTRIBUTE`. Load-bearing for the
 * teardown rather than decoration: only elements carrying it are ever revoked,
 * removed or cookie-swept, so a tag that arrived some other way is never
 * touched by ours.
 */
const AD_TAG_ATTRIBUTE = 'data-aglyn-ad-tag'

/** The registrable-domain mirror of the console's consent record. */
const CONSENT_COOKIE = 'aglyn_consent'

/**
 * The statuses that can carry an advertising grant.
 *
 * ⚠️ VERBATIM COPY of `advertisingGrantedByStatus`. Fails CLOSED: an exact
 * match, so an unknown, absent or future status answers no. An exclusion list
 * would have granted them.
 */
function advertisingGrantedByStatus(status: unknown): boolean {
  return status === 'accepted' || status === 'implied'
}

interface DocsAdVendor {
  /** Matches `AdvertisingVendor.id` — the attribute value and the config key. */
  readonly id: string
  /** ⚠️ VERBATIM COPY of the vendor's `accountIdPattern`. */
  readonly accountIdPattern: RegExp
  /** ⚠️ VERBATIM COPY of the vendor's `scriptSrc`. */
  readonly scriptSrc: string
  /**
   * ⚠️ VERBATIM COPY of the vendor's `scriptSrcFor`, where it has one.
   *
   * The loader URL for a vendor that carries its account id in the query
   * rather than in the boot snippet. `gtag.js` resolves which container to
   * configure from `?id=`, so a copy without it registers nothing and every
   * `config` queues against a runtime that never serves the account.
   */
  readonly scriptSrcFor?: (accountId: string) => string
  /** ⚠️ VERBATIM COPY of the vendor's `scriptMatch`. */
  readonly scriptMatch: string
  /** ⚠️ VERBATIM COPY of the vendor's `sharesLibrary`, where it has one. */
  readonly sharesLibrary?: string
  /** ⚠️ VERBATIM COPY of the vendor's `cookiePrefixes`. */
  readonly cookiePrefixes: readonly string[]
  /** ⚠️ VERBATIM COPY of the vendor's `bootSnippet`. */
  readonly bootSnippet: (accountId: string) => string
  /** ⚠️ VERBATIM COPY of the vendor's `setConsent`. */
  readonly setConsent: (scope: Record<string, unknown>, granted: boolean) => void
}

const VENDORS: readonly DocsAdVendor[] = [
  {
    id: 'meta',
    accountIdPattern: /^[0-9]{8,20}$/,
    scriptSrc: 'https://connect.facebook.net/en_US/fbevents.js',
    scriptMatch: 'connect.facebook.net',
    cookiePrefixes: ['_fbp', '_fbc'],
    bootSnippet: (accountId: string) =>
      "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?" +
      "n.callMethod.apply(n,arguments):n.queue.push(arguments)};" +
      "if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[]}" +
      '(window,document);' +
      "fbq('consent', 'grant');" +
      `fbq('init', '${accountId}');` +
      "fbq('track', 'PageView');",
    setConsent: (scope, granted) => {
      try {
        const fbq = scope.fbq
        if (typeof fbq === 'function') {
          ;(fbq as (...args: unknown[]) => void)(
            'consent',
            granted ? 'grant' : 'revoke',
          )
        }
      } catch {
        // A tag that throws on its own consent call is one we cannot silence
        // that way; the element removal and the cookie sweep still stand.
      }
    },
  },
  {
    id: 'google-ads',
    accountIdPattern: /^AW-[0-9]{6,16}$/,
    scriptSrc: 'https://www.googletagmanager.com/gtag/js',
    scriptSrcFor: (accountId: string) =>
      `https://www.googletagmanager.com/gtag/js?id=${accountId}`,
    sharesLibrary: 'googletagmanager.com/gtag/js',
    scriptMatch: 'googletagmanager.com/gtag/js',
    cookiePrefixes: ['_gcl'],
    bootSnippet: (accountId: string) =>
      'window.dataLayer=window.dataLayer||[];' +
      'function gtag(){dataLayer.push(arguments);}' +
      "gtag('consent','update',{ad_storage:'granted'," +
      "ad_user_data:'granted',ad_personalization:'granted'});" +
      "gtag('js', new Date());" +
      `gtag('config', '${accountId}');`,
    setConsent: (scope, granted) => {
      try {
        const gtag = scope.gtag
        if (typeof gtag === 'function') {
          ;(gtag as (...args: unknown[]) => void)('consent', 'update', {
            ad_storage: granted ? 'granted' : 'denied',
            ad_user_data: granted ? 'granted' : 'denied',
            ad_personalization: granted ? 'granted' : 'denied',
          })
        }
      } catch {
        // Same standing as the others: the teardown does not depend on this.
      }
    },
  },
  {
    id: 'linkedin',
    accountIdPattern: /^[0-9]{4,10}$/,
    scriptSrc: 'https://snap.licdn.com/li.lms-analytics/insight.min.js',
    scriptMatch: 'snap.licdn.com',
    cookiePrefixes: [
      'li_sugr',
      'UserMatchHistory',
      'AnalyticsSyncHistory',
      'bcookie',
      'lidc',
      'li_gc',
    ],
    bootSnippet: (accountId: string) =>
      `window._linkedin_partner_id='${accountId}';` +
      'window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];' +
      'window._linkedin_data_partner_ids.push(window._linkedin_partner_id);',
    setConsent: (scope, granted) => {
      try {
        if (!granted) scope._linkedin_data_partner_ids = []
      } catch {
        // Same standing as the others: the teardown does not depend on this.
      }
    },
  },
]

/**
 * The build-configured ids, absent by default (AGL-2124).
 *
 * `@generated/docusaurus.config` is the one channel from build config to a
 * client module. Unset means OFF, never ours: a self-host operator's build
 * loads none of these, and their own advertising tags are their business.
 */
function readConfiguredIds(): Record<string, string> {
  try {
    const fields = (siteConfig?.customFields ?? {}) as Record<string, unknown>
    const raw = (fields['advertisingTagIds'] ?? {}) as Record<string, unknown>
    const ids: Record<string, string> = {}
    for (const key of Object.keys(raw)) {
      const value = raw[key]
      ids[key] = typeof value === 'string' ? value.trim() : ''
    }
    return ids
  } catch {
    return {}
  }
}

function readConfiguredGtmContainerId(): string {
  try {
    const fields = (siteConfig?.customFields ?? {}) as Record<string, unknown>
    const value = fields['gtmContainerId']
    return typeof value === 'string' ? value.trim() : ''
  } catch {
    return ''
  }
}

/**
 * Does this visitor's mirrored console record grant advertising?
 *
 * The record is re-validated here rather than trusted: a hand-edited cookie
 * can only produce a grant its status supports, which is the same guarantee
 * the console's own adoption path has.
 */
function readMirroredRecord(): Record<string, unknown> | null {
  try {
    for (const pair of String(document.cookie ?? '').split(';')) {
      const cut = pair.indexOf('=')
      if (cut < 0) continue
      if (pair.slice(0, cut).trim() !== CONSENT_COOKIE) continue
      const record = JSON.parse(decodeURIComponent(pair.slice(cut + 1).trim()))
      return record && typeof record === 'object' ? record : null
    }
  } catch {
    // No cookie, cookies disabled, or an unreadable value: no record, which is
    // the undecided state.
  }
  return null
}

function advertisingGranted(): boolean {
  const record = readMirroredRecord()
  if (!record) return false
  if (!advertisingGrantedByStatus(record['status'])) return false
  return record['advertising'] === true
}

/**
 * Has this visitor REFUSED analytics, as distinct from never having been
 * asked?
 *
 * The distinction is the whole of the container's gate on this surface. Docs
 * has no readable analytics verdict of its own — its posture is the
 * region-conditional consent default, which Google resolves from the request
 * IP — so an absent record means "the default governs", exactly as it does for
 * the GA tag the preset loads. A record that says no is the one signal this
 * origin can actually read, and it outranks the default in the only direction
 * a default may ever be outranked.
 */
function analyticsRefused(): boolean {
  const record = readMirroredRecord()
  if (!record) return false
  return record['analytics'] !== true
}

/** Elements THIS MODULE put in the document for a vendor. */
function markedElements(vendor: DocsAdVendor): Element[] {
  try {
    const selector = `script[${AD_TAG_ATTRIBUTE}="${vendor.id}"]`
    return Array.from(document.querySelectorAll(selector)).filter((element) => {
      const src = String((element as HTMLScriptElement).src ?? '')
      // An element with no `src` is the inline boot and passes — it has no URL
      // to disagree with. One whose `src` points elsewhere is excluded: the
      // attribute is ours to write, so a mismatch means something rewrote it
      // and the safe reading is "not ours".
      return src === '' || src.includes(vendor.scriptMatch)
    })
  } catch {
    return []
  }
}

/** Every `domain=` a deletion has to try, most specific first. */
function cookieDomains(): string[] {
  const domains: string[] = []
  try {
    const labels = String(window.location.hostname ?? '')
      .toLowerCase()
      .split('.')
    // Stop at the registrable domain. `docs.aglyn.com` yields `.docs.aglyn.com`
    // and `.aglyn.com`; a two-label hostname yields only its own.
    for (let index = 0; index <= labels.length - 2; index += 1) {
      domains.push(`.${labels.slice(index).join('.')}`)
    }
  } catch {
    // Host-only deletion is still attempted by the caller.
  }
  return domains
}

function clearCookiesWithPrefixes(prefixes: readonly string[]): void {
  try {
    const domains = cookieDomains()
    for (const pair of String(document.cookie ?? '').split(';')) {
      const cut = pair.indexOf('=')
      const name = (cut < 0 ? pair : pair.slice(0, cut)).trim()
      if (!name) continue
      if (!prefixes.some((prefix) => name.startsWith(prefix))) continue
      const expiry = `${name}=; Max-Age=0; Path=/`
      document.cookie = expiry
      for (const domain of domains) document.cookie = `${expiry}; Domain=${domain}`
    }
  } catch {
    // A refusal to clear costs the sweep, never the page. The element removal
    // above has already stopped the tag writing more.
  }
}

function appendScript(vendorId: string, apply: (el: HTMLScriptElement) => void) {
  const element = document.createElement('script')
  element.setAttribute(AD_TAG_ATTRIBUTE, vendorId)
  apply(element)
  document.head.appendChild(element)
}

/** Is a library matching `needle` already in the document? */
function sharedLibraryPresent(needle: string): boolean {
  try {
    return Boolean(document.querySelector(`script[src*="${needle}"]`))
  } catch {
    return false
  }
}

function mountVendor(vendor: DocsAdVendor, accountId: string): void {
  // The inline boot FIRST and the library second: the boot defines the
  // vendor's queue shim and declares the consent state, so nothing the library
  // later drains was queued under a state nobody chose.
  appendScript(vendor.id, (element) => {
    element.text = vendor.bootSnippet(accountId)
  })
  // Skipped when another loader already brought this library in. The docs
  // gtag preset loads `gtag/js` with the GA4 measurement id, so Google Ads
  // rides that one library with a second `config` rather than fetching it
  // again and defining `gtag()` twice.
  if (vendor.sharesLibrary && sharedLibraryPresent(vendor.sharesLibrary)) return
  appendScript(vendor.id, (element) => {
    element.async = true
    // The account rides the loader where the vendor says so: gtag resolves
    // its container from the query, not from the `config` that follows.
    element.src = vendor.scriptSrcFor
      ? vendor.scriptSrcFor(accountId)
      : vendor.scriptSrc
  })
}

/**
 * Stop every tag this module loaded.
 *
 * Three steps, in this order: revoke on the resident tag (the gate cannot
 * unload a script that has already executed, and this is the vendor's own kill
 * switch), remove the elements, then sweep the cookies — last, because the
 * first two are what stop them coming straight back.
 */
function revokeAll(): void {
  const scope = window as unknown as Record<string, unknown>
  for (const vendor of VENDORS) {
    const elements = markedElements(vendor)
    const ours = elements.length > 0
    if (ours) {
      vendor.setConsent(scope, false)
      for (const element of elements) {
        try {
          element.remove()
        } catch {
          // A detached node: the revoke above still stands.
        }
      }
    }
    // Google's `_gcl_*` is swept whether or not a marked element exists: any
    // Google tag writes it, a container included, with no marker of ours ever
    // having been there. Every other vendor's cookies are swept only where we
    // loaded the tag that set them.
    if (ours || vendor.id === 'google-ads') {
      clearCookiesWithPrefixes(vendor.cookiePrefixes)
    }
  }
}

/** Re-grant on a tag that is still resident — the symmetric half. */
function restoreAll(): void {
  const scope = window as unknown as Record<string, unknown>
  for (const vendor of VENDORS) {
    if (markedElements(vendor).length > 0) vendor.setConsent(scope, true)
  }
}

/**
 * Take the verdict again and make the document match it.
 *
 * Idempotent: a vendor already resident is left alone, and one that should not
 * be there is torn down. Called on first paint, on every SPA route change, and
 * whenever the tab is looked at again — which is the only signal available for
 * a withdrawal made on a sibling origin.
 */
function sync(): void {
  const granted = advertisingGranted()
  if (!granted) {
    revokeAll()
    return
  }
  const ids = readConfiguredIds()
  for (const vendor of VENDORS) {
    if (markedElements(vendor).length > 0) continue
    const accountId = String(ids[vendor.id] ?? '')
    // Strict format check: the id lands inside an inline script, and a
    // half-set value must read as absent rather than as an id.
    if (!vendor.accountIdPattern.test(accountId)) continue
    mountVendor(vendor, accountId)
  }
  restoreAll()
}

/**
 * The Google Tag Manager container, gated on ANALYTICS rather than on
 * advertising — a container is a loader, and the tenant runtime's rule is that
 * it can be neither looser than the analytics gate nor stronger.
 *
 * On this surface the analytics grant is the region-conditional consent
 * default the `ssrTemplate` already emitted, which Google resolves from the
 * request IP and which is not readable from here. So the container loads
 * wherever the docs GA tag itself loads, and its advertising tags read the
 * `ad_storage` / `ad_user_data` / `ad_personalization` state that declaration
 * set — denied in the EEA, the UK and Switzerland, granted elsewhere.
 *
 * The one signal this origin CAN read outranks that default in the only
 * direction a default may be outranked: a mirrored record that refuses
 * analytics takes the container down, wherever the visitor is.
 *
 * ⛔ The container is NOT part of {@link revokeAll}. Withdrawing ADVERTISING
 * alone must leave it running — it rides the analytics grant, and tearing it
 * down with the vendor tags would silently make an advertising refusal an
 * analytics refusal too.
 *
 * ⚠️ No `<noscript>` iframe, deliberately: it would fire the container with no
 * JavaScript, so no consent defaults and nothing to suppress it.
 */
function syncContainer(): void {
  const containerId = readConfiguredGtmContainerId()
  const mounted = Array.from(
    document.querySelectorAll(`script[${AD_TAG_ATTRIBUTE}="gtm"]`),
  )
  if (analyticsRefused()) {
    for (const element of mounted) {
      try {
        element.remove()
      } catch {
        // A detached node: the removal that matters already happened.
      }
    }
    return
  }
  if (!/^GTM-[A-Z0-9]{5,10}$/.test(containerId)) return
  if (mounted.length > 0) return
  appendScript('gtm', (element) => {
    element.text =
      'window.dataLayer=window.dataLayer||[];' +
      'function gtag(){dataLayer.push(arguments);}' +
      "dataLayer.push({'gtm.start':new Date().getTime(),event:'gtm.js'});"
  })
  appendScript('gtm', (element) => {
    element.async = true
    element.src = `https://www.googletagmanager.com/gtm.js?id=${containerId}`
  })
}

/**
 * Armed only in production builds, mirroring the gtag posture in
 * `docusaurus.config.ts`: `docusaurus start` loads nothing, and this Vercel
 * project has no preview deployments to leak from. It is the same rule
 * `analyticsMayEmit` applies to the two Next apps.
 */
const ARMED = process.env.NODE_ENV === 'production'

if (ARMED && typeof window !== 'undefined') {
  try {
    syncContainer()
    sync()
    // A withdrawal made in the console cannot reach this origin as an event,
    // so the mirror is re-read whenever this tab is looked at again.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      syncContainer()
      sync()
    })
  } catch {
    // Advertising never breaks the docs.
  }
}

/** Docusaurus calls this on every SPA route change. */
export function onRouteUpdate(): void {
  if (!ARMED || typeof window === 'undefined') return
  try {
    syncContainer()
    sync()
  } catch {
    // Advertising never breaks the docs.
  }
}
