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
  fbClientAppOptions,
  FIREBASE_CLIENT_APP_NAME,
  FirebaseServicesProvider,
  setAnalyticsConsentGate,
  setFirestoreSessionReporters,
  setStaleSessionCheck,
  useAnalytics,
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  hydratePlatformConsentFromMirror,
  platformAnalyticsAllowed,
  primePlatformConsent,
  setPlatformConsentSharesAcrossSubdomains,
} from '@aglyn/aglyn/app-utils/platform-visitor-consent'
import { configureAnalyticsTransport } from '@aglyn/aglyn/app-utils/analytics-events'
import { analyticsEnvironmentForcesInternal } from '@aglyn/aglyn/app-utils/analytics-environment'
import { NoSsr } from '@mui/material'
import {
  type Analytics,
  logEvent,
  setUserId,
  setUserProperties,
} from 'firebase/analytics'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { currentOriginPersistenceClass } from '../../constants/workspace-domain'
import { OrgPermissionsProvider } from '../../hooks/use-org-permissions'
import { OrgScopeProvider } from '../../hooks/use-org-scope'
import { useUrlNamedOrg } from '../../hooks/use-url-names-org'
import { useOrgPlans } from '../../hooks/use-org-plans'
import { buildOrgUserProperties } from '../../utils/analytics-user-properties'
import BootSplash from '../boot-splash.component'
import useSessionCookie from '../../hooks/use-session-cookie'
import {
  buildConsolePageTitle,
  buildConsolePageViewParams,
} from '../../utils/page-view-params'
import { setAnalyticsDefaultParams } from '../../utils/analytics-default-params'
import { ReleaseFlagsProvider } from '../../hooks/use-release-flags'
import {
  getSessionHealth,
  reportDeniedRead,
  reportSuccessfulRead,
} from '../../utils/session-health'
import { watchSessionHeal } from '../../utils/session-heal'
import useCrossTabSessionHeal from '../../hooks/use-cross-tab-session-heal'
import {
  INTERNAL_TRAFFIC_PARAM,
  INTERNAL_TRAFFIC_VALUE,
  isInternalTrafficSession,
  readInternalTrafficOverride,
} from '../../utils/internal-traffic'

/**
 * Let listeners feed the stale-session verdict (AGL-1066).
 *
 * `session-health` lives in the app and the listener hooks live in the
 * library, so the library cannot import it — this is the registration side
 * of that seam. Done at module scope rather than in an effect because a
 * listener can be refused before any effect has run, and a denial that
 * arrives before the reporter exists is simply lost.
 *
 * Only the console registers one. The tenant runtime has no client
 * Firestore at all, so its reporter stays null and every report is a no-op.
 */
setFirestoreSessionReporters({
  onDenied: reportDeniedRead,
  onServerRead: reportSuccessfulRead,
})

/**
 * The same seam in the other direction, for `writeGuardedBySeed` (AGL-1358).
 *
 * The guard had to move into the library, because most of the write sites
 * wearing the stale-seed shape are plugin cards that cannot import from the
 * app. Its first two signals (`unreadable`, `fromCache`) come from the
 * caller's own listener; only the third is console state, so the console
 * hands it over here rather than the library reaching for it.
 *
 * Module scope, not an effect: a save can be clicked before any effect has
 * run, and a guard consulting a check that does not exist yet quietly loses
 * a signal. Unregistered is not a failure mode — it reports "not stale", and
 * the two signals that actually carry this guard are untouched.
 */
setStaleSessionCheck(() => getSessionHealth().staleSession)

/**
 * And the return leg: refused listeners learn the session came back
 * (AGL-1066).
 *
 * Module scope for a different reason than the two above — not because it
 * could be needed early, but because there is nothing to mount it on. The
 * whole point is that the page tree does NOT remount across an AGL-664
 * re-auth, so a component-scoped watcher would be watching from inside the
 * thing whose survival is the problem. See `utils/session-heal` for why the
 * re-auth store's falling edge is the signal and a token event is not.
 */
watchSessionHeal()

