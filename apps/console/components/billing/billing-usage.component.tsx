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
  checkApiRequestQuota,
  checkContactQuota,
  checkDatasetQuota,
  checkSeatQuota,
  resolveHostCollaboratorCap,
  resolveOrgEntitlements,
  UNLIMITED,
} from '@aglyn/aglyn'
import { HelpTip, type HelpTipContent } from '@aglyn/shared-ui-jsx'
import { Link, LinearProgress, Stack, Typography } from '@mui/material'
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { useReleaseFlag } from '../../hooks/use-release-flags'
import fetchSeatCounts from '../../utils/fetch-seat-counts'
import {
  monthlyAllowanceResetsAt,
  parseOrgEmailSendCeiling,
  planExceedsDeliverableMonthly,
  type OrgEmailSendCeiling,
} from '../../utils/email-send-ceiling'
import { orgBandwidthGb } from '../../utils/usage-metering'
import { docsHelp } from '../../constants/docs-links'

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
  /**
   * Optional help affordance beside the label (AGL-2201).
   *
   * A meter is a number against a limit and says nothing about what happens
   * when the two meet — which for bandwidth is the whole question, and is
   * different on Free (the site pauses) than on a paid plan (the extra bills).
   */
  help?: HelpTipContent
}) {
  const { label, used, limit, unit, help } = props
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
        {/*
          The tip renders INSIDE the label, not beside it in a wrapper.
          `usage-org-wide-denominator` and `contacts-overage-caption-release-gate`
          both find a meter by `getByText(label).parentElement` and read the
          row's text from it; a wrapper makes that parent the wrapper, whose
          text is the label alone. The icon contributes no text, so the label
          still matches and the row is still the parent.
        */}
        <Typography variant="body2">
          {label}
          {help ? <HelpTip {...help} sx={{ ml: 0.5, fontSize: '0.8em' }} /> : null}
        </Typography>
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

  // The effective seat limit for THIS SITE (AGL-112, corrected AGL-2439):
  // the plan's per-site allowance plus the pool seats assigned to this host,
  // clamped to the plan's band. `checkSeatQuota(org, 'members', …)` answers
  // the plan allowance alone now — the purchase is an org POOL, so an
  // org-level number cannot be a per-site cap without handing every site the
  // whole purchase, which is the defect AGL-2439 fixes.
  const memberSeatLimit = resolveHostCollaboratorCap(org, host.$id)

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
      {/* Campaign emails are NOT a per-site meter either — the entitlement is
          org-wide and the claim is taken against the org's counter, so the
          meter renders once in `BillingUsageComponent`. Rendering it per site
          showed each site its own slice against the whole org's cap, which
          disagreed with the gate on every multi-site org. */}
      {/* Bandwidth is NOT a per-site meter — its limit (`bandwidthGb`) is
          org-wide, so it renders once in `BillingUsageComponent` against an
          org-wide numerator (AGL-1371). Site size moved there too and was then
          removed outright (AGL-1370): unreachable on every plan. */}
    </>
  )
}

