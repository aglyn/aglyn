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
'use client'

import {
  type FirebaseApp,
  type FirebaseOptions,
  getApps,
  initializeApp,
} from 'firebase/app'
import {
  type Analytics,
  getAnalytics as getAnalyticsInstance,
  initializeAnalytics as initializeAnalyticsInstance,
} from 'firebase/analytics'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import { analyticsMayEmit } from '@aglyn/aglyn/app-utils/analytics-environment'
import { pushPlatformConsentDefault } from '@aglyn/aglyn/app-utils/platform-consent-default'
import { VISITOR_CONSENT_CHANGED_EVENT } from '@aglyn/aglyn/app-utils/visitor-consent'
import {
  type Auth,
  connectAuthEmulator,
  onIdTokenChanged,
  type User,
} from 'firebase/auth'
import {
  type Database,
  connectDatabaseEmulator,
  getDatabase as getDatabaseInstance,
} from 'firebase/database'
import {
  type Firestore,
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
} from 'firebase/firestore'
import {
  type RemoteConfig,
  getRemoteConfig as getRemoteConfigInstance,
} from 'firebase/remote-config'
import { type FirebaseStorage, getStorage as getStorageInstance } from 'firebase/storage'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  FIREBASE_AUTH_EMULATOR_ENABLED,
  FIREBASE_DATABASE_EMULATOR_ENABLED,
  FIREBASE_FIRESTORE_EMULATOR_ENABLED,
} from '@aglyn/shared-data-enums'
import {
  APP_CHECK_KEY_MISSING_MESSAGE,
  appCheckSiteKey,
} from '../../constants/firebase-config'
import {
  type AuthPersistenceClass,
  createAuthInstance,
} from './auth-persistence'
import { localCacheFor } from './firestore-cache'

/**
 * Drop-in replacement for reactfire's `ObservableStatus<T>` — reactfire is
 * unmaintained against firebase majors past v9, but its shape is preserved
 * here so `helpers/use-doc.ts`'s already-battle-tested onSnapshot+retry
 * implementation (AGL-216/223) didn't need to change.
 */
export interface ObservableStatus<T> {
  status: 'loading' | 'error' | 'success'
  hasEmitted: boolean
  isComplete: boolean
  data: T
  error: Error | undefined
  firstValuePromise: Promise<void>
  /**
   * The emitted `data` includes local writes the server has NOT
   * acknowledged (`snapshot.metadata.hasPendingWrites`).
   *
   * Carried rather than dropped because a caller cannot otherwise tell "the
   * store holds this" from "my browser holds this". `persistentLocalCache`
   * replays a queued write into the very first snapshot after a reload, so a
   * caller that treats every snapshot as authoritative will adopt its own
   * unacknowledged edit as the saved state — which is how the besigner ended
   * up unable to save real changes (AGL-1262).
   */
  hasPendingWrites: boolean
  /**
   * The emitted `data` came from the local cache and the server has NOT
   * confirmed it (`snapshot.metadata.fromCache`).
   *
   * Carried because it is the only per-listener ground truth about
   * freshness the SDK offers, and the console needs it (AGL-1066). Under
   * `persistentLocalCache` a listener whose server listen is being REFUSED
   * still emits cached snapshots and still reports `status: 'success'` —
   * the retry budget is reset by each cached emission and never spends, so
   * `status` can never reveal the fault (see
   * `use-firestore-collection-cached-retry.spec.ts`).
   *
   * Prefer this over `session-health`'s `staleSession` for anything that
   * asks "is what I am looking at live?". `staleSession` is a heuristic
   * needing two denied collections inside a window, and it is unreachable
   * on listener-only pages; this is a fact about THIS listener, costs
   * nothing, and clears itself the instant a server snapshot lands.
   */
  fromCache: boolean
  /**
   * The server has REFUSED this listen for longer than the retry budget, and
   * no server snapshot has arrived since (AGL-1066).
   *
   * `fromCache` says "unconfirmed", which is also true offline and true for
   * the first snapshot of a perfectly healthy load. This says "refused" —
   * only `permission-denied` counts it, and it takes a whole budget's worth
   * in a row, so it cannot fire offline and cannot fire on the AGL-216/217
   * post-sign-in token race.
   *
   * It is what `status` would say if the retry budget were spendable. It is
   * carried separately because correcting `status` in place would blank
   * every surface that renders cached data through an `error` branch — see
   * the note on `attempt = 0` in `use-firestore-collection`.
   */
  serverDenied: boolean
}

