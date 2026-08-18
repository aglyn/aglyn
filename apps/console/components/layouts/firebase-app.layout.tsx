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
  setFirestoreSessionReporters,
  setStaleSessionCheck,
  useAnalytics,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { configureAnalyticsTransport } from '@aglyn/aglyn/app-utils/analytics-events'
import { analyticsEnvironmentForcesInternal } from '@aglyn/aglyn/app-utils/analytics-environment'
import { NoSsr } from '@mui/material'
import {
  type Analytics,
  logEvent,
  setDefaultEventParameters,
  setUserId,
  setUserProperties,
} from 'firebase/analytics'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { OrgScopeProvider, useOrgScope } from '../../hooks/use-org-scope'
import { useOrgPlans } from '../../hooks/use-org-plans'
import { buildOrgUserProperties } from '../../utils/analytics-user-properties'
import BootSplash from '../boot-splash.component'
import useSessionCookie from '../../hooks/use-session-cookie'
import { buildConsolePageViewParams } from '../../utils/page-view-params'
import { ReleaseFlagsProvider } from '../../hooks/use-release-flags'
import {
  getSessionHealth,
  reportDeniedRead,
  reportSuccessfulRead,
} from '../../utils/session-health'
import { watchSessionHeal } from '../../utils/session-heal'
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

function AnalyticsGlobalEvents({ children }) {
  // Cross-subdomain session cookie sync (AGL-236). NOT analytics, and it must
  // run whether or not Firebase Analytics came up — so it stays out here.
  useSessionCookie()
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
  // Not a hook-order hazard: the provider builds its services exactly once per
  // document, so this condition is a constant for the lifetime of the tree.
  return (
    <>
      {analytics ? <AnalyticsBindings analytics={analytics} /> : null}
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
      ;(logEvent as (...args: unknown[]) => void)(analytics, name, params)
    })
    return () => configureAnalyticsTransport(null)
  }, [analytics])

  // Stamp `traffic_type: 'internal'` on our own sessions (AGL-1582), so GA4's
  // built-in internal-traffic filter can keep staff browsing out of the launch
  // metrics. At beta scale a handful of our sessions is a large fraction of
  // total traffic, and GA4 data filters are NOT retroactive — an event that
  // ships unstamped is unstamped forever.
  //
  // `setDefaultEventParameters` rather than a param threaded through
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
  // exists for. And `setDefaultEventParameters` ASSIGNS rather than merges
  // before gtag is wrapped (AGL-2087), so a second caller is a race as well as
  // a logic error. See `stamp` below.
  useEffect(() => {
    // `analyticsEnvironmentForcesInternal` (AGL-2067) is the escape hatch's
    // other half: a non-production build only reaches this component at all
    // when someone deliberately turned analytics back on for it, and such a
    // build is ours by definition — so it stamps unconditionally rather than
    // waiting to be opted in, and the hatch cannot become the leak it stands
    // beside.
    const override =
      readInternalTrafficOverride() || analyticsEnvironmentForcesInternal()

    // ONE call site, and it is a shared invariant now rather than a tidiness
    // preference (AGL-2087). `@firebase/analytics`:
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
    // data filter is not retroactive. AGL-2087 folds `page_title` in here for
    // the same reason; keeping every write behind this one function is what
    // makes that a one-line change rather than a fourth race.
    const stamp = (internal: boolean) =>
      setDefaultEventParameters({
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
  useEffect(() => {
    if (typeof window === 'undefined') return
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
  const { currentOrg } = useOrgScope()
  const activeOrgId = currentOrg?.$id
  const orgPlans = useOrgPlans(activeOrgId ? [activeOrgId] : [])
  useEffect(() => {
    setUserProperties(
      analytics,
      buildOrgUserProperties({
        orgId: activeOrgId,
        role: currentOrg?.role,
        plan: activeOrgId ? orgPlans[activeOrgId] : undefined,
      }),
    )
  }, [analytics, activeOrgId, currentOrg, orgPlans])

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
      >
        <ReleaseFlagsProvider>
          <OrgScopeProvider>
            <AnalyticsGlobalEvents>{children}</AnalyticsGlobalEvents>
          </OrgScopeProvider>
        </ReleaseFlagsProvider>
      </FirebaseServicesProvider>
    </NoSsr>
  )
}
FirebaseAppLayout.displayName = 'FirebaseAppLayout'
FirebaseAppLayout.aglyn = true

export { FirebaseAppLayout }
export default FirebaseAppLayout
