/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The demo workspace's usage this month (AGL-3992), so the apps' plan card
 * and Billing › Usage show meters at believable fills rather than zeros. Each
 * figure is written where the console's own reader finds it, against the
 * demo org's Pro plan:
 *
 * - storage: the site's media byte counter (`hosts/{host}/counters/media`,
 *   which `resolveOrgMediaBand` sums), ~61% of the 3 x 5120 MB pool;
 * - bandwidth: the org library's media delivery on today's org day document
 *   (`orgs/{org}/analytics/{day}.mediaBandwidthBytes`, which
 *   `/api/billing/host-usage?orgId` reads), with the sites' seeded page views
 *   on top, ~70% of the 25 GB band;
 * - campaign emails: the month's `counters/campaignEmailSends`, 1,640 of 2,500;
 * - data storage: the monthly rollup's `dataStorageMb`, 412.5 of 2,048 MB;
 * - AI credits: the month's `assistUsage` spend, 420 credits.
 */

const MB = 1024 * 1024

export async function seedUsage({ put, orgId, hostId, now }) {
  const month = now.toISOString().slice(0, 7)
  const day = now.toISOString().slice(0, 10)

  await put(`hosts/${hostId}/counters/media`, { bytes: Math.round(3 * 5120 * 0.61 * MB) })
  await put(`orgs/${orgId}/analytics/${day}`, { total: 0, mediaBandwidthBytes: 17 * 1024 * MB })
  await put(`orgs/${orgId}/counters/campaignEmailSends`, { [month]: 1640 })
  await put(`orgs/${orgId}/usage/${month}`, { dataStorageMb: 412.5 })
  await put(`orgs/${orgId}/assistUsage/${month}`, { estCostUsd: 0.42 })
}