/** Replaces reactfire's `ReactFireOptions<T>` — drops the `suspense` field, which was never read. */
export interface FirestoreDocOptions<T> {
  idField?: string
  initialData?: T
}

interface FirebaseServices {
  app: FirebaseApp
  firestore: Firestore
  auth: Auth
  database: Database
  storage: FirebaseStorage
  analytics: Analytics
  remoteConfig: RemoteConfig
  /**
   * The persistence class `auth` was actually created with (AGL-1379).
   *
   * Published so a **second** auth instance derives its class from the
   * primary rather than re-deciding it. `apps/console/hooks/use-presence.ts`
   * builds its own Firebase app and its own `Auth`; before this it took the
   * SDK default unconditionally, so configuring only the provider would have
   * left presence persisting a refresh token on an origin the provider had
   * just been careful not to persist one on.
   */
  authPersistence: AuthPersistenceClass
}

const FirebaseServicesContext = createContext<FirebaseServices | undefined>(undefined)

// Module-scope guards so HMR / remounts don't re-run emulator connection
// (which throws if called twice) or double-initialize Firestore's
// persistent cache.
//
// Firestore's is keyed by app NAME, not a bare boolean (AGL-1456): Firestore
// initialization is once-per-app, so a module-global flag made the FIRST app
// to mount decide for every later one — a second app would silently skip
// `initializeFirestore` and take SDK defaults. That mattered the moment the
// cache stopped being the same on every host.
const firestoreInitialized = new Set<string>()
let connectedDatabase = false
let connectedAuth = false

/**
 * True when THIS Chrome instance is under WebDriver automation control
 * (Puppeteer, Playwright, Selenium, or a raw CDP client) — never true for a
 * person's own browser.
 *
 * The `initializeFirestore` call below already documents the fault this
 * exists for: "the emulator's WebChannel streaming misbehaves in automated
 * Chrome — listeners serve the initial empty from-cache snapshot and the
 * server sync never arrives" (AGL-217). That mitigation only reaches
 * `FIREBASE_FIRESTORE_EMULATOR_ENABLED`, so an automated session against a
 * REAL, deployed backend — a browser-automation agent driving a live
 * console, which is exactly what `navigator.webdriver` detects — stayed
 * exposed. `getDocs`/`getDoc` and `onSnapshot` all resolve over the same
 * Watch stream internally, so a one-shot read wedges exactly like a listener
 * does: no error, nothing to catch, `loading` simply never gets its
 * settling event. That is the Media Library grid spinning on "Loading
 * media…" indefinitely with a perfectly healthy account and a perfectly
 * healthy network.
 *
 * `undefined` during SSR reads as `false` — `navigator` does not exist in
 * Node, and a server render can only ever produce the auto-detected
 * transport, never the forced one.
 */
const isAutomatedChromeSession = (): boolean =>
  typeof navigator !== 'undefined' && navigator.webdriver === true

/**
 * The console tag's gtag config — ONE object, at module scope, deliberately
 * (AGL-1979).
 *
 * `initializeAnalytics(app, options)` throws `already-initialized` unless the
 * options `deepEqual` the ones the instance was first created with, and the
 * provider re-enters this block on every mount, every StrictMode double
 * invoke and every Fast Refresh. A fresh object literal per call survives
 * that only by *value*; a shared constant survives it by *identity*, which is
 * the first branch of the SDK's own comparison and cannot drift when someone
 * edits one call site and not another.
 *
 * ⚠️ The SDK MUTATES this object: `_initializeAnalytics` reads `options.config`
 * and writes `origin`, `update` and the installation id onto it in place.
 * That is precisely why sharing it is safe rather than dangerous — the object
 * the provider holds and the object the SDK stored are the same one, so they
 * cannot disagree.
 */
const CONSOLE_ANALYTICS_OPTIONS = {
  config: { send_page_view: false, content_group: 'console' },
}

