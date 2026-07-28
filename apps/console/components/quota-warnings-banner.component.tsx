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
  resolveOrgEntitlements,
  UNLIMITED,
} from '@aglyn/aglyn'
import { AppLink } from '@aglyn/shared-ui-jsx'
import { Alert, Button } from '@mui/material'
import { collection, doc, getCountFromServer, getDoc } from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useFirestore, useScopeTokens } from '@aglyn/tenant-feature-instance'
import { buildRoute, Route } from '../constants/route-links'
import { useHostId } from '../components/host-id-provider'
import { useOrgSlug } from '../hooks/use-org-scope'
import useCurrentOrg from '../hooks/use-current-org'

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
 * workspaces without an explicit plan see nothing.
 */
export function QuotaWarningsBanner(props: QuotaWarningsBannerProps) {
  const params = useParams<{ hostId?: string }>()
  const hostId = props.hostId ?? useHostId()
  const firestore = useFirestore()
  const orgSlug = useOrgSlug()
  const { org, orgId } = useCurrentOrg()
  // Org-wide totals are not askable by a site collaborator (AGL-1068). An
  // unfiltered `count()` over an org collection is denied on the QUERY
  // SHAPE for a scoped member — Firestore does not evaluate it per
  // document — so it fails for them no matter what the collection holds.
  // `loaded` matters as much as `orgWide`: this hook reports org-wide
  // while it loads (AGL-1047), so acting on the value alone would fire
  // exactly the denied query this is here to prevent, on first render.
  const { orgWide: viewerOrgWide, loaded: scopeLoaded } = useScopeTokens(orgId)
  const canCountOrgData = scopeLoaded && viewerOrgWide
  const [quotas, setQuotas] = useState<QuotaState[]>([])
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1')
  }, [])

  const plan = org?.plan

  // Host-level quotas: screens, media storage, datasets.
  useEffect(() => {
    if (!plan || !hostId) return
    let active = true
    const entitlements = resolveOrgEntitlements(org)
    void Promise.all([
      getCountFromServer(
        collection(firestore, 'hosts', hostId, 'screens'),
      ).catch(() => null),
      getDoc(doc(firestore, 'hosts', hostId, 'counters', 'media')).catch(
        () => null,
      ),
      // Datasets are org-scoped (AGL-239/240). The `hosts/{hostId}/datasets`
      // fallback that used to sit here is gone (AGL-1050): production held
      // nothing under it and the rules now deny it outright, so asking would
      // be a guaranteed-denied read for a guaranteed-empty answer.
      //
      // Skipped entirely for a site collaborator (AGL-1068) — see
      // `canCountOrgData`. They cannot be told the org's dataset total, so
      // the row is omitted rather than shown as a wrong number.
      canCountOrgData && orgId
        ? getCountFromServer(
            collection(firestore, 'orgs', orgId, 'datasets'),
          ).catch(() => null)
        : Promise.resolve(null),
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
        // No count, no row. Previously an unanswerable count fell through
        // to `?? 0`, which reads as "0 datasets used" — a confident wrong
        // number, and the one that would say you are comfortably under a
        // limit you may already have hit.
        ...(datasets
          ? [
              {
                label: 'datasets',
                used: datasets.data().count,
                limit: entitlements.datasetsPerOrg,
              },
            ]
          : []),
      ])
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, hostId, orgId, plan, canCountOrgData])

  // Org-level team seats (AGL-238): the seat count is a client aggregate
  // query, cached per session.
  //
  // "The org roster is member-readable" stopped being true in AGL-1026 —
  // it is readable by ORG-WIDE members, because who else the workspace
  // employs is not a fact about the one site a collaborator was invited
  // to. The count went on being asked anyway and has been denied for every
  // scoped collaborator since, silently (AGL-1068). Nobody outside the org
  // roster gets a seat total; the row is omitted instead.
  useEffect(() => {
    if (!plan || !orgId || !canCountOrgData) return
    let active = true
    const apply = (seats: number) => {
      if (!active) return
      const seatQuota = checkSeatQuota(org, 'managers', 0)
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
  }, [firestore, orgId, plan, canCountOrgData])

  // Suspension (AGL-202) outranks everything — not dismissible, shown
  // regardless of plan so pre-billing workspaces see it too.
  if ((org as any)?.suspendedAt) {
    return (
      <Alert severity="error" sx={{ borderRadius: 0 }}>
        {'This account is suspended' +
          ((org as any)?.suspendedReason
            ? ` — ${(org as any).suspendedReason}`
            : '') +
          '. Your published sites are offline. Contact support to resolve.'}
      </Alert>
    )
  }

  // Dunning (AGL-275): past_due is the grace window — entitlements keep
  // working, but the card needs fixing before the subscription dies.
  // Deliberately not dismissible; it clears when Stripe retries succeed.
  if ((org?.subscription as any)?.status === 'past_due') {
    return (
      <Alert
        severity="warning"
        sx={{ borderRadius: 0 }}
        action={
          <AppLink
            componentVariant="button"
            color="inherit"
            size="small"
            href={buildRoute(Route.MANAGE_BILLING, { orgSlug })}
          >
            {'Fix payment'}
          </AppLink>
        }
      >
        {'Your last payment failed. Update your payment method to keep ' +
          'your plan — access continues during the retry window.'}
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
          <AppLink
            componentVariant="button"
            color="inherit"
            size="small"
            href={buildRoute(Route.MANAGE_BILLING, { orgSlug })}
          >
            {'Upgrade'}
          </AppLink>
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