/**
 * Usage section of the billing page (AGL-70): the hosts meter plus per-host
 * screens/layouts/members/storage meters, and the org-level bandwidth row.
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
  /**
   * How many of `teamSeats` are invites sent but not yet accepted (AGL-2304).
   *
   * Kept separate purely to LABEL the meter. The total already includes them —
   * it has to, because the invite gate counts them — but a number silently
   * larger than the visible team list is its own kind of confusing, and the
   * question an admin asks at that moment is "why does it say 5 when I see 3".
   */
  const [pendingSeats, setPendingSeats] = useState(0)
  // Org-level data meters (AGL-239/240): datasets and their storage are
  // org-scoped, so they meter once here instead of per host.
  const [orgDatasets, setOrgDatasets] = useState<number | null>(null)
  const [dataStorageMb, setDataStorageMb] = useState<number | null>(null)
  // API requests this month (AGL-635): the live per-request counter, so the
  // current month is authoritative (not the monthly rollup).
  const [apiRequests, setApiRequests] = useState<number | null>(null)
  // Contacts audience band (AGL-890/891): org-scoped aggregate count.
  const [contactsCount, setContactsCount] = useState<number | null>(null)
  // Month bandwidth (AGL-1106/1371): org-wide, summed across the org's sites
  // below — `entitlements.bandwidthGb` is an org-wide band, and the invoice
  // and the cron both compare it against the org-wide total.
  const [bandwidthGb, setBandwidthGb] = useState<number | null>(null)
  /*
   * Campaign email sends this month, ORG-WIDE.
   *
   * `emailSendsPerMonth` is an org entitlement and `reserveCampaignEmailSends`
   * claims against `orgs/{orgId}/counters/campaignEmailSends`, so this is the
   * counter the gate actually decides on. It used to render per site off
   * `hosts/{hostId}/counters/campaignEmailSends`, which disagreed with the
   * gate on every multi-site org: three sites at 100 each showed `100/5,000`
   * three times while the org stood at 300 and the next campaign was refused.
   *
   * `campaignEmailSends`, NOT the `emailSends` counter beside it. Those are
   * two meters on purpose — `emailSends` is the COST meter and counts every
   * receipt, booking reminder and password reset, while the cap is checked
   * against campaign volume alone. Metering the cap against the cost counter
   * would show a busy store most of its allowance spent on order
   * confirmations.
   */
  const [campaignEmails, setCampaignEmails] = useState<number | null>(null)
  /*
   * The HOURLY campaign ceiling, and how much of this hour is already spent.
   *
   * A second, independent limit on the same unit. `claimOrgEmailSendBudget`
   * refuses a campaign that would take the org past its share of the platform
   * hour, and until now that number appeared in exactly one place: the
   * deferral notice a merchant reads after pressing Send. A customer throttled
   * at 500 an hour had no surface anywhere that said 500, or said hour.
   *
   * Its counter lives in `rateLimits`, which is deny-all to every client, so
   * it arrives from `/api/billing/email-ceiling` rather than from Firestore.
   * `null` is the unmetered state — never a zero-filled default, which would
   * invent a denominator for a meter that has not been read.
   */
  const [sendCeiling, setSendCeiling] = useState<OrgEmailSendCeiling | null>(
    null,
  )
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
      if (active && counts) {
        setTeamSeats(counts.managerSeats)
        setPendingSeats(counts.pendingManagerSeats)
      }
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
    void getDoc(
      doc(firestore, 'orgs', orgId, 'counters', 'campaignEmailSends'),
    )
      .then((snapshot) => {
        if (active) {
          // An org that has never sent a campaign has no counter document;
          // that is a settled zero — the same zero the server resolves it to
          // — not an unmetered "—".
          const monthKey = new Date().toISOString().slice(0, 7)
          setCampaignEmails(
            snapshot.exists() ? Number(snapshot.data()?.[monthKey] ?? 0) : 0,
          )
        }
      })
      .catch(() => {
        // Meter keeps its "not yet metered" state on failure.
      })
    // Dataset storage comes from the monthly rollup (report-usage); the
    // current month may not exist yet, so fall back to the previous one. The
    // rollup's `siteSizeMb` was read here too until AGL-1370 removed the site
    // size meter — the field is still written, as an internal signal, but no
    // console surface renders it.
    void (async () => {
      const now = new Date()
      const month = now.toISOString().slice(0, 7)
      const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        .toISOString()
        .slice(0, 7)
      let storage: number | null = null
      for (const key of [month, previous]) {
        if (storage != null) break
        try {
          const rollup = await getDoc(
            doc(firestore, 'orgs', orgId, 'usage', key),
          )
          const data = rollup.exists() ? (rollup.data() ?? {}) : {}
          if (typeof data['dataStorageMb'] === 'number') {
            storage = data['dataStorageMb']
          }
        } catch {
          // Meter keeps its "not yet metered" state on failure.
        }
      }
      if (!active) return
      if (storage != null) setDataStorageMb(storage)
    })()
    return () => {
      active = false
    }
  }, [firestore, orgId, user])

  /*
   * The hourly ceiling, from the server.
   *
   * ONE request for the whole org, not one per site: the ceiling is a share of
   * the platform hour granted to the ORGANIZATION, and the counter it is read
   * against (`rateLimits/sendRateOrg_{window}_{orgId}`) is keyed by org id.
   * Fanning this out per host would be the AGL-2113 shape a second time — a
   * per-site reading against an org-wide denominator — at N times the cost.
   *
   * Costs at most two document reads server-side, neither of them a scan: the
   * platform ramp (cached 15s in-process, because it already sits on every
   * outbound message's path) and the org's own hourly window.
   */
  useEffect(() => {
    if (!orgId) return
    let active = true
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        if (!idToken) return
        const response = await fetch(
          `/api/billing/email-ceiling?orgId=${encodeURIComponent(orgId)}`,
          { headers: { Authorization: `Bearer ${idToken}` } },
        )
        if (!response.ok) return
        const reading = parseOrgEmailSendCeiling(await response.json())
        // A partial or unparseable answer holds the unmetered state. The
        // parse is what enforces that every ceiling is a finite number, so a
        // serialized sentinel cannot land here as a cap of zero.
        if (active && reading) setSendCeiling(reading)
      } catch {
        // The row keeps its "not yet metered" state on failure.
      }
    })()
    return () => {
      active = false
    }
  }, [orgId, user])

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
  /*
   * API requests past the plan's included band, priced.
   *
   * The same shape as the audience band beside it, and the same reason for
   * existing: `apiQuota.overageMonthlyUsd` is one of the five terms
   * `report-usage` adds into `billedCents`, so a customer past the band is
   * already being invoiced for it while the meter above said only how many
   * requests they had made. `checkApiRequestQuota` is the ONE place that
   * arithmetic lives — the caption reads its answer rather than multiplying a
   * rate by a count a second time.
   *
   * `overageRateUsd` is null on every plan that sells no API overage (Free and
   * the two lower tiers include no requests at all; Enterprise is negotiated),
   * and the caption is suppressed there rather than quoting a rate that plan
   * cannot be charged.
   */
  const apiQuota = checkApiRequestQuota(org, apiRequests ?? 0)
  // ...unless the invoice is withholding it (AGL-1658). AGL-1604 stopped the
  // usage cron putting `contactsOverageUsd` into `billedCents` while
  // `release_contacts` is off for the org, and this caption kept quoting the
  // dollar figure — the same defect with the sign reversed, on the page a
  // customer reads before deciding to stay.
  //
  // THE SAME VERDICT, not an approximation of it. `released` is
  // `isReleaseFlagOnForOrg` over the Remote Config value, bucketed by the org
  // id, with `parseOrgReleaseFlagOverrides` applied — the identical expression
  // and the identical inputs `report-usage` resolves from `orgData`. So an org
  // staff granted Contacts early (AGL-1635) IS billed and is told so, and an
  // org forced off is not billed and is not told it owes anything.
  //
  // `released`, deliberately NOT `visible`: `visible` adds the staff bypass,
  // and staff seeing a page does not put a line on the customer's invoice.
  // Billing text must follow what is billed, not who is looking.
  //
  // Gated on `ready` — before Remote Config activation every flag reads its
  // registry default (`release_contacts` is default-off), so an unguarded
  // caption would assert "not billed" for one paint on an org that IS billed.
  // A billing claim is not made until the verdict that decides it has settled;
  // the head-count meter above renders throughout.
  const { released: contactsBilled, ready: releaseFlagsReady } =
    useReleaseFlag('release_contacts')
  return (
    <>
      <UsageMeter
        label="Sites"
        used={hosts.length}
        limit={entitlements.hostLimit}
      />
      <UsageMeter
        label={
          pendingSeats > 0
            ? `Team seats (incl. you + ${pendingSeats} invited)`
            : 'Team seats (incl. you)'
        }
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
      contactQuota.overageRateUsd != null &&
      releaseFlagsReady ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: -1.5, mb: 2 }}
        >
          {contactsBilled
            ? // "if your audience ends the month at this size" is the basis,
              // not a hedge (AGL-2399). The meter above is a LIVE head count —
              // the right thing for a band you are enforced against right now —
              // while the invoice charges the last reading taken before the
              // month closes. So this total is a projection of a figure that is
              // not fixed until the month is, and a bare "this month" claimed a
              // certainty the meter cannot have on the 3rd.
              `Audience overage: ${contactQuota.overageContacts.toLocaleString()} ` +
              `over the included band at $${contactQuota.overageRateUsd}/1,000 ` +
              `— ≈$${contactQuota.overageMonthlyUsd.toFixed(2)} if your audience ` +
              `ends the month at this size.`
            : // Worded to `billing-and-plans/overview.md` (AGL-1601/1603),
              // which tells the same customer that the Contacts page isn't
              // available yet, that paid audience overage is not billed while
              // it is unavailable, and that the published rates are what will
              // apply once it opens. The count stays — it is real, it is what
              // ingestion has captured, and it is why the band matters — while
              // the monthly dollar total goes, because that total is the part
              // no invoice will carry.
              `Audience overage: ${contactQuota.overageContacts.toLocaleString()} ` +
              `over the included band — not billed while the Contacts page is ` +
              `unavailable. The $${contactQuota.overageRateUsd}/1,000 rate ` +
              `applies once Contacts opens.`}
        </Typography>
      ) : null}
      {entitlements.apiRequestsPerMonth > 0 ? (
        <UsageMeter
          label="API requests (this month)"
          used={apiRequests}
          limit={entitlements.apiRequestsPerMonth}
        />
      ) : null}
      {/* No caption while the counter is still loading, and no separate guard
          for it: the quota is computed from `apiRequests ?? 0`, and zero is
          never over a positive band — so the loading default cannot produce a
          dollar figure that the settled read then contradicts. That property
          is what makes the fallback safe, and it is the fallback that has to
          stay 0 for it to hold.
          `overageRateUsd` non-null is what confines this to a plan that can
          actually be charged for the excess. */}
      {apiQuota.overageRequests > 0 && apiQuota.overageRateUsd != null ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: -1.5, mb: 2 }}
        >
          {/* `toFixed(2)` on the rate as well as the total: Business bills
              $0.5/1,000 and Advanced $0.2/1,000, and a bare interpolation
              prints those as "$0.5" and "$0.2" — a price missing its cents
              column reads as a typo on the one line that is about money. */}
          {`API overage: ${apiQuota.overageRequests.toLocaleString()} requests ` +
            `over the included band at $${apiQuota.overageRateUsd.toFixed(2)}` +
            `/1,000 — ≈$${apiQuota.overageMonthlyUsd.toFixed(2)} on this ` +
            "month's invoice."}
        </Typography>
      ) : null}
      {/* Org-wide by definition (AGL-1371): `bandwidthGb` is an org limit, not
          a per-site one, and the invoice and the usage-alerts cron both
          measure the org-wide total against it. Rendered here, once, rather
          than once per site.

          A "Total site size (organization)" row sat beside it until AGL-1370.
          It metered `totalSiteSizeMb`, which no plan can reach — the 900 KB
          node-map wall (AGL-678) bounds the measurable total to a few percent
          of the cap — so the meter could only ever read near zero. The
          entitlement and the rollup measurement stay as an internal signal. */}
      <UsageMeter
        label="Bandwidth (this month, organization)"
        used={bandwidthGb}
        limit={entitlements.bandwidthGb}
        unit="GB"
        help={docsHelp('bandwidth', { anchor: '#where-to-see-it' })}
      />
      {/* Campaign emails, the one operating quota that reached the customer
          only as a refusal. The label says CAMPAIGN because that is what the
          cap governs: transactional mail — receipts, booking reminders,
          password resets — is counted for cost and never refused at any tier
          (AGL-1438), so a meter labelled "Emails" would promise a limit the
          product does not enforce and alarm a merchant whose receipts are
          fine. Org-wide, matching the entitlement and the counter the claim
          is taken against. */}
      <UsageMeter
        label="Campaign emails (this month, organization)"
        used={campaignEmails}
        limit={entitlements.emailSendsPerMonth}
        /* The section that says what this cap does and does NOT govern —
           not the topic root, and not `#recipient-count`, which is about the
           audience size of one send. A meter whose help lands on the wrong
           heading is the presence-not-correctness failure. */
        help={docsHelp('emailCampaigns', { anchor: '#monthly-send-cap' })}
      />
      {/* WHEN the meter above goes back to zero. The counter is keyed
          `YYYY-MM` in UTC, so the allowance returns at midnight UTC on the
          1st — not at midnight wherever the reader is, which is a different
          instant for most of the planet and the one a merchant plans a send
          around. Stated for a FINITE allowance only: an unlimited plan has
          nothing to wait for. */}
      {entitlements.emailSendsPerMonth !== UNLIMITED ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: -1.5, mb: 2 }}
        >
          {`Resets ${monthlyAllowanceResetsAt().toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            timeZone: 'UTC',
          })} at 00:00 UTC. Unused allowance does not roll over.`}
        </Typography>
      ) : null}
      {/*
        THE SECOND CEILING, and the one a throttled customer actually hits.

        Rendered only once the reading is KNOWN. Every other meter here can
        fall back to "not yet metered · limit N" because the limit comes from
        the plan and is always in hand; this limit is a share of a live
        platform ramp that only the server can see, so an unread row has no
        honest denominator to show and is omitted rather than guessed at.

        A separate row from the monthly one, never a combined fraction. The
        two count the same unit over windows three orders of magnitude apart,
        and dividing one into the other would manufacture a rate neither
        counter measures — the shape this surface exists to stop.
      */}
      {sendCeiling ? (
        <>
          <UsageMeter
            label="Campaign emails (this hour, organization)"
            used={sendCeiling.hourUsed}
            limit={sendCeiling.hourLimit}
            help={docsHelp('emailCampaigns', { anchor: '#monthly-send-cap' })}
          />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: -1.5, mb: 2 }}
          >
            {`Resets ${new Date(sendCeiling.hourResetMs).toLocaleTimeString(
              undefined,
              { hour: 'numeric', minute: '2-digit' },
            )}. This paces how fast campaigns leave; the allowance above is ` +
              `how many you get for the month. One send reaches at most ` +
              `${sendCeiling.perSend.toLocaleString()} addresses. ` +
              // Transactional mail is never refused at any tier (AGL-1438),
              // and a merchant reading a throttle needs to know their receipts
              // are not in it — the same clause the monthly cap's label earns
              // by saying CAMPAIGN.
              'Transactional mail is not paced by this.'}
            {sendCeiling.paced ? null : (
              // The operator kill switch is off, so nothing is enforcing the
              // number above. Saying so beats drawing a ceiling a customer
              // would plan around for no reason.
              <>
                {' '}
                {'Hourly pacing is switched off platform-wide right now, so ' +
                  'this ceiling is not being enforced.'}
              </>
            )}
          </Typography>
          {/* The plan sells more than the pace can deliver. Reported rather
              than repaired: the hourly ceiling DEFERS a campaign, it does not
              refuse it, so the allowance is real — it just cannot all be spent
              in one month at this pace. A customer on an unlimited plan is
              entitled to know that before they plan around it. */}
          {planExceedsDeliverableMonthly(
            entitlements.emailSendsPerMonth,
            sendCeiling.deliverableMonthly,
          ) ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: -1.5, mb: 2 }}
            >
              {`Your plan includes more campaign email a month than this pace ` +
                `can deliver — at most ` +
                `${sendCeiling.deliverableMonthly.toLocaleString()} can ` +
                'actually leave this organization in a month. Campaigns past ' +
                'the hourly ceiling are deferred to the next hour, not ' +
                'refused.'}
            </Typography>
          ) : null}
        </>
      ) : null}
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