/**
 * A surface's answer to "may an analytics tag exist for this visitor at all?".
 *
 * Registered from the app, at module scope, in the same shape as
 * `setFirestoreSessionReporters` and `setStaleSessionCheck` — and for a
 * sharper version of the same reason. This is consulted during the provider's
 * FIRST render, before any effect anywhere has run, so a gate installed from
 * an effect would arrive after the decision it exists to make.
 *
 * Answering `false` means the SDK is never asked to initialize: `gtag.js` is
 * never fetched, `window.gtag` never comes into existence, and the shared
 * `deliver()` in `analytics-events.ts` — whose fallback IS `window.gtag` —
 * therefore has nowhere to put a hit. That is the difference between a gate
 * and a suppression, and it is the difference AGL-1608 paid for: a resident
 * tag reports on its own, through enhanced measurement, whatever any flag
 * says afterwards.
 */
export type AnalyticsConsentGate = () => boolean

let analyticsConsentGate: AnalyticsConsentGate | null = null

/**
 * Install the consent gate for this document, or clear it with `null`.
 *
 * UNREGISTERED MEANS ALLOWED, which is deliberate and is the only default that
 * is safe here. The tenant runtime does not use this provider's analytics
 * branch at all (it builds its own tag in `site-analytics.tsx`, behind the
 * AGL-1498 gate), and a self-hosted console points at the operator's own GA
 * property — silencing an operator's analytics because Aglyn's own surface
 * grew a gate is a failure they cannot diagnose. The surface that needs the
 * gate is the one that registers it.
 */
export function setAnalyticsConsentGate(
  gate: AnalyticsConsentGate | null,
): void {
  analyticsConsentGate = gate
}

/** The gate's verdict, with an unregistered gate reading as "allowed". */
function analyticsConsentAllows(): boolean {
  if (analyticsConsentGate === null) return true
  try {
    return analyticsConsentGate() === true
  } catch {
    // A gate that throws cannot be read as consent. Storage can throw in
    // private mode, and "we could not tell" is the one state this whole
    // mechanism resolves to "no".
    return false
  }
}

/**
 * The Analytics instance per Firebase app, so a re-boot after a consent change
 * hands back the tag that is already resident rather than asking the SDK for a
 * second one.
 *
 * `initializeAnalytics` is idempotent while the options match, so this is not
 * what makes re-entry safe — `CONSOLE_ANALYTICS_OPTIONS` being a shared
 * constant is. What this avoids is the noisy path: once anything has
 * initialized the provider with different options, every later call throws and
 * is logged, and a withdrawal followed by a re-grant would log it again.
 */
const analyticsByApp = new WeakMap<FirebaseApp, Analytics>()

/**
 * Boot the console's Analytics tag, or return the one already booted.
 *
 * Extracted from the provider body so that "when is the tag created" and "may
 * it be created" are separable: the consent gate can defer this call to a
 * later render without the ordering below moving.
 */
function bootAnalytics(app: FirebaseApp): Analytics | undefined {
  const existing = analyticsByApp.get(app)
  if (existing) return existing
  let analytics: Analytics
  // The region-conditional consent default (AGL-1597), declared BEFORE the
  // SDK boots the tag. Ordering is the whole of it: a `default` read after
  // `config` is not a default, and the SDK issues `config` inside
  // `initializeAnalytics` on the next line. Pushing onto `dataLayer` here
  // works even though gtag.js is not loaded yet — the queue is what makes the
  // ordering expressible.
  //
  // Still declared even though the gate above has already said yes, and the
  // two are not redundant. The gate answers "may a tag exist"; the default
  // answers "what may the tag that does exist do", per region, from its very
  // first hit. Ad storage stays denied everywhere on this surface.
  pushPlatformConsentDefault(
    typeof window === 'undefined' ? null : (window as never),
  )
  try {
    analytics = initializeAnalyticsInstance(app, CONSOLE_ANALYTICS_OPTIONS)
  } catch (error) {
    console.error(error)
    try {
      // Already initialized by someone else, with someone else's options:
      // take THAT instance rather than leaving consumers with nothing. The
      // tag it is attached to was configured without `send_page_view: false`
      // and without `content_group`, so this session reports a duplicate
      // startup page_view and an unstamped surface — degraded, and loudly so,
      // instead of silently dead.
      analytics = getAnalyticsInstance(app)
    } catch (fallbackError) {
      console.error(fallbackError)
    }
  }
  if (analytics) analyticsByApp.set(app, analytics)
  return analytics
}

/**
 * The tag this document may have right now: none outside a real production
 * deployment, none while consent is absent, otherwise the booted instance.
 */
