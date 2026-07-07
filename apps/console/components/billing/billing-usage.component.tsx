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
  resolveTenantEntitlements,
  UNLIMITED,
} from '@aglyn/aglyn'
import { Link, LinearProgress, Stack, Typography } from '@mui/material'
import { collection, doc, getCountFromServer, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore } from 'reactfire'

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
  const [counts, setCounts] = useState<{
    screens: number | null
    layouts: number | null
    storageMb: number | null
  }>({ screens: null, layouts: null, storageMb: null })
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
      // Media bytes counter maintained by the media library (AGL-72).
      getDoc(doc(firestore, 'hosts', host.$id, 'counters', 'media')).catch(
        () => null,
      ),
    ]).then(([screens, layouts, media]) => {
      if (!active) return
      const bytes = media?.exists() ? (media.data()?.bytes ?? 0) : 0
      setCounts({
        screens: screens?.data().count ?? null,
        layouts: layouts?.data().count ?? null,
        storageMb: Math.round((bytes / (1024 * 1024)) * 10) / 10,
      })
    })
    return () => {
      active = false
    }
  }, [firestore, host.$id])

  const members = Object.keys(host.admins ?? {}).length

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
        used={members}
        limit={entitlements.membersPerHost}
      />
      <UsageMeter
        label="Storage"
        used={counts.storageMb}
        limit={entitlements.storagePerHostMb}
        unit="MB"
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
  return (
    <>
      <UsageMeter
        label="Hosts"
        used={hosts.length}
        limit={entitlements.hostLimit}
      />
      {hosts.map((host) => (
        <HostUsageMeters
          key={host.$id}
          host={host}
          showName={hosts.length > 1}
          tenant={tenant}
        />
      ))}
      <UsageMeter
        label="Total site size"
        used={null}
        limit={entitlements.totalSiteSizeMb}
        unit="MB"
      />
      <UsageMeter
        label="Bandwidth"
        used={null}
        limit={entitlements.bandwidthGb}
        unit="GB"
      />
    </>
  )
}
BillingUsageComponent.displayName = 'BillingUsageComponent'

export default BillingUsageComponent
