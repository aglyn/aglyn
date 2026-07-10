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
  checkSeatQuota,
  resolveTenantEntitlements,
  UNLIMITED,
} from '@aglyn/aglyn'
import { Alert, Button } from '@mui/material'
import { collection, doc, getCountFromServer, getDoc } from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { buildRoute, Route } from '../constants/route-links'
import useCurrentTenant from '../hooks/use-current-tenant'

const DISMISS_KEY = 'aglyn-quota-banner-dismissed'
const SEATS_KEY = 'aglyn-quota-banner-team-seats'

export interface QuotaWarningsBannerProps {
  /** Overrides the route param; the banner resolves `[hostId]` itself. */
  hostId?: string
}

interface QuotaState {
  label: string
  used: number
  limit: number
}

/**
 * Site-wide quota warnings (AGL-136, grown from the AGL-98 dashboard
 * banner): rendered by DashboardLayout on every host and manage page when
 * any tracked quota — screens, storage, datasets per host, or team seats —
 * crosses 80% (warning) or 100% (error), with an Upgrade link to Billing.
 * Dismissible per browser session. Consistent with the dark-launch rule,
 * tenants without an explicit plan see nothing.
 */
export function QuotaWarningsBanner(props: QuotaWarningsBannerProps) {
  const params = useParams<{ hostId?: string }>()
  const hostId = props.hostId ?? params?.hostId
  const firestore = useFirestore()
  const { tenant, orgId } = useCurrentTenant()
  const [quotas, setQuotas] = useState<QuotaState[]>([])
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1')
  }, [])

  const plan = tenant?.plan

  // Host-level quotas: screens, media storage, datasets.
  useEffect(() => {
    if (!plan || !hostId) return
    let active = true
    const entitlements = resolveTenantEntitlements(tenant)
    void Promise.all([
      getCountFromServer(
        collection(firestore, 'hosts', hostId, 'screens'),
      ).catch(() => null),
      getDoc(doc(firestore, 'hosts', hostId, 'counters', 'media')).catch(
        () => null,
      ),
      getCountFromServer(
        collection(firestore, 'hosts', hostId, 'datasets'),
      ).catch(() => null),
    ]).then(([screens, media, datasets]) => {
      if (!active) return
      const mediaBytes = media?.exists() ? (media.data()?.bytes ?? 0) : 0
      setQuotas((previous) => [
        ...previous.filter((quota) => quota.label === 'team seats'),
        {
          label: 'screens',
          used: screens?.data().count ?? 0,
          limit: entitlements.screensPerHost,
        },
        {
          label: 'storage',
          used: mediaBytes / (1024 * 1024),
          limit: entitlements.storagePerHostMb,
        },
        {
          label: 'datasets',
          used: datasets?.data().count ?? 0,
          limit: entitlements.datasetsPerHost,
        },
      ])
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, hostId, plan])

  // Org-level team seats (AGL-238): the org roster is member-readable,
  // so the seat count is a client aggregate query, cached per session.
  useEffect(() => {
    if (!plan || !orgId) return
    let active = true
    const apply = (seats: number) => {
      if (!active) return
      const seatQuota = checkSeatQuota(tenant, 'managers', 0)
      setQuotas((previous) => [
        ...previous.filter((quota) => quota.label !== 'team seats'),
        { label: 'team seats', used: seats, limit: seatQuota.limit },
      ])
    }
    const cached = sessionStorage.getItem(SEATS_KEY)
    if (cached != null) {
      apply(Number(cached))
      return
    }
    void getCountFromServer(collection(firestore, 'orgs', orgId, 'members'))
      .then((snapshot) => {
        const seats = snapshot.data().count
        sessionStorage.setItem(SEATS_KEY, String(seats))
        apply(seats)
      })
      .catch(() => {
        // No seats row on failure; host quotas still render.
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, orgId, plan])

  // Suspension (AGL-202) outranks everything — not dismissible, shown
  // regardless of plan so pre-billing tenants see it too.
  if ((tenant as any)?.suspendedAt) {
    return (
      <Alert severity="error" sx={{ borderRadius: 0 }}>
        {'This account is suspended' +
          ((tenant as any)?.suspendedReason
            ? ` — ${(tenant as any).suspendedReason}`
            : '') +
          '. Your published sites are offline. Contact support to resolve.'}
      </Alert>
    )
  }

  if (!plan || dismissed) return null
  const breached = quotas.filter(
    (quota) =>
      quota.limit !== UNLIMITED &&
      quota.limit > 0 &&
      quota.used / quota.limit >= 0.8,
  )
  if (!breached.length) return null
  const exceeded = breached.some((quota) => quota.used >= quota.limit)
  const names = breached.map((quota) => quota.label).join(' and ')

  return (
    <Alert
      severity={exceeded ? 'error' : 'warning'}
      sx={{ borderRadius: 0 }}
      action={
        // MUI's action slot replaces the onClose icon, so the dismiss
        // button lives beside Upgrade explicitly.
        <>
          <Button
            color="inherit"
            size="small"
            href={buildRoute(Route.MANAGE_BILLING)}
          >
            {'Upgrade'}
          </Button>
          <Button
            color="inherit"
            size="small"
            onClick={() => {
              sessionStorage.setItem(DISMISS_KEY, '1')
              setDismissed(true)
            }}
          >
            {'Dismiss'}
          </Button>
        </>
      }
    >
      {exceeded
        ? `You've reached your ${names} limit — upgrade to keep adding.`
        : `You're above 80% of your ${names} quota.`}
    </Alert>
  )
}
QuotaWarningsBanner.displayName = 'QuotaWarningsBanner'

export default QuotaWarningsBanner
