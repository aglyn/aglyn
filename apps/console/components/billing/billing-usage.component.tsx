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
  type AglynTenant,
  checkDatasetQuota,
  checkSeatQuota,
  resolveTenantEntitlements,
  UNLIMITED,
} from '@aglyn/aglyn'
import { Link, LinearProgress, Stack, Typography } from '@mui/material'
import { collection, doc, getCountFromServer, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore, useUser } from 'reactfire'

export interface BillingUsageProps {
  tenant: Partial<AglynTenant> | null | undefined
  hosts: any[]
}

function formatLimit(limit: number, unit?: string) {
  if (limit === UNLIMITED) return 'Unlimited'
  return unit ? `${limit} ${unit}` : String(limit)
}

/**
 * One quota meter: used/limit progress with warning at ≥80%, error at the
 * cap, an "Upgrade" link once warning, "Unlimited" for uncapped plans, and
 * a "not yet metered" state for usage sources that don't exist yet
 * (storage/site size/bandwidth arrive with the AGL-41 pipeline).
 */
export function UsageMeter(props: {
  label: string
  used: number | null
  limit: number
  unit?: string
}) {
  const { label, used, limit, unit } = props
  const unlimited = limit === UNLIMITED
  const unmetered = used == null
  const pct =
    unlimited || unmetered || limit <= 0
      ? 0
      : Math.min(100, (used / limit) * 100)
  const warning = !unlimited && !unmetered && pct >= 80
  return (
    <Stack spacing={0.5} sx={{ mb: 2 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
        <Typography variant="body2">{label}</Typography>
        <Typography variant="body2" color="text.secondary">
          {unmetered
            ? `not yet metered · limit ${formatLimit(limit, unit)}`
            : `${used} / ${formatLimit(limit, unit)}`}
          {warning ? (
            <>
              {' · '}
              <Link href="#plans" color="secondary" underline="hover">
                {'Upgrade'}
              </Link>
            </>
          ) : null}
        </Typography>
      </Stack>
      {unlimited || unmetered ? null : (
        <LinearProgress
          variant="determinate"
          value={pct}
          color={pct >= 100 ? 'error' : warning ? 'warning' : 'secondary'}
        />
      )}
    </Stack>
  )
}

function HostUsageMeters(props: {
  host: any
  showName: boolean
  tenant: Partial<AglynTenant> | null | undefined
}) {
  const { host, showName, tenant } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const [counts, setCounts] = useState<{
    screens: number | null
    layouts: number | null
    variables: number | null
    functions: number | null
    members: number | null
    storageMb: number | null
    workflowRuns: number | null
    datasets: number | null
  }>({
    screens: null,
    layouts: null,
    variables: null,
    functions: null,
    members: null,
    storageMb: null,
    workflowRuns: null,
    datasets: null,
  })
  const [usage, setUsage] = useState<{
    siteSizeMb: number | null
    bandwidthGb: number | null
  }>({ siteSizeMb: null, bandwidthGb: null })
  const entitlements = resolveTenantEntitlements(tenant)

  // Aggregation counts instead of full collection reads — one billed read
  // per counter regardless of collection size.
  useEffect(() => {
    let active = true
    void Promise.all([
      getCountFromServer(
        collection(firestore, 'hosts', host.$id, 'screens'),
      ).catch(() => null),
      getCountFromServer(
        collection(firestore, 'hosts', host.$id, 'layouts'),
      ).catch(() => null),
      getCountFromServer(
        collection(firestore, 'hosts', host.$id, 'variables'),
      ).catch(() => null),
      getCountFromServer(
        collection(firestore, 'hosts', host.$id, 'functions'),
      ).catch(() => null),
      getCountFromServer(
        collection(firestore, 'hosts', host.$id, 'datasets'),
      ).catch(() => null),
      // Member seats (AGL-107/119) — the managed subcollection, not the
      // legacy admins map.
      getCountFromServer(
        collection(firestore, 'hosts', host.$id, 'members'),
      ).catch(() => null),
      // Media bytes counter maintained by the media library (AGL-72).
      getDoc(doc(firestore, 'hosts', host.$id, 'counters', 'media')).catch(
        () => null,
      ),
      // Event-triggered workflow runs this month (AGL-165).
      getDoc(
        doc(firestore, 'hosts', host.$id, 'counters', 'workflowRuns'),
      ).catch(() => null),
    ]).then(([screens, layouts, variables, functions, datasets, members, media, runs]) => {
      if (!active) return
      const bytes = media?.exists() ? (media.data()?.bytes ?? 0) : 0
      const monthKey = new Date().toISOString().slice(0, 7)
      setCounts({
        screens: screens?.data().count ?? null,
        layouts: layouts?.data().count ?? null,
        variables: variables?.data().count ?? null,
        functions: functions?.data().count ?? null,
        members: members?.data().count ?? null,
        storageMb: Math.round((bytes / (1024 * 1024)) * 10) / 10,
        datasets: datasets?.data().count ?? null,
        workflowRuns: runs?.exists()
          ? Number(runs.data()?.[monthKey] ?? 0)
          : 0,
      })
    })
    return () => {
      active = false
    }
  }, [firestore, host.$id])

  // Site size (published version payloads) and month bandwidth are summed
  // server-side — version node payloads aren't client-readable at a
  // reasonable cost (AGL-41 follow-up).
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        if (!idToken) return
        const response = await fetch(
          `/api/billing/host-usage?hostId=${encodeURIComponent(host.$id)}`,
          { headers: { Authorization: `Bearer ${idToken}` } },
        )
        if (!response.ok) return
        const payload = await response.json()
        if (!active) return
        setUsage({
          siteSizeMb:
            Math.round((payload.siteSizeBytes / (1024 * 1024)) * 10) / 10,
          bandwidthGb:
            Math.round(
              (payload.bandwidthBytes / (1024 * 1024 * 1024)) * 100,
            ) / 100,
        })
      } catch {
        // Meters keep their "not yet metered" state on failure.
      }
    })()
    return () => {
      active = false
    }
  }, [user, host.$id])

  // Effective seat limit includes purchased addon seats (AGL-112).
  const memberSeatLimit = checkSeatQuota(tenant, 'members', 0).limit

  return (
    <>
      {showName ? (
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {host.displayName ?? host.$id}
        </Typography>
      ) : null}
      <UsageMeter
        label="Screens"
        used={counts.screens}
        limit={entitlements.screensPerHost}
      />
      <UsageMeter
        label="Shared layouts"
        used={counts.layouts}
        limit={entitlements.sharedLayoutsPerHost}
      />
      <UsageMeter
        label="Members"
        used={counts.members}
        limit={memberSeatLimit}
      />
      <UsageMeter
        label="Variables"
        used={counts.variables}
        limit={entitlements.variablesPerHost}
      />
      <UsageMeter
        label="Functions"
        used={counts.functions}
        limit={entitlements.functionsPerHost}
      />
      <UsageMeter
        label="Storage"
        used={counts.storageMb}
        limit={entitlements.storagePerHostMb}
        unit="MB"
      />
      <UsageMeter
        label="Workflow runs (this month)"
        used={counts.workflowRuns}
        limit={entitlements.workflowRunsPerMonth}
      />
      <UsageMeter
        label="Datasets"
        used={counts.datasets}
        limit={checkDatasetQuota(tenant, 0).limit}
      />
      <UsageMeter
        label="Total site size"
        used={usage.siteSizeMb}
        limit={entitlements.totalSiteSizeMb}
        unit="MB"
      />
      <UsageMeter
        label="Bandwidth (this month)"
        used={usage.bandwidthGb}
        limit={entitlements.bandwidthGb}
        unit="GB"
      />
    </>
  )
}