function analyticsForConsentState(app: FirebaseApp): Analytics | undefined {
  if (!analyticsMayEmit()) return undefined
  if (!analyticsConsentAllows()) return undefined
  return bootAnalytics(app)
}

export interface FirebaseServicesProviderProps {
  firebaseConfig: FirebaseOptions
  appName: string
  /**
   * How much of *anything* this origin may keep on disk. Defaults to
   * `durable`, which is what every host serving this provider today is:
   * `*.aglyn.com` and `*.aglyn.app`, whose DNS we own and whose 14-day
   * session is the product.
   *
   * A **custom console domain** (AGL-1099c) must pass `ephemeral`. That is
   * the whole reason this is a prop rather than a constant: the class differs
   * per origin, not per build, and the decision belongs to whoever knows
   * which origin is being served.
   *
   * **It governs two things, and the name only names one.** It selects the
   * `Auth` persistence class (AGL-1379) *and* the Firestore `localCache`
   * (AGL-1456) — because both answer the same question about the same origin,
   * and splitting them into two props is precisely how the cache came to be
   * unconditional while the credential was hardened. See `firestore-cache.ts`.
   */
  authPersistence?: AuthPersistenceClass
  children?: ReactNode
}

export function FirebaseServicesProvider(props: FirebaseServicesProviderProps) {
  const { firebaseConfig, appName, authPersistence = 'durable', children } = props
  const servicesRef = useRef<FirebaseServices | undefined>(undefined)

  if (!servicesRef.current) {
    const app =
      getApps().find((existing) => existing.name === appName) ??
      initializeApp(firebaseConfig, appName)
    // `durable` resolves to the same `getAuth(app)` this always called.
    const auth = createAuthInstance(app, authPersistence)
    const database = getDatabaseInstance(app)

    if (!firestoreInitialized.has(appName)) {
      try {
        // Under the emulator (dev/e2e only): force long-polling and skip
        // the persistent multi-tab cache. The emulator's WebChannel
        // streaming misbehaves in automated Chrome — listeners serve the
        // initial empty from-cache snapshot and the server sync never
        // arrives, which looks like "empty pages with zero errors"
        // (the AGL-217 mystery). Real traffic keeps the default transport
        // and persistent cache — except a WebDriver-controlled Chrome
        // against a real backend, which forces long-polling for the same
        // reason without giving up the cache (see `isAutomatedChromeSession`
        // below).
        //
        // ⚠️ CONSEQUENCE, and it will cost you hours if you do not know it
        // (AGL-1066): every stale-session/stale-cache fault is UNREPRODUCIBLE
        // locally through the app, because the cache that causes them is off
        // in exactly the configuration you would reach for to reproduce one.
        // A listener that keeps serving arbitrarily-old data while the server
        // refuses it, a `noDocument` tombstone that 404s a live host, the
        // retry budget that never spends because a cached emission resets it
        // — none of them can happen here. Test that behaviour with the unit
        // seams instead (`use-firestore-collection-cached-retry.spec.ts`
        // drives cached emissions and denials directly), or against a
        // deployed environment. Do NOT "fix" it by turning the cache on for
        // the emulator: the AGL-217 empty-pages-with-zero-errors mystery is
        // what that produces.
        initializeFirestore(
          app,
          FIREBASE_FIRESTORE_EMULATOR_ENABLED
            ? { experimentalForceLongPolling: true }
            : {
                // NOT unconditional (AGL-1456). `persistentLocalCache` writes
                // document bodies to this origin's IndexedDB, so on a custom
                // console domain it is the same exposure D6 removed from the
                // refresh token — see `firestore-cache.ts` for why one
                // declaration governs both.
                localCache: localCacheFor(authPersistence),
                // The real-backend half of the AGL-217 mitigation above: force
                // long-polling for a WebDriver-controlled Chrome even when it
                // is NOT talking to the emulator, because the WebChannel wedge
                // is a property of automated Chrome, not of which backend it
                // is automating against. Never true for a real visitor, so
                // production traffic keeps the SDK's own auto-detected
                // transport untouched.
                ...(isAutomatedChromeSession()
                  ? { experimentalForceLongPolling: true }
                  : {}),
              },
        )
        if (FIREBASE_FIRESTORE_EMULATOR_ENABLED) {
          connectFirestoreEmulator(getFirestore(app), 'localhost', 8082)
        }
      } catch {
        // already initialized (e.g. HMR reset the module flag) — getFirestore() returns the existing instance
      } finally {
        firestoreInitialized.add(appName)
      }
    }
    const firestore = getFirestore(app)

    if (!connectedDatabase) {
      try {
        if (FIREBASE_DATABASE_EMULATOR_ENABLED) {
          connectDatabaseEmulator(database, 'localhost', 9000)
        }
        connectedDatabase = true
      } catch (error) {
        console.error(error)
      }
    }
    if (!connectedAuth) {
      try {
        if (FIREBASE_AUTH_EMULATOR_ENABLED) {
          connectAuthEmulator(auth, 'http://localhost:9099')
        }
        connectedAuth = true
      } catch (error) {
        console.error(error)
      }
    }
    // App Check must be skipped under the emulators: there is no App
    // Check emulator, so ReCaptcha would hit the real backend and its
    // 403s break emulator auth (the AGL-216 emulator sessions hit this).
    if (
      !FIREBASE_AUTH_EMULATOR_ENABLED &&
      !FIREBASE_FIRESTORE_EMULATOR_ENABLED
    ) {
      // No site key means no provider (AGL-2049). Registering one built on
      // `undefined` does not throw — it fails asynchronously inside the SDK,
      // where the catch below cannot see it — so this has to be a pre-check.
      const siteKey = appCheckSiteKey()
      if (!siteKey) {
        console.warn(APP_CHECK_KEY_MISSING_MESSAGE)
      } else {
        try {
          initializeAppCheck(app, {
            provider: new ReCaptchaV3Provider(siteKey),
            isTokenAutoRefreshEnabled: true,
          })
        } catch (error) {
          console.error(error)
        }
      }
    }
    // `initializeAnalytics`, not `getAnalytics`, for exactly one reason: it is
    // the only form that can pass `config`, and `send_page_view: false` is the
    // only way to stop the SDK's own startup `page_view` (AGL-1643).
    //
    // Booting Analytics issues `gtag('config', <id>, configProperties)`, and
    // the vendored SDK's own comment on that line reads "This will trigger a
    // page_view event unless 'send_page_view' is set to false in
    // configProperties". `getAnalytics(app)` passes no config at all, so the
    // key was never there and the hit always fired — on top of the manual
    // `page_view` the console's layout sends on mount. Two hits, one page.
    //
    // The SDK's is the one suppressed rather than the layout's, and the
    // direction is the whole decision: the SDK fires ONCE per document load,
    // while the layout fires on mount AND on every `usePathname` change. In a
    // client-routed app the layout's is a superset — killing it instead would
    // have left every in-app navigation unreported, halving console pageviews
    // rather than correcting them, and the reports would have looked fine.
    //
    // Nothing else about attribution moves: the surviving hit is sent from the
    // same document at mount, so `document.referrer` — which gtag resolves for
    // `page_referrer` itself, and which is what carries marketing traffic
    // source into the session — is still the external referrer at that moment.
    //
    // Re-entry is safe *only* while the options match. `initializeAnalytics`
    // returns the existing instance when they deep-equal the first call's and
    // throws `already-initialized` otherwise — and the options can be made to
    // differ by things no call site here controls (AGL-1979):
    //
    //   * anything that touches the analytics provider WITHOUT options first
    //     initializes it with `{}`. `getAnalytics()` is the obvious one, but
    //     `@firebase/remote-config` reaches the same code path on its own —
    //     `addExperimentToAnalytics` calls `analyticsProvider.getImmediate({
    //     optional: true })`, and `optional` only suppresses the throw, it
    //     does not stop the initialization.
    //   * in dev, a module instance carrying a PREVIOUS version of these
    //     options (this config changed under AGL-1857) surviving a Fast
    //     Refresh alongside the new one.
    //
    // Once that happens the conflict is permanent for the document: every
    // later call throws, so without the fallback below `analytics` stayed
    // undefined forever and the next consumer — `logEvent(analytics, …)` —
    // read `.app` off it and threw a TypeError two frames away, which is how
    // this surfaced (top Cloud Error Reporting group, and reproduced live on
    // app.aglyn.com).
    //
    // `getAnalytics(app)` is the remedy the SDK's own error message names. It
    // cannot cost us the config on a healthy document: it only runs after
    // `initializeAnalytics` threw, and on a first init that throw can only be
    // `no-app-id` / `no-api-key` / `already-exists`, none of which
    // `getAnalytics` can rescue either — it re-throws and we fall through to
    // an undefined instance, which every consumer must now tolerate.
    // `content_group: 'console'` (AGL-1857) rides the same config: it is the
    // first-class GA4 axis that separates console traffic from `marketing`
    // (stamped by the tenant runtime on aglyn.com's own tag) and `docs`
    // (stamped by the Docusaurus head snippet) in standard reports, without
    // reaching for the Hostname dimension. The console is this provider's
    // only consumer, verified by grep — the tenant runtime builds its tag in
    // `site-analytics.tsx` and never passes through here.
    //
    // AND NOT AT ALL outside a real production deployment (AGL-2067). This
    // provider used to boot Analytics unconditionally, while
    // `apps/console/.env.development.local` points at the PRODUCTION
    // measurement id — so every `next dev` session and every Vercel preview
    // build produced genuine `session_start` / `first_visit` / `page_view`
    // hits in the live property. Not a theory: the archived Marketing
    // property's entire year-to-date history is 30 views / 6 users, ~24 of
    // them `/signin` on preview urls (docs/ANALYTICS.md).
    //
    // Not initialized rather than initialized-and-suppressed, because a
    // resident tag reports on its own — AGL-1608 is the same lesson from the
    // consent side. `useAnalytics()` returning undefined is already a
    // supported state everywhere (AGL-1979), which is what makes this a
    // two-line gate instead of an audit.
    //
    // `analyticsMayEmit` leans LOUD on an unknown deployment: a self-hosted
    // build points at the operator's own Firebase project and their own GA
    // property, and silencing a customer's analytics to protect ours is the
    // worse failure. See the module for the escape hatch.
    //
    // AND NOT while a registered consent gate says no (AGL-1498 posture,
    // applied to Aglyn's own console). `analyticsForConsentState` is where
    // both conditions and the boot itself now live, because the boot has to
    // be repeatable: a visitor whose region has not resolved yet is undecided
    // at this instant and may be granted a moment later, and a visitor who
    // withdraws mid-session has to lose the instance without the page
    // reloading. See the effect below.
    //
    // SCOPE. This is the console's tag and only the console's:
    // `CONSOLE_ANALYTICS_OPTIONS`, `content_group: 'console'`, and this
    // provider's analytics branch has no other consumer (the tenant runtime
    // builds its tag in `site-analytics.tsx` and never passes through here).
    // Customer sites keep the AGL-1498 gate and the host's own
    // `consent.mode`; nothing here reaches them.
    const initialAnalytics = analyticsForConsentState(app)
    // Remote Config (AGL-228): release-flag delivery. Browser-only like
    // analytics; consumers set defaultConfig before their first getValue so
    // gating never blocks on the network.
    let remoteConfig: RemoteConfig
    try {
      remoteConfig = getRemoteConfigInstance(app)
      remoteConfig.settings.minimumFetchIntervalMillis =
        process.env.NODE_ENV === 'production' ? 3_600_000 : 60_000
    } catch (error) {
      console.error(error)
    }

    servicesRef.current = {
      app,
      firestore,
      auth,
      database,
      storage: getStorageInstance(app),
      analytics: initialAnalytics,
      remoteConfig,
      authPersistence,
    }
  }

  const services = servicesRef.current

  // The consent gate's other half: the verdict can CHANGE within one document,
  // in both directions, and everything else in this provider is built exactly
  // once by design.
  //
  // Deferred grant. A visitor with no stored record is undecided at the
  // instant this provider first renders, because resolving them needs the
  // region endpoint and that is a network call. Outside the prior-consent
  // regions the answer is implied consent, and it lands a few hundred
  // milliseconds later — same document, so `document.referrer` is still the
  // external referrer and the pageview's attribution is unaffected. Without
  // this, "the gate is synchronous" would have quietly meant "the rest of the
  // world is never measured on a first visit".
  //
  // Withdrawal. Dropping the instance unmounts every binding hung off it,
  // which is what unregisters the analytics transport — after that
  // `deliver()` falls through to `window.gtag`, and the shared consent writer
  // has already set `ga-disable-<id>` and sent a denied `consent update` on
  // that exact tag (AGL-1608). The resident tag cannot be unloaded; it can be
  // made to send nothing, and both halves are needed because either alone
  // leaks — enhanced measurement fires with no call site at all.
  const [analytics, setAnalytics] = useState<Analytics | undefined>(
    () => services.analytics,
  )
  useEffect(() => {
    const sync = () => setAnalytics(analyticsForConsentState(services.app))
    // Once on mount as well as on the event: the priming pass can resolve a
    // visitor between this provider's render and this effect, and the event it
    // dispatched then had no listener yet.
    sync()
    window.addEventListener(VISITOR_CONSENT_CHANGED_EVENT, sync)
    return () =>
      window.removeEventListener(VISITOR_CONSENT_CHANGED_EVENT, sync)
  }, [services])

  // Identity changes only when the tag comes or goes, so a consent-stable
  // document re-renders nothing.
  const value = useMemo(
    () =>
      services.analytics === analytics ? services : { ...services, analytics },
    [services, analytics],
  )

  return (
    <FirebaseServicesContext.Provider value={value}>
      {children}
    </FirebaseServicesContext.Provider>
  )
}
FirebaseServicesProvider.displayName = 'FirebaseServicesProvider'

