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
  type AglynOrgBilling,
  checkContactQuota,
  checkDatasetQuota,
  checkSeatQuota,
  resolveOrgEntitlements,
  UNLIMITED,
} from '@aglyn/aglyn'
import { Link, LinearProgress, Stack, Typography } from '@mui/material'
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import fetchSeatCounts from '../../utils/fetch-seat-counts'
import { orgBandwidthGb } from '../../utils/usage-metering'

export interface BillingUsageProps {
  org: Partial<AglynOrgBilling> | null | undefined
  hosts: any[]
}

/**
 * Screens that spend the plan's allowance, from the server (AGL-1177).
 * Null on any failure so the meter shows "—" rather than a number that
 * disagrees with what creation will actually allow.
 */
async function fetchBillableScreens(
  hostId: string,
  idToken: string | undefined,
): Promise<number | null> {
  try {
    const response = await fetch(
      `/api/hosts/usage?hostId=${encodeURIComponent(hostId)}`,
      idToken ? { headers: { Authorization: `Bearer ${idToken}` } } : undefined,
    )
    if (!response.ok) return null
    const result = await response.json()
    return typeof result?.screens === 'number' ? result.screens : null
  } catch {
    return null
  }
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
              <Link href="#plans" color="primary" underline="hover">
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
          color={pct >= 100 ? 'error' : warning ? 'warning' : 'primary'}
        />
      )}
    </Stack>
  )
}

function HostUsageMeters(props: {
  host: any
  showName: boolean
  org: Partial<AglynOrgBilling> | null | undefined
}) {
  const { host, showName, org } = props
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
  }>({
    screens: null,
    layouts: null,
    variables: null,
    functions: null,
    members: null,
    storageMb: null,
    workflowRuns: null,
  })
  const entitlements = resolveOrgEntitlements(org)

  // Aggregation counts instead of full collection reads — one billed read
  // per counter regardless of collection size.
  useEffect(() => {
    let active = true
    void Promise.all([
      // Screens are counted server-side (AGL-1177): soft-deleted, email and
      // collection-template screens don't spend the allowance, and the web
      // SDK cannot express that — live screens have no `deletedAt` field at
      // all, and Firestore cannot query for an absent field. Asking the API
      // keeps this meter and the quota gate on one implementation.
      (user as any)
        ?.getIdToken?.()
        .then((token: string) => fetchBillableScreens(host.$id, token))
        .catch(() => null) ?? Promise.resolve(null),
      getCountFromServer(
        collection(firestore, 'hosts', host.$id, 'layouts'),
      ).catch(() => null),
      getCountFromServer(
        collection(firestore, 'hosts', host.$id, 'variables'),
      ).catch(() => null),
      getCountFromServer(
        collection(firestore, 'hosts', host.$id, 'functions'),
      ).catch(() => null),
      // Per-site collaborator seats (AGL-107/119, renamed AGL-888).
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
    ]).then(([screens, layouts, variables, functions, members, media, runs]) => {
      if (!active) return
      const bytes = media?.exists() ? (media.data()?.bytes ?? 0) : 0
      const monthKey = new Date().toISOString().slice(0, 7)
      setCounts({
        screens,
        layouts: layouts?.data().count ?? null,
        variables: variables?.data().count ?? null,
        functions: functions?.data().count ?? null,
        members: members?.data().count ?? null,
        storageMb: Math.round((bytes / (1024 * 1024)) * 10) / 10,
        workflowRuns: runs?.exists()
          ? Number(runs.data()?.[monthKey] ?? 0)
          : 0,
      })
    })
    return () => {
      active = false
    }
  }, [firestore, host.$id, user])

  // Effective seat limit includes purchased addon seats (AGL-112).
  const memberSeatLimit = checkSeatQuota(org, 'members', 0).limit

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
      {/* Per-site console collaborators (AGL-888), not end-user member
          accounts — those are unlimited and never metered. */}
      <UsageMeter
        label="Site collaborators"
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
      {/* Site size and bandwidth are NOT per-site meters — their limits
          (`totalSiteSizeMb`, `bandwidthGb`) are org-wide, so they render once
          in `BillingUsageComponent` against an org-wide numerator (AGL-1371). */}
    </>
  )
}

/**
 * Usage section of the billing page (AGL-70): the hosts meter plus per-host
 * screens/layouts/members/storage meters, and org-level site size and
 * bandwidth rows.
 */
