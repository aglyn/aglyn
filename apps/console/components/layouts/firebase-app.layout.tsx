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

import { NextRouterEvent, SplashScreen } from '@aglyn/shared-ui-jsx'
import {
  fbClientAppOptions,
  FIREBASE_CLIENT_APP_NAME,
  FirebaseServicesProvider,
  useAnalytics,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { NoSsr } from '@mui/material'
import { logEvent, setUserId, setUserProperties } from 'firebase/analytics'
import { usePathname } from 'next/navigation'
import { useRouter } from 'next/router'
import { useEffect } from 'react'

function AnalyticsGlobalEvents({ children }) {
  const analytics = useAnalytics()
  const router = useRouter()
  const pathname = usePathname()
  const user = useUser()

  useEffect(() => {
    const logPageView = (pathname) => {
      logEvent(analytics, 'page_view', {
        page_location: pathname,
      })
    }
    const logRouteError = (error, pathname) => {
      logEvent(analytics, 'exception', {
        page_location: pathname,
        description: `code(${error.code || 'none'}): ${
          error.message || 'none'
        }`,
        fatal: !error.cancelled,
      })
    }
    router.events.on(NextRouterEvent.ROUTE_CHANGE_COMPLETE, logPageView)
    router.events.on(NextRouterEvent.ROUTE_CHANGE_ERROR, logRouteError)
    return () => {
      router.events.off(NextRouterEvent.ROUTE_CHANGE_COMPLETE, logPageView)
      router.events.off(NextRouterEvent.ROUTE_CHANGE_ERROR, logRouteError)
    }
  }, [router, analytics])

  useEffect(() => {
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
    <NoSsr>
      <FirebaseServicesProvider
        firebaseConfig={fbClientAppOptions}
        appName={FIREBASE_CLIENT_APP_NAME}
      >
        <AnalyticsGlobalEvents>{children}</AnalyticsGlobalEvents>
      </FirebaseServicesProvider>
    </NoSsr>
  )
}
FirebaseAppLayout.displayName = 'FirebaseAppLayout'
FirebaseAppLayout.aglyn = true

export { FirebaseAppLayout }
export default FirebaseAppLayout