/**
 * The visitor-consent gate for this surface, and the reason the console's
 * asymmetry with the tenant runtime is now closed.
 *
 * The tenant registers no transport at all: its events fall through to
 * `window.gtag`, which only exists once the visitor has granted consent
 * (AGL-1498), so the gate is structural there for free. Firebase owns this
 * surface's GA state instead, and it used to initialize unconditionally — so
 * `app.aglyn.com` collected from every visitor, including the sign-in page,
 * regardless of whether they had ever been asked anything. The region-scoped
 * consent-mode default (AGL-1597) narrowed what the tag could STORE and never
 * stopped it loading, which is the specific thing prior-consent law prohibits.
 *
 * Registering a gate here makes it structural on this surface too: the
 * provider does not create the Analytics instance while this answers no, so
 * gtag.js is never fetched and the fallback in `deliver()` finds no
 * `window.gtag` to hand a hit to.
 *
 * Module scope, and that is not a style choice — the provider consults this
 * during its FIRST render, so a gate installed from an effect would arrive
 * after the decision it exists to make. Same reason as the three
 * registrations above.
 *
 * The verdict itself is a synchronous storage read, because it has to be
 * answerable at that instant. A visitor with no record yet is undecided and
 * gets no tag; `primePlatformConsent` below starts the region lookup that
 * resolves them, and outside the prior-consent regions it records implied
 * consent and the provider boots the tag a moment later, in the same document.
 */
/**
 * One console, several hostnames — so a visitor's answer has to travel between
 * them.
 *
 * `app.<workspace domain>` and `auth.<workspace domain>` are the same
 * application: `auth` is a reserved label served by this deployment, and
 * interactive sign-in is DELEGATED there for mobile visitors and for every
 * workspace subdomain, so a person can answer the consent question on one and
 * arrive on the other a moment later. `localStorage` is per origin, which
 * makes those two answers invisible to each other — harmless for an accept
 * (they are asked twice), and not harmless at all for a refusal: outside the
 * prior-consent regions the sibling host finds no record and writes `implied`
 * from the posture, quietly overturning an opt-out the visitor did make.
 *
 * `currentOriginPersistenceClass()` is the right question already answered
 * elsewhere: `durable` means the whole registrable domain is ours, which is
 * exactly the condition under which a `.<domain>` cookie is ours to write. A
 * CUSTOM console domain answers `ephemeral` and gets no mirror — it has no
 * sibling console origin to carry to, and its registrable domain belongs to
 * the customer.
 *
 * Hydrated at module scope, before the gate below reads storage for the first
 * time. The reader itself stays a pure read for the reason the gate is
 * synchronous at all: it is consulted from inside the services provider's
 * render, and a read with a storage write in it would repeat that write on
 * every consent change forever.
 */
setPlatformConsentSharesAcrossSubdomains(
  currentOriginPersistenceClass() === 'durable',
)
hydratePlatformConsentFromMirror()

setAnalyticsConsentGate(platformAnalyticsAllowed)

/**
 * Start resolving this visitor before React commits anything.
 *
 * The consent component's effect does this too and is the normal path. It is
 * not enough on its own for the same reason `ErrorBeacon` installs at module
 * scope: an effect only runs if React commits, and a console wedged above this
 * tree would leave a rest-of-world visitor permanently undecided — which reads
 * as "we stopped measuring" rather than as the fault it is. Idempotent per
 * pageview and fire-and-forget.
 */
primePlatformConsent()

