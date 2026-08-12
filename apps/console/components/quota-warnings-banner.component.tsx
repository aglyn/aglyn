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
import { useFirestore, useScopeTokens, useUser } from '@aglyn/tenant-feature-instance'
import { buildRoute, Route } from '../constants/route-links'
import { useHostId } from '../components/host-id-provider'
import { useOrgSlug } from '../hooks/use-org-scope'
import useCurrentOrg from '../hooks/use-current-org'

const DISMISS_KEY = 'aglyn-quota-banner-dismissed'
// Versioned AND org-scoped (AGL-1113), suffixed with the orgId at use.
// The v1 key was a single global string holding a RAW member count: it both
// counted site collaborators as managers and leaked one workspace's total to
// the next workspace the user opened. Reusing the old key would keep serving
// that number — and its false "out of team seats" banner — from every session
// that already has it, making the fix look like it did not land.
const SEATS_KEY = 'aglyn-quota-banner-manager-seats-v2'

/**
 * Forget a cached seat count (AGL-1253).
 *
 * A read that failed must not leave the PREVIOUS answer standing. The cache
 * is consulted before the fetch, so a stale entry survives every later render
 * and keeps rendering a number nothing has confirmed — which is how an
 * account whose seat read was being denied ended up looking at "You've
 * reached your team seats limit", an upgrade prompt on false pretences.
 */
function clearSeatCache(cacheKey: string): void {
  try {
    sessionStorage.removeItem(cacheKey)
  } catch {
    // Private-mode storage failures are not worth a broken banner.
  }
}

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
 *
 * Every action here points at Billing, so for a site collaborator every
 * action is a dead end (AGL-1072): AGL-1032 took Billing out of their console
 * and redirects them off the URL. They keep the warning and lose the button.
 */
