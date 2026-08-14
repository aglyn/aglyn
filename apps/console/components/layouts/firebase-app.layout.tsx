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
import { NoSsr } from '@mui/material'
import {
  logEvent,
  setDefaultEventParameters,
  setUserId,
  setUserProperties,
} from 'firebase/analytics'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { OrgScopeProvider } from '../../hooks/use-org-scope'
import BootSplash from '../boot-splash.component'
import useSessionCookie from '../../hooks/use-session-cookie'
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
  // Cross-subdomain session cookie sync (AGL-236).
  useSessionCookie()
  const analytics = useAnalytics()
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
  useEffect(() => {
    const account = user?.data as
      | {
          getIdTokenResult?: (
            forceRefresh?: boolean,
          ) => Promise<{ claims?: Record<string, unknown> } | undefined>
        }
      | undefined
    if (!account?.getIdTokenResult) {
      setDefaultEventParameters({ [INTERNAL_TRAFFIC_PARAM]: undefined })
      return
    }
    let active = true
    void Promise.resolve(account.getIdTokenResult())
      .then((result) => {
        if (!active) return
        setDefaultEventParameters({
          [INTERNAL_TRAFFIC_PARAM]: isInternalTrafficSession(result?.claims)
            ? INTERNAL_TRAFFIC_VALUE
            : undefined,
        })
      })
      .catch(() => {
        if (active) setDefaultEventParameters({ traffic_type: undefined })
      })
    return () => {
      active = false
    }
  }, [user])

  // Page-view analytics (AGL-118). The Pages Router `router.events` API has
  // no App Router equivalent, so fire on `usePathname` changes instead; route
  // errors are now surfaced by error.tsx boundaries rather than an event.
  useEffect(() => {
    logEvent(analytics, 'page_view', { page_location: pathname })
  }, [pathname, analytics])

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

  return children
}

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
