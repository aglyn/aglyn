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

import type { VisitorConsentHost } from './visitor-consent'

/**
 * Third-party analytics tags, behind one contract (AGL-3080).
 *
 * A site can send its visitors' measurement to an analytics vendor it chose:
 * a measurement id or a tag container, saved in the site's analytics
 * settings. The platform owns everything around that tag — whether this
 * visitor may be measured at all (`visitor-consent.ts`), the consent banner,
 * the first-party pageview beacon that meters the site (`analytics-beacon.ts`,
 * which is not a tag and never goes through here) — and names no vendor. A
 * plugin's ADAPTER is what knows a vendor: what its tag looks like on the
 * page, how a resident tag is told the visitor's answer changed, and how an
 * event reaches it.
 *
 * ## Declared, then loaded where it is used
 *
 * Two questions, answered by two different mechanisms, because their readers
 * cannot wait for the same thing:
 *
 * - "Does this site run a tag, so is there anything to ask its visitors?" is
 *   asked synchronously, during render, by the consent gate on the published
 *   page and by the console's banner card and preview. A registry one of
 *   those had not filled yet would answer "no tag" — no banner, and nothing to
 *   gate — so the answer is COMPILED: the plugin declares which of the site's
 *   analytics settings it mounts a tag for (`analyticsProvider.settings` in
 *   `plugins.config.json`), and `hostConfiguresAnalyticsTag` in
 *   `visitor-consent.ts` reads that list. With no provider declared, no setting configures a tag, and a site
 *   with nothing that could mount asks its visitors nothing.
 * - Everything else — mounting the tag, telling it the answer changed,
 *   handing it an event — happens after the adapter has loaded. The adapter
 *   is a chunk of its own, reached through each app's generated
 *   `plugins.analytics.generated.ts` and fetched only by a document that uses
 *   it: a published page whose site configures a tag, and the console, whose
 *   own measurement tag the consent controls answer to. A page whose site
 *   configures none never fetches it.
 *
 * ## What an unloaded adapter means
 *
 * A tag is mounted only by its adapter, so until the adapter has loaded there
 * is no tag of its to silence or to send to, and nothing is lost by the wait:
 * events find no resident tag and drop, exactly as they do for a visitor who
 * has not granted.
 *
 * A tag this document did not mount — the console's, which its analytics SDK
 * injects — can be resident before the adapter arrives. So the last answer
 * {@link applyAnalyticsConsent} was given is kept, and an adapter that
 * registers later is handed it at once: a withdrawal made in that window
 * reaches the tag the moment something can speak to it.
 */

/**
 * What a provider declares about itself, compiled from `plugins.config.json`.
 * `settings` are keys of the site's `analytics` settings; each is validated
 * by the pattern `ANALYTICS_SETTING_PATTERNS` in `visitor-consent.ts` holds
 * for it.
 */
export interface AnalyticsProviderDeclaration {
  /** The plugin that provides the adapter. */
  pluginId: string
  /** The analytics settings this provider mounts a tag for. */
  settings: readonly string[]
}

/** The visitor's answer, in the platform's two categories. */
export interface AnalyticsGrants {
  analytics: boolean
  advertising: boolean
}

/**
 * One tag on a published page: an inline boot that runs first, then the
 * vendor's library. The page renders the pair in order, under the consent
 * gate and with the request's nonce, as `${id}-init` and `${id}-src`.
 *
 * Both strings land in the document. `boot` is inline script, so an adapter
 * builds it from constants and format-checked ids only.
 */
export interface AnalyticsTagMount {
  /** Element id prefix. Stable: specs and the CSP report read it. */
  id: string
  /** Inline script that runs before the library. */
  boot: string
  /** The library URL. */
  src: string
  /**
   * A marker for the library this pair loads, for an advertising vendor that
   * rides the same library instead of fetching it again (`sharesLibrary` in
   * `advertising-tags.ts`).
   */
  library?: string
}

/** What the page tells an adapter about the pageview it mounts tags for. */
export interface AnalyticsMountOptions {
  /**
   * Whether the site runs the platform's consent machinery. When it does, the
   * tag is told the visitor's answer before it measures anything; when the
   * host runs a consent solution of its own, that solution tells it.
   */
  consentRequired: boolean
  /** Whether this visitor granted advertising storage on this site. */
  advertising: boolean
}

export interface AnalyticsEventOptions {
  /**
   * Address only the measurement destinations of the resident tag, not any
   * advertising destination sharing its library. Set for events that no
   * advertising report reads, such as Core Web Vitals.
   */
  measurementOnly?: boolean
}