function AnalyticsGlobalEvents({ children }) {
  // Cross-subdomain session cookie sync (AGL-236). NOT analytics, and it must
  // run whether or not Firebase Analytics came up — so it stays out here.
  useSessionCookie()
  /*
   * The sibling tab's heal (AGL-2486). Component scope rather than module
   * scope, unlike `watchSessionHeal` above, and for the opposite reason: this
   * watches a tab that is NOT re-authenticating, so the tree it lives in is
   * exactly the one that stays mounted throughout. It needs an `Auth`
   * instance, which module scope has none of.
   */
  useCrossTabSessionHeal()
  const analytics = useAnalytics()

  // ONE gate for every Firebase Analytics binding in this app (AGL-1979).
  //
  // `useAnalytics()` is typed as always returning an `Analytics`, and
  // strictNullChecks is off repo-wide, so nothing has ever forced a call site
  // to consider that it can be undefined — which it is whenever
  // `initializeAnalytics` failed in the services provider. `logEvent(undefined,
  // …)` reads `.app` off it and throws a TypeError out of an effect, which was
  // the top group in Cloud Error Reporting and is still firing on
  // app.aglyn.com.
  //
  // Guarding each call site is what was tried first (526608b9) and it is why
  // this is the second fix: the transport registration got a guard and the
  // four `logEvent`/`setUserId`/`setUserProperties` sites beneath it did not.
  // A gate on the MOUNT cannot be half-applied — every binding lives in the
  // child, so a new one is guarded by construction rather than by remembering.
  //
  // Not a hook-order hazard, though it is no longer a constant either: the
  // instance now comes and goes with the visitor's consent, and mounting or
  // unmounting a CHILD is the one form of conditional rendering that costs
  // nothing to reason about. Every hook stays in this component.
  return (
    <>
      {analytics ? <AnalyticsBindings analytics={analytics} /> : null}
      {/*
        The other side of the same gate, and it is not the same as rendering
        nothing.

        With no instance the bindings unmount and their transport
        registration is torn down — after which `deliver()` in
        `analytics-events.ts` falls back to `window.gtag`. On this surface
        that global is REAL: the Firebase SDK injects gtag.js, and unloading
        a script is not something a page can do, so a visitor who withdraws
        mid-session leaves a live tag behind and our own `trackEvent` call
        sites would keep feeding it. `storeVisitorConsent` sets
        `ga-disable-<id>` and sends a denied `consent update` on that tag,
        which is the half that reaches Google's own code — this is the half
        that stops the hits leaving ours, and neither one covers the other.

        Mounted only when consent is actually WITHHELD, never merely because
        there is no instance. Unregistered is the honest state for a surface
        whose tag failed to initialize or whose build may not emit
        (AGL-1516); swallowing events there would be a silent total loss with
        nothing to show for it. Withheld consent is the one case where
        dropping is the correct delivery.
      */}
      {!analytics && !platformAnalyticsAllowed() ? <AnalyticsRefusal /> : null}
      {children}
    </>
  )
}

/**
 * Every Firebase Analytics binding the console has. Mounted only when there is
 * a real `Analytics` instance to bind to — see the gate above.
 */
