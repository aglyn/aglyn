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
import { NoSsr } from '@mui/material'
import { logEvent, setUserId, setUserProperties } from 'firebase/analytics'
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