/** A vendor's adapter. */
export interface AnalyticsProvider {
  /**
   * The tags a granted pageview mounts for `host`, in order; empty when the
   * host configures none of this provider's settings, or configures them
   * malformed. Called only once the page's consent gate has said yes.
   */
  mounts(
    host: VisitorConsentHost | null | undefined,
    options: AnalyticsMountOptions,
  ): readonly AnalyticsTagMount[]
  /**
   * Make every resident tag of this vendor agree with `grants`, and answer
   * the ids it acted on. A page cannot unload a script, so a withdrawal in
   * the middle of a pageview has to be told to the tag that is already there.
   */
  applyConsent(grants: AnalyticsGrants): readonly string[]
  /** Whether a tag of this vendor is resident and can take an event now. */
  resident(): boolean
  /** Hand one event to the resident tag. Never throws. */
  sendEvent(
    name: string,
    params: Record<string, unknown>,
    options?: AnalyticsEventOptions,
  ): void
}

/** An adapter module, as an app's generated manifest loads it. */
export interface AnalyticsProviderModule {
  analyticsProvider: AnalyticsProvider
}

/** One row of an app's generated `plugins.analytics.generated.ts`. */
export interface AnalyticsProviderLoader {
  pluginId: string
  load: () => Promise<AnalyticsProviderModule>
}

const providers = new Map<string, AnalyticsProvider>()
const listeners = new Set<() => void>()
let snapshot: readonly AnalyticsProvider[] = []
let lastGrants: AnalyticsGrants | null = null

function publish(): void {
  snapshot = [...providers.values()]
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // One listener cannot stop the others hearing about the provider.
    }
  }
}

/**
 * Registers `pluginId`'s adapter. The same plugin registering again replaces
 * its adapter. If a consent answer was already given in this document, the
 * adapter is told it before anything else can reach it.
 */
export function registerAnalyticsProvider(
  pluginId: string,
  provider: AnalyticsProvider,
): void {
  providers.set(pluginId, provider)
  if (lastGrants) {
    try {
      provider.applyConsent(lastGrants)
    } catch {
      // An adapter that throws on its own consent call is one we cannot
      // silence; the cookie sweep still stands.
    }
  }
  publish()
}

/** The registered adapters, in registration order. A stable array. */
export function analyticsProviders(): readonly AnalyticsProvider[] {
  return snapshot
}

/** Hears every registration. Answers the unsubscribe. */
export function subscribeAnalyticsProviders(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Tell every resident tag the visitor's answer, and answer the ids acted on.
 * Advertising is clamped to analytics: a refusal withdraws both.
 */
export function applyAnalyticsConsent(grants: AnalyticsGrants): string[] {
  const analytics = grants.analytics === true
  const clamped: AnalyticsGrants = {
    analytics,
    advertising: analytics && grants.advertising === true,
  }
  lastGrants = clamped
  const ids: string[] = []
  for (const provider of snapshot) {
    try {
      ids.push(...provider.applyConsent(clamped))
    } catch {
      // See `registerAnalyticsProvider`.
    }
  }
  return ids
}

/** Whether any registered adapter has a tag resident that can take an event. */
export function analyticsTagResident(): boolean {
  return snapshot.some((provider) => {
    try {
      return provider.resident()
    } catch {
      return false
    }
  })
}

/**
 * Hand one event to every resident tag. Answers whether any took it, so a
 * caller that may hold an event while a tag is still loading knows to.
 */
export function sendAnalyticsProviderEvent(
  name: string,
  params: Record<string, unknown>,
  options?: AnalyticsEventOptions,
): boolean {
  let sent = false
  for (const provider of snapshot) {
    try {
      if (!provider.resident()) continue
      provider.sendEvent(name, params, options)
      sent = true
    } catch {
      // Analytics never breaks the page.
    }
  }
  return sent
}

const loading = new Map<string, Promise<void>>()

/**
 * Fetch and register each adapter once per document. Idempotent and safe to
 * call during render: it starts the fetch, never waits for it, and a loader
 * that fails leaves that provider unregistered — the vendor's tag then never
 * mounts, which is the outcome a failed vendor library has anyway.
 */
export function loadAnalyticsProviders(
  loaders: readonly AnalyticsProviderLoader[],
): Promise<void> {
  return Promise.all(
    loaders.map((loader) => {
      let pending = loading.get(loader.pluginId)
      if (!pending) {
        pending = loader
          .load()
          .then((module) => {
            if (module?.analyticsProvider) {
              registerAnalyticsProvider(loader.pluginId, module.analyticsProvider)
            }
          })
          .catch(() => {
            // No adapter, no tag — see above.
          })
        loading.set(loader.pluginId, pending)
      }
      return pending
    }),
  ).then((): void => undefined)
}

/** Test seam — forgets every adapter, load and consent answer. */
export function resetAnalyticsProviders(): void {
  providers.clear()
  loading.clear()
  lastGrants = null
  publish()
}