function AnalyticsBindings({ analytics }: { analytics: Analytics }) {
  const pathname = usePathname()
  const user = useUser()

  // Route the shared event taxonomy (AGL-1561) through Firebase rather than
  // `window.gtag`. Firebase owns this surface's GA state — the `user_id` and
  // user properties set below live on the Analytics instance, and a hit poked
  // straight into `window.gtag` would miss them, arriving unattributed to any
  // user. Registered here because this component already holds the instance
  // and wraps the whole app, so it runs before any call site can fire.
  //
  // The tenant runtime deliberately registers nothing: its events fall
  // through to `window.gtag`, which only exists once the visitor has granted
  // consent (AGL-1498), making the gate structural there.
  useEffect(() => {
    // Registering a transport that cannot deliver is WORSE than registering
    // none (AGL-1516 beacon, top error group), which is the sharpest reason
    // the mount gate above exists. `deliver()` swallows a throwing transport
    // ("analytics never breaks the page") — but it swallows it AFTER having
    // taken the transport branch and returned, so the `window.gtag` fallback
    // underneath is never reached. That is not a degraded surface, it is a
    // silent TOTAL loss of console analytics for exactly the visitors whose
    // browsers are hostile to Firebase, reported as zero events rather than
    // as an error. Sept 1 activation and funnel numbers are read off this
    // taxonomy.
    //
    // Unregistered is the honest state: `deliver()` falls through to
    // `window.gtag`, which is what every other surface uses.
    configureAnalyticsTransport((name, params) => {
      // `logEvent`'s overloads type each reserved name individually, so the
      // shared taxonomy's union has to be widened past them here. The typing
      // that matters already happened at the call site, in `trackEvent`.
      //
      // RETURNED, not discarded (AGL-1580). `logEvent` is async: it awaits the
      // SDK's initialization promise before the hit reaches gtag, so while that
      // promise is still pending the call site's `window.location.assign` tears
      // the document down before gtag is ever called and the event is lost
      // outright. Handing the promise back is what lets
      // `trackEventBeforeNavigation` wait for it. Nothing else about delivery
      // changes — `trackEvent` still ignores it and stays fire-and-forget.
      return (
        logEvent as (...args: unknown[]) => Promise<void>
      )(analytics, name, params)
    })
    return () => configureAnalyticsTransport(null)
  }, [analytics])

  // Stamp `traffic_type: 'internal'` on our own sessions (AGL-1582), so GA4's
  // built-in internal-traffic filter can keep staff browsing out of the launch
  // metrics. At beta scale a handful of our sessions is a large fraction of
  // total traffic, and GA4 data filters are NOT retroactive — an event that
  // ships unstamped is unstamped forever.
  //
  // Default event parameters rather than a param threaded through
  // `trackEvent`: the filter matches per EVENT, and the events that would leak
  // are exactly the ones no call site writes — `page_view` below, plus the
  // `session_start` / `first_visit` / `user_engagement` that the SDK sends on
  // its own. This is the one API that rides "every event logged from the SDK,
  // including automatic ones".
  //
  // The predicate follows the ACTOR, not the subject. Impersonation (AGL-246)
  // mints a token for the TARGET account, and staff accounts cannot be
  // impersonated — so `claims.staff` is false for the whole session and
  // `impersonatedBy` is the only thing separating a staff member driving a
  // customer's workspace from the customer. Keying on `staff` alone would have
  // flagged none of it, which is the traffic AGL-1582 most wants excluded.
  //
  // Cleared explicitly on the negative branch. The console deliberately does
  // not remount across a re-auth (AGL-664), so a staff session followed by a
  // customer signing in on the same document would otherwise keep the stamp
  // and quietly delete a real user from every report.
  //
  // Reads the CACHED token — no forced refresh. This is reporting hygiene, not
  // a security boundary (`useIsStaff` pays for the refresh where the answer
  // gates UI), so a claim up to an hour stale costs at worst one mis-bucketed
  // session. Failure is treated as NOT internal for the same asymmetry:
  // wrongly flagging a real user erases them from the metrics, while missing
  // one of ours leaves a session the IP rule is the secondary net for.
  //
  // ## The browser-pinned override, OR'd in (AGL-2065)
  //
  // The claims predicate covers staff and impersonation and deliberately
  // covers nothing else — but several release drills REQUIRE a non-staff
  // account (the marketplace publisher drill cannot be run by staff at all),
  // and those sessions emit the activation and revenue events the September
  // funnel is read from. `readInternalTrafficOverride` answers a different
  // question — "is this BROWSER ours" — set once with `?aglyn_internal=1` and
  // remembered in localStorage for that origin.
  //
  // OR'd into the parameter every write already computes, rather than written
  // by a second caller, and that is the load-bearing detail twice over. The
  // negative branch clears the parameter explicitly (the console does not
  // remount across a re-auth, AGL-664), so an override set separately would be
  // wiped the moment the token resolved to a customer — the exact session it
  // exists for. And the underlying SDK call ASSIGNS rather than merges before
  // gtag is wrapped (AGL-2087), so a second caller is a race as well as a
  // logic error. See `stamp` below.
  useEffect(() => {
    // `analyticsEnvironmentForcesInternal` (AGL-2067) is the escape hatch's
    // other half: a non-production build only reaches this component at all
    // when someone deliberately turned analytics back on for it, and such a
    // build is ours by definition — so it stamps unconditionally rather than
    // waiting to be opted in, and the hatch cannot become the leak it stands
    // beside.
    const override =
      readInternalTrafficOverride() || analyticsEnvironmentForcesInternal()

    // ONE call site for this parameter, and it is a shared invariant rather
    // than a tidiness preference. `@firebase/analytics`:
    //
    //   function setDefaultEventParameters(customParams) {
    //     if (wrappedGtagFunction) wrappedGtagFunction('set', customParams)
    //     else _setDefaultEventParametersForInit(customParams)  // ASSIGNMENT
    //   }
    //
    // Before gtag is wrapped it REPLACES the pending default set instead of
    // merging into it, so two callers racing during boot means whichever
    // loses silently drops the other's params. Dropping `traffic_type` puts
    // our own browsing back into the launch metrics, irreversibly — a GA4
    // data filter is not retroactive.
    //
    // Which is why this writes through `setAnalyticsDefaultParams` rather
    // than the SDK directly (AGL-2087). One call site inside THIS effect is
    // not enough once a second concern wants the same API — `page_title`
    // does, from the `page_view` effect below — because the collision is
    // between effects, not within one. The owner in
    // `utils/analytics-default-params.ts` keeps the composed set and re-sends
    // all of it, so neither concern can drop the other's keys, and a third
    // cannot either.
    const stamp = (internal: boolean) =>
      setAnalyticsDefaultParams({
        [INTERNAL_TRAFFIC_PARAM]: internal ? INTERNAL_TRAFFIC_VALUE : undefined,
      })

    // Applied on the best answer available RIGHT NOW, before the token read.
    // This effect is declared above the `page_view` effect and React runs
    // effects in declaration order, so an overridden browser stamps its own
    // cold-load pageview. The claims half keeps AGL-1582's accepted first-hit
    // race — a token read cannot be made synchronous.
    stamp(override)

    const account = user?.data as
      | {
          getIdTokenResult?: (
            forceRefresh?: boolean,
          ) => Promise<{ claims?: Record<string, unknown> } | undefined>
        }
      | undefined
    if (!account?.getIdTokenResult) return

    let active = true
    void Promise.resolve(account.getIdTokenResult())
      .then((result) => {
        if (!active) return
        stamp(override || isInternalTrafficSession(result?.claims))
      })
      .catch(() => {
        // Unreadable claims are treated as NOT internal, but the override is
        // knowledge we already have and never loses it.
        if (active) stamp(override)
      })
    return () => {
      active = false
    }
  }, [user])

  // Page-view analytics (AGL-118). The Pages Router `router.events` API has
  // no App Router equivalent, so fire on `usePathname` changes instead; route
  // errors are now surfaced by error.tsx boundaries rather than an event.
  //
  // `page_location` is a full URL and no longer the bare pathname (AGL-1643);
  // `buildConsolePageViewParams` holds the why and is spec'd against it.
  //
  // `page_title` is passed EXPLICITLY (AGL-2060) rather than left for the SDK
  // to read off `document.title` at hit time. The notifications menu writes a
  // live unread counter into that title, so GA4 was splitting one console page
  // into a row per unread count. The builder strips it with the same helper
  // that writes it; read here, at hit time, because the badge and the route's
  // own metadata both land on `document.title` and only it has both.
  //
  // Read off `window.location` rather than rebuilt from `pathname`, because
  // only the browser knows the host, and the App Router has already committed
  // the new URL to `history` by the time this effect runs. `pathname` stays as
  // the DEPENDENCY — it is what changes on a client-side navigation.
  //
  // This effect is now the console's ONLY `page_view`. The Firebase SDK's own
  // startup one is suppressed with `send_page_view: false` where Analytics is
  // initialized, because that hit fires once per document load while this one
  // fires on mount AND on every route change — so this is the superset, and
  // suppressing it instead would have halved console pageviews silently.
  //
  // Deliberately NOT re-fired on a query-string-only navigation: `usePathname`
  // does not change for one, so a paginated or filtered view does not report
  // again. That is a choice, not an oversight — an event per filter change
  // would burn the per-session event budget for a breakdown nobody reads.
  //
  // Still `logEvent` rather than `trackEvent`: `page_view` is deliberately
  // outside the `AnalyticsEventParams` union — no call site writes it, so
  // there are no keys for the compiler to settle, and adding it would put a
  // name in the taxonomy that the taxonomy does not govern.
  //
  // ## The same title also rides EVERY other hit (AGL-2087)
  //
  // An explicit param fixes `page_view` and nothing else. gtag builds
  // `page_title` from `document.title` for every hit it assembles, so the
  // badge still reached the two raw `screen_view` calls (`hosts/[host]/setup`,
  // `manage/user` — their own `firebase_screen` params are authored strings
  // and were never the problem) and the `session_start` / `first_visit` /
  // `user_engagement` the SDK sends with no call site at all.
  //
  // `setAnalyticsDefaultParams` is how that is closed, and the indirection is
  // the entire point: the raw `setDefaultEventParameters` REPLACES the pending
  // default set during boot rather than merging into it, so a second caller
  // added here would have silently dropped the `traffic_type` stamp set by the
  // effect above — un-excluding our own traffic from metrics no data filter
  // can repair afterwards. One owner composes both keys into one object; see
  // `utils/analytics-default-params.ts`.
  //
  // Refreshed here rather than in an effect of its own because this one
  // already runs on mount and on every route change, which is when the title
  // changes for any reason other than the badge — and the badge is precisely
  // what is being stripped out. `undefined` on an empty title, matching the
  // builder's omission rule.
  //
  // Set BEFORE the event, though the ordering is not load-bearing: an
  // explicit param beats a default, so `buildConsolePageViewParams` still
  // decides this hit's own `page_title`.
  useEffect(() => {
    if (typeof window === 'undefined') return
    setAnalyticsDefaultParams({
      page_title: buildConsolePageTitle(document.title) || undefined,
    })
    logEvent(
      analytics,
      'page_view',
      buildConsolePageViewParams(window.location.href, document.title),
    )
  }, [pathname, analytics])

  // Org-scoped user properties (AGL-1852): `org_plan` and `org_role` for the
  // ACTIVE workspace, which is what lets any report or audience split by who
  // pays. The plan comes through `useOrgPlans` — the org switcher's reader —
  // so the two semantics that matter are inherited rather than re-derived:
  // an enterprise override reads "enterprise", and a doc with no `plan`
  // field means FREE (only paid plans are webhook-written).
  //
  // `buildOrgUserProperties` owns the clearing rule and is pinned by
  // `analytics-user-properties.spec.ts`: every unknown — no org scope, plan
  // still loading, read failed — resolves to an explicit null (Firebase's
  // "unset"), never a stale carry-over. GA user properties persist until
  // overwritten and this document survives re-auth (AGL-664), so the
  // failure mode of a missing clear is the PREVIOUS session's tier reported
  // against a new user's behaviour. Same discipline as the traffic_type
  // stamp above.
  //
  // The workspace is the one the URL NAMES (AGL-2486). This used to read
  // `useOrgScope().currentOrg` directly, and that never goes null off an
  // org route — it falls back to a remembered selection and then the user's
  // first org — so the "no org scope" branch `buildOrgUserProperties`
  // documents and `analytics-user-properties.spec.ts` pins was UNREACHABLE
  // from here. Browsing the staff console or sitting on the workspace picker
  // reported the fallback org's tier and role against that behaviour, which
  // is precisely the "who pays" split these properties exist to make
  // trustworthy. Stamping a workspace onto a session is a claim, not an
  // action, so it follows the claim rule.
  const urlNamedOrg = useUrlNamedOrg()
  const activeOrgId = urlNamedOrg?.$id
  const orgPlans = useOrgPlans(activeOrgId ? [activeOrgId] : [])
  useEffect(() => {
    setUserProperties(
      analytics,
      buildOrgUserProperties({
        orgId: activeOrgId,
        role: urlNamedOrg?.role,
        plan: activeOrgId ? orgPlans[activeOrgId] : undefined,
      }),
    )
  }, [analytics, activeOrgId, urlNamedOrg, orgPlans])

  useEffect(() => {
    // tenantId here is Firebase Auth's own GCIP multi-tenancy field on the
    // user object — unrelated to Aglyn's retired tenant naming (AGL-445).
    const { uid, emailVerified, providerId, tenantId } = user?.data || {}
    const setAnalyticsUserId = () => {
      setUserId(analytics, uid)
    }
    const setAnalyticsUserProperties = () => {
      setUserProperties(analytics, {
        emailVerified,
        providerId,
        tenantId,
      })
    }
    if (uid) {
      setAnalyticsUserId()
      setAnalyticsUserProperties()
    }
  }, [analytics, user])

  return null
}
AnalyticsBindings.displayName = 'AnalyticsBindings'