/**
 * Usage section of the billing page (AGL-70): the hosts meter plus per-host
 * screens/layouts/members/storage meters, and tenant-level site size and
 * bandwidth rows.
 */
export function BillingUsageComponent(props: BillingUsageProps) {
  const { tenant, hosts } = props
  const entitlements = resolveTenantEntitlements(tenant)
  const { data: user } = useUser()
  // Team seats (AGL-119): the members subcollection is server-readable
  // only, so the count comes from the team API; owner occupies one seat.
  const [teamSeats, setTeamSeats] = useState<number | null>(null)
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        if (!idToken) return
        const response = await fetch('/api/tenant/members', {
          headers: { Authorization: `Bearer ${idToken}` },
        })
        if (!response.ok) return
        const payload = await response.json()
        if (active) setTeamSeats((payload.members?.length ?? 0) + 1)
      } catch {
        // Meter keeps its "not yet metered" state on failure.
      }
    })()
    return () => {
      active = false
    }
  }, [user])
  const teamSeatLimit = checkSeatQuota(tenant, 'managers', 0).limit
  return (
    <>
      <UsageMeter
        label="Hosts"
        used={hosts.length}
        limit={entitlements.hostLimit}
      />
      <UsageMeter
        label="Team seats (incl. you)"
        used={teamSeats}
        limit={teamSeatLimit}
      />
      {hosts.map((host) => (
        <HostUsageMeters
          key={host.$id}
          host={host}
          showName={hosts.length > 1}
          tenant={tenant}
        />
      ))}
    </>
  )
}
BillingUsageComponent.displayName = 'BillingUsageComponent'

export default BillingUsageComponent