export function BillingUsageComponent(props: BillingUsageProps) {
  const { org, hosts } = props
  const entitlements = resolveOrgEntitlements(org)
  // Team seats (AGL-119, org roster since AGL-238). "The roster is
  // member-readable so the count is a client aggregate query" stopped being
  // true in AGL-1026 and the count moved to the server in AGL-1255 — the
  // client list was denied for readers the rules do not call org-wide.
  const firestore = useFirestore()
  const { data: user } = useUser()
  const orgId = (org as any)?.$id as string | undefined
  const [teamSeats, setTeamSeats] = useState<number | null>(null)
  // Org-level data meters (AGL-239/240): datasets and their storage are
  // org-scoped, so they meter once here instead of per host.
  const [orgDatasets, setOrgDatasets] = useState<number | null>(null)
  const [dataStorageMb, setDataStorageMb] = useState<number | null>(null)
  // API requests this month (AGL-635): the live per-request counter, so the
  // current month is authoritative (not the monthly rollup).
  const [apiRequests, setApiRequests] = useState<number | null>(null)
  // Contacts audience band (AGL-890/891): org-scoped aggregate count.
  const [contactsCount, setContactsCount] = useState<number | null>(null)
  // Published site size (AGL-1107) — read from the SAME rollup field the
  // usage-alerts cron reads (`siteSizeMb`, written org-wide by report-usage),
  // so the meter and the email cannot disagree about it (AGL-1371). It used
  // to be recomputed live per host, which is both a different number and 250
  // extra document reads per site per page load.
  const [siteSizeMb, setSiteSizeMb] = useState<number | null>(null)
  // Month bandwidth (AGL-1106/1371): org-wide, summed across the org's sites
  // below — `entitlements.bandwidthGb` is an org-wide band, and the invoice
  // and the cron both compare it against the org-wide total.
  const [bandwidthGb, setBandwidthGb] = useState<number | null>(null)
  useEffect(() => {
    if (!orgId) return
    let active = true
    // Team seats meter MANAGERS only (AGL-1113). The roster also holds
    // site-scoped collaborators, whose seats meter per host against
    // membersPerHost — an aggregate count of the collection billed them here
    // too. The server does that counting now (AGL-1255).
    // Counted SERVER-side (AGL-1255). The client list here was the same
    // unconstrained `orgs/{orgId}/members` read AGL-1253 removed from the
    // quota banner: denied for any reader the RULES do not call org-wide,
    // which is not the same set the client thinks it is.
    void fetchSeatCounts(user, orgId).then((counts) => {
      // `null` means unanswerable, and the meter keeps its "not yet metered"
      // state — deliberately not 0, which reads as "no seats used".
      if (active && counts) setTeamSeats(counts.managerSeats)
    })
    void getCountFromServer(collection(firestore, 'orgs', orgId, 'contacts'))
      .then((snapshot) => {
        if (active) setContactsCount(snapshot.data().count)
      })
      .catch(() => {
        // Meter keeps its "not yet metered" state on failure.
      })
    void getCountFromServer(collection(firestore, 'orgs', orgId, 'datasets'))
      .then((snapshot) => {
        if (active) setOrgDatasets(snapshot.data().count)
      })
      .catch(() => {
        // Meter keeps its "not yet metered" state on failure.
      })
    void getDoc(
      doc(
        firestore,
        'orgs',
        orgId,
        'apiUsage',
        new Date().toISOString().slice(0, 7),
      ),
    )
      .then((snapshot) => {
        if (active) {
          setApiRequests(
            snapshot.exists() ? Number(snapshot.data()?.count ?? 0) : 0,
          )
        }
      })
      .catch(() => {
        // Meter keeps its "not yet metered" state on failure.
      })
    // Dataset storage AND published site size come from the monthly rollup
    // (report-usage); the current month may not exist yet, so fall back to the
    // previous one. Both fields ride the same document, so this is one read —
    // and site size is then the exact figure usage-alerts alerts on.
    void (async () => {
      const now = new Date()
      const month = now.toISOString().slice(0, 7)
      const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        .toISOString()
        .slice(0, 7)
      let storage: number | null = null
      let siteSize: number | null = null
      for (const key of [month, previous]) {
        if (storage != null && siteSize != null) break
        try {
          const rollup = await getDoc(
            doc(firestore, 'orgs', orgId, 'usage', key),
          )
          const data = rollup.exists() ? (rollup.data() ?? {}) : {}
          if (storage == null && typeof data['dataStorageMb'] === 'number') {
            storage = data['dataStorageMb']
          }
          if (siteSize == null && typeof data['siteSizeMb'] === 'number') {
            siteSize = data['siteSizeMb']
          }
        } catch {
          // Meter keeps its "not yet metered" state on failure.
        }
      }
      if (!active) return
      if (storage != null) setDataStorageMb(storage)
      if (siteSize != null) setSiteSizeMb(siteSize)
    })()
    return () => {
      active = false
    }
  }, [firestore, orgId, user])

  // Month bandwidth, summed ACROSS THE ORG'S SITES (AGL-1371). The band is
  // org-wide and so is the figure the invoice is computed from — the meter
  // used to render one site's reading against it, understating by up to
  // `hostLimit`×. `host-usage` stays per-site (its authorization is per-site
  // membership); the summing moved here, where the denominator lives.
  const hostKey = hosts.map((host) => host?.$id).filter(Boolean).join(',')
  useEffect(() => {
    const hostIds = hostKey ? hostKey.split(',') : []
    if (!hostIds.length) return
    let active = true
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        if (!idToken) return
        const readings = await Promise.all(
          hostIds.map(async (hostId) => {
            try {
              const response = await fetch(
                `/api/billing/host-usage?hostId=${encodeURIComponent(hostId)}`,
                { headers: { Authorization: `Bearer ${idToken}` } },
              )
              if (!response.ok) return null
              const payload = await response.json()
              return typeof payload?.monthPageViews === 'number'
                ? payload.monthPageViews
                : null
            } catch {
              return null
            }
          }),
        )
        // A partial sum is the SAME defect in a smaller size: one unreadable
        // site and the meter would quietly understate again. Better to keep
        // the "not yet metered" state than to publish a number that is low.
        if (!active || readings.some((views) => views == null)) return
        setBandwidthGb(Math.round(orgBandwidthGb(readings) * 100) / 100)
      } catch {
        // Meter keeps its "not yet metered" state on failure.
      }
    })()
    return () => {
      active = false
    }
  }, [hostKey, user])
  const teamSeatLimit = checkSeatQuota(org, 'managers', 0).limit
  // Contacts meter past the band on a paid plan is billing, not blocking
  // (AGL-890) — the caption under the meter says so with the estimate.
  const contactQuota = checkContactQuota(org, contactsCount ?? 0)
  return (
    <>
      <UsageMeter
        label="Sites"
        used={hosts.length}
        limit={entitlements.hostLimit}
      />
      <UsageMeter
        label="Team seats (incl. you)"
        used={teamSeats}
        limit={teamSeatLimit}
      />
      <UsageMeter
        label="Datasets (organization)"
        used={orgDatasets}
        limit={checkDatasetQuota(org, 0).limit}
      />
      <UsageMeter
        label="Data storage (organization)"
        used={dataStorageMb}
        limit={entitlements.dataStorageMbPerOrg}
        unit="MB"
      />
      <UsageMeter
        label="Contacts (organization)"
        used={contactsCount}
        limit={entitlements.contactsPerHost}
      />
      {contactQuota.overageContacts > 0 &&
      contactQuota.overageRateUsd != null ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: -1.5, mb: 2 }}
        >
          {`Audience overage: ${contactQuota.overageContacts.toLocaleString()} ` +
            `over the included band at $${contactQuota.overageRateUsd}/1,000 ` +
            `— ≈$${contactQuota.overageMonthlyUsd.toFixed(2)} this month.`}
        </Typography>
      ) : null}
      {entitlements.apiRequestsPerMonth > 0 ? (
        <UsageMeter
          label="API requests (this month)"
          used={apiRequests}
          limit={entitlements.apiRequestsPerMonth}
        />
      ) : null}
      {/* Org-wide by definition (AGL-1371): `totalSiteSizeMb` and
          `bandwidthGb` are org limits, not per-site ones, and the invoice and
          the usage-alerts cron both measure the org-wide total against them.
          Rendered here, once, rather than once per site. */}
      <UsageMeter
        label="Total site size (organization)"
        used={siteSizeMb}
        limit={entitlements.totalSiteSizeMb}
        unit="MB"
      />
      <UsageMeter
        label="Bandwidth (this month, organization)"
        used={bandwidthGb}
        limit={entitlements.bandwidthGb}
        unit="GB"
      />
      {hosts.map((host) => (
        <HostUsageMeters
          key={host.$id}
          host={host}
          showName={hosts.length > 1}
          org={org}
        />
      ))}
    </>
  )
}
BillingUsageComponent.displayName = 'BillingUsageComponent'

export default BillingUsageComponent