/**
 * The transport a visitor who has NOT granted analytics gets: one that drops
 * the event.
 *
 * Registered rather than left absent, which inverts the AGL-1516 rule on
 * purpose and only here. That rule — "registering a transport that cannot
 * deliver is worse than registering none" — is about a surface whose Firebase
 * tag failed to come up, where the `window.gtag` fallback underneath is a
 * legitimate destination and swallowing events is a silent total loss. For a
 * visitor who has refused, or has not yet been asked, that fallback is not a
 * destination at all: it is the leak.
 *
 * The leak is real rather than theoretical on this surface. gtag.js cannot be
 * unloaded once the SDK has injected it, so a mid-session withdrawal leaves
 * `window.gtag` live and every `trackEvent` call site in the console keeps
 * finding it.
 *
 * Declared BELOW `AnalyticsBindings` so it stays outside the parent's body:
 * `analytics-instance-gate.spec.ts` reads that body and fails on any
 * firebase-analytics or transport call it finds there, which is the property
 * that stops a new binding from landing ungated.
 */
function AnalyticsRefusal(): null {
  useEffect(() => {
    // No instance is captured, so there is nothing to fail with. The event is
    // dropped permanently — never queued for a later grant, which is the
    // shared module's stated posture and the only honest one: a hit replayed
    // after consent describes a pageview the visitor had not consented to.
    configureAnalyticsTransport(() => undefined)
    return () => configureAnalyticsTransport(null)
  }, [])
  return null
}
AnalyticsRefusal.displayName = 'AnalyticsRefusal'