function useFirebaseServices(): FirebaseServices {
  const services = useContext(FirebaseServicesContext)
  if (!services) {
    throw new Error(
      'Firebase hooks must be used within a <FirebaseServicesProvider>',
    )
  }
  return services
}

export function useFirebaseApp(): FirebaseApp {
  return useFirebaseServices().app
}
export function useFirestore(): Firestore {
  return useFirebaseServices().firestore
}
export function useAuth(): Auth {
  return useFirebaseServices().auth
}
/**
 * The persistence class the provider's `Auth` was created with (AGL-1379).
 *
 * Read it — never re-derive it — when building a **second** Firebase app on
 * the same origin, so the second instance cannot end up more persistent than
 * the first. `apps/console/hooks/use-presence.ts` is the existing case.
 */
export function useAuthPersistence(): AuthPersistenceClass {
  return useFirebaseServices().authPersistence
}
export function useDatabase(): Database {
  return useFirebaseServices().database
}
export function useStorage(): FirebaseStorage {
  return useFirebaseServices().storage
}
export function useAnalytics(): Analytics {
  return useFirebaseServices().analytics
}
export function useRemoteConfig(): RemoteConfig {
  return useFirebaseServices().remoteConfig
}

/**
 * Replaces reactfire's `useUser()`. Reactfire subscribes via
 * `onIdTokenChanged` rather than `onAuthStateChanged` so fields like
 * `emailVerified` stay live across token refresh (e.g. after
 * `user.reload()` post-email-verification), not just sign-in/out — matched
 * here for behavioral parity.
 *
 * THREE states, not two (AGL-1261): `undefined` = auth has not resolved yet,
 * `null` = resolved, signed OUT, a `User` = resolved, signed in. This used to
 * collapse the emitted `null` into `undefined`, which made "signed out" and
 * "still loading" the same value — a state that, for a signed-out visitor,
 * never left "loading". `useSessionCookie` gates its whole body on
 * `user === undefined`, so its silent restore from the shared `__session`
 * cookie could never run: the cookie exchange returned a valid custom token
 * and nothing ever asked for it.
 */
export function useUser(): { data: User | null | undefined } {
  const auth = useAuth()
  const [user, setUser] = useState<User | null | undefined>(
    auth.currentUser ?? undefined,
  )

  useEffect(() => {
    return onIdTokenChanged(auth, (nextUser) => {
      // `?? null`, never `?? undefined` — see the note above.
      setUser(nextUser ?? null)
    })
  }, [auth])

  return { data: user }
}

export interface SigninCheckResult {
  signedIn: boolean
  user: User | null
}

/** Replaces reactfire's `useSigninCheck()` — same `onIdTokenChanged` basis as `useUser()`. */
export function useSigninCheck(): {
  status: 'loading' | 'success' | 'error'
  data: SigninCheckResult | undefined
  error: Error | undefined
} {
  const auth = useAuth()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [data, setData] = useState<SigninCheckResult | undefined>(undefined)
  const [error, setError] = useState<Error | undefined>(undefined)

  useEffect(() => {
    return onIdTokenChanged(
      auth,
      (user) => {
        setStatus('success')
        setError(undefined)
        setData({ signedIn: !!user, user: user ?? null })
      },
      (err) => {
        setStatus('error')
        setError(err)
      },
    )
  }, [auth])

  return { status, data, error }
}