export function QuotaWarningsBanner(props: QuotaWarningsBannerProps) {
  const params = useParams<{ hostId?: string }>()
  const hostId = props.hostId ?? useHostId()
  const firestore = useFirestore()
  const orgSlug = useOrgSlug()
  // EXEMPT from `no-unguarded-loading-hook` (AGL-1422). This banner already
  // holds on the stronger condition: every branch of it is downstream of
  // `plan = org?.plan`, and each quota effect starts `if (!plan …) return`,
  // so an undefined `org` produces silence rather than a free-tier warning.
  // The suspension and dunning banners read fields off the same undefined
  // object and render nothing for the same reason. Silence is the correct
  // pending outcome for a component whose entire job is to make claims about
  // the plan, and `ready` would not change a single branch — but it WOULD
  // put a second condition beside `plan` for a reader to reconcile.
  // eslint-disable-next-line aglyn/no-unguarded-loading-hook
  const { org, orgId } = useCurrentOrg()
  // Org-wide totals are not askable by a site collaborator (AGL-1068). An
  // unfiltered `count()` over an org collection is denied on the QUERY
  // SHAPE for a scoped member — Firestore does not evaluate it per
  // document — so it fails for them no matter what the collection holds.
  // `loaded` matters as much as `orgWide`: this hook reports org-wide
  // while it loads (AGL-1047), so acting on the value alone would fire
  // exactly the denied query this is here to prevent, on first render.
  //
  // The same answer gates the ACTIONS below (AGL-1072): every action in this
  // banner is a link to Billing, which AGL-1032 removed from a collaborator's
  // console and redirects them off. One predicate for both, deliberately —
  // `useOrgReach` answers the same question from the AGL-1032 nav mirror, but
  // a second async source resolving on its own clock could show the Upgrade
  // button for a beat after the counts had already decided the viewer is
  // scoped.
  const { data: user } = useUser()
  const { orgWide: viewerOrgWide, loaded: scopeLoaded } = useScopeTokens(orgId)
  const orgWideViewer = scopeLoaded && viewerOrgWide
  // The two are NOT complements, and the loading window is why. An action
  // withheld for a beat costs an owner one render; the collaborator wording
  // shown for a beat tells that owner to go ask an admin — themselves. So
  // the action waits for "known org-wide" and the rewording waits for the
  // stronger "known scoped".
  const scopedViewer = scopeLoaded && !viewerOrgWide
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
      // `orgWideViewer`. They cannot be told the org's dataset total, so
      // the row is omitted rather than shown as a wrong number.
      orgWideViewer && orgId
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
  }, [firestore, hostId, orgId, plan, orgWideViewer])

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
    if (!plan || !orgId || !orgWideViewer) return
    let active = true
    const apply = (seats: number) => {
      if (!active) return
      const seatQuota = checkSeatQuota(org, 'managers', 0)
      setQuotas((previous) => [
        ...previous.filter((quota) => quota.label !== 'team seats'),
        { label: 'team seats', used: seats, limit: seatQuota.limit },
      ])
    }
    // Per-ORG cache key (AGL-1113). The key used to be a single global
    // string, so the seat count cached while viewing one workspace was
    // served to the next — a 2-manager org's total rendered against a
    // 2-seat Starter workspace's limit and put a false "you've reached your
    // team seats limit" banner on a workspace with one manager.
    const cacheKey = `${SEATS_KEY}:${orgId}`
    const cached = sessionStorage.getItem(cacheKey)
    if (cached != null) {
      apply(Number(cached))
      return
    }
    // Counted SERVER-side (AGL-1253). This used to be an unconstrained
    // `getDocs` on `orgs/{orgId}/members` — a list, so the rule's
    // `memberUid == request.auth.uid` clause could never satisfy it, and it
    // was measured denied on production for an account this component had
    // already decided was org-wide. Gating on `orgWideViewer` cannot fix
    // that: the client predicate and the rules predicate disagree about
    // legacy member docs, so the guard passes and the query still fails.
    //
    // MANAGERS only (AGL-1113) — the roster also holds site-scoped
    // collaborators, metered per host against membersPerHost. Counting the
    // whole collection is what put an "out of team seats" banner in front of
    // orgs that had only spent collaborator seats.
    void (async () => {
      try {
        const idToken = await (user as { getIdToken?: () => Promise<string> })
          ?.getIdToken?.()
        if (!idToken) return
        const response = await fetch(
          `/api/orgs/members?orgId=${encodeURIComponent(orgId)}&counts=1`,
          { headers: { Authorization: `Bearer ${idToken}` } },
        )
        if (!response.ok) return void clearSeatCache(cacheKey)
        const payload = await response.json().catch(() => null)
        const seats = Number(payload?.managerSeats)
        // A number we could not read is not zero. `?? 0` here would render
        // "0 of 2 seats used" — a confident wrong answer, and the same trap
        // the datasets row above was fixed for.
        if (!Number.isFinite(seats)) return void clearSeatCache(cacheKey)
        sessionStorage.setItem(cacheKey, String(seats))
        apply(seats)
      } catch {
        // Network trouble: no seats row, and no stale one either.
        clearSeatCache(cacheKey)
      }
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, orgId, plan, orgWideViewer, user])

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
  // Reads `billingStatus`, the bare status string the webhook mirrors onto the
  // org doc (AGL-1028). `subscription` itself moved to a manager-gated
  // subcollection, and this banner is shown to EVERY member on purpose — a
  // collaborator who cannot see the invoice still benefits from knowing the
  // workspace is about to lapse. Falls back to the inline object for orgs the
  // backfill has not reached.
  const billingStatus =
    (org as any)?.billingStatus ?? (org?.subscription as any)?.status
  if (billingStatus === 'past_due') {
    return (
      <Alert
        severity="warning"
        sx={{ borderRadius: 0 }}
        action={
          orgWideViewer ? (
            <AppLink
              componentVariant="button"
              color="inherit"
              size="small"
              href={buildRoute(Route.MANAGE_BILLING, { orgSlug })}
            >
              {'Fix payment'}
            </AppLink>
          ) : undefined
        }
      >
        {scopedViewer
          ? "This workspace's last payment failed. A workspace admin needs " +
            'to update the payment method — access continues during the ' +
            'retry window.'
          : 'Your last payment failed. Update your payment method to keep ' +
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
          {orgWideViewer ? (
            <AppLink
              componentVariant="button"
              color="inherit"
              size="small"
              href={buildRoute(Route.MANAGE_BILLING, { orgSlug })}
            >
              {'Upgrade'}
            </AppLink>
          ) : null}
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
      {/*
       * A site collaborator cannot buy anything, so "upgrade to keep adding"
       * is an instruction they cannot follow (AGL-1072). The warning itself
       * still earns its place — the rows they can see are host-scoped
       * (screens, storage) and they are the ones about to hit them — so the
       * limit stays and only the call to action changes. The org's quotas
       * are theirs to work within, not to act on.
       */}
      {scopedViewer
        ? exceeded
          ? `This site has reached its ${names} limit — ask a workspace ` +
            'admin to upgrade to keep adding.'
          : `This site is above 80% of its ${names} quota.`
        : exceeded
          ? `You've reached your ${names} limit — upgrade to keep adding.`
          : `You're above 80% of your ${names} quota.`}
    </Alert>
  )
}
QuotaWarningsBanner.displayName = 'QuotaWarningsBanner'

export default QuotaWarningsBanner