export interface FirebaseAppLayoutProps {
  children?: JSX.Children
}

function FirebaseAppLayout(props: FirebaseAppLayoutProps) {
  const { children } = props

  return (
    // The whole app is client-only, so `NoSsr` renders its fallback for the
    // entire boot window — SSR *and* every render before mount. Without one
    // the browser paints an empty document until hydration finishes, which
    // reads as a broken app on a cold load or a full page navigation
    // (AGL-896). The splash is the honest first frame.
    <NoSsr fallback={<BootSplash />}>
      <FirebaseServicesProvider
        firebaseConfig={fbClientAppOptions}
        appName={FIREBASE_CLIENT_APP_NAME}
        // The origin decides, and it decides HERE (AGL-1099c). The class has
        // to be settled before `initializeAuth` runs, which rules out asking
        // `resolveConsoleDomain` — that is a Firestore read, and this is a
        // constructor argument. `NoSsr` above means this subtree only ever
        // renders in a browser; off-browser resolves to `ephemeral`, the safe
        // answer to "I do not know which origin this is".
        authPersistence={currentOriginPersistenceClass()}
      >
        {/* The org scope wraps the flags provider, not the other way round
            (AGL-1935). `ReleaseFlagsProvider` reads `useCurrentOrg()` for the
            rollout subject and the per-org overrides staff set at
            /admin/orgs (AGL-1635/1656), and `useCurrentOrg` resolves through
            `useOrgScope`. It landed here first (AGL-229) and AGL-236 nested
            the org scope INSIDE it, which left the flags provider reading the
            OrgScopeContext DEFAULT — `currentOrg: null` — forever. React
            gives no signal for that: the console simply resolved every flag
            against a null subject and silently ignored every override. */}
        <OrgScopeProvider>
          {/* Inside the org scope for the same reason the flags provider is:
              it resolves the reader's membership in `useOrgScope().currentOrg`
              and would read the context DEFAULT — no org, forever — mounted
              above it. Above the route groups so the two member reads happen
              ONCE for a page however many surfaces gate on them; the host
              dashboard alone has five consumers. */}
          <OrgPermissionsProvider>
            <ReleaseFlagsProvider>
              <AnalyticsGlobalEvents>{children}</AnalyticsGlobalEvents>
            </ReleaseFlagsProvider>
          </OrgPermissionsProvider>
        </OrgScopeProvider>
      </FirebaseServicesProvider>
    </NoSsr>
  )
}
FirebaseAppLayout.displayName = 'FirebaseAppLayout'
FirebaseAppLayout.aglyn = true

export { FirebaseAppLayout }
export default FirebaseAppLayout
