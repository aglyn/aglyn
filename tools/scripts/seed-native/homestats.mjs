/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Home's numbers and a page's history for the native apps (AGL-4011): the plan the workspace's team proposed (the
 * workspace Home's card), the main site's visitor accounts with the accounts switch on (Newest site users), a second
 * site with accounts on and nobody signed up yet (its empty state), and activity filed against pages (each page's
 * Page Activity, an AI-written page and an automation run among them). Traffic, page traffic and campaigns come from
 * the insights and marketing areas. Invented people only.
 */

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

export async function seedHomestats({ put, uid, orgId, hostId, now: date }) {
  const now = date.getTime()
  // What `/api/admin/org-upgrade-proposal` writes: shown on the workspace's Home while no subscription is mirrored live.
  await put(
    `orgs/${orgId}`,
    { upgradeProposal: { plan: 'business', proposedBy: 'staff-seed', proposedAt: now - 2 * DAY, note: 'Covers the catering site and the second location.' } },
    { merge: true },
  )
  // The accounts switch is off for a site until it opts in (`defaultOffPerSite`).
  await put(`hosts/${hostId}`, { enabledPlugins: ['accounts'] }, { merge: true })
  await put(`hosts/mobile-bloom-bakery`, { enabledPlugins: ['accounts'] }, { merge: true })
  const members = [
    ['sm-1', { displayName: 'Jordan Lee', email: 'jordan.lee@example.com' }, 3 * HOUR],
    ['sm-2', { displayName: 'Priya Shah', email: 'priya@example.com' }, 1 * DAY],
    ['sm-3', { email: 'casey.morgan@example.com' }, 3 * DAY],
    ['sm-4', { displayName: 'Alex Rivera', email: 'alex.rivera@example.com' }, 9 * DAY],
  ]
  for (const [id, fields, ago] of members) {
    await put(`hosts/${hostId}/siteMembers/${id}`, { ...fields, suspended: false, createdAt: new Date(now - ago) })
  }
  const pageActivity = [
    ['Published version', { type: 'screen', id: 'home', name: 'Home' }, 4 * HOUR, { actorEmail: 'mobile-owner@example.test' }],
    ['Updated SEO', { type: 'screen', id: 'menu', name: 'Menu' }, 1 * DAY, { actorEmail: 'mobile-owner@example.test' }],
    ['ai.job.output', { type: 'screen', id: 'menu', name: 'Menu' }, 3 * DAY, { actorEmail: 'mobile-owner@example.test' }],
    ['Changed page access', { type: 'screen', id: 'menu', name: 'Menu' }, 6 * DAY, { actorId: 'api', apiKeyName: 'Zapier' }],
    // A uid and no address: the apps name it by the address the account holds now (`/api/hosts/activity-actors`).
    ['Updated page settings', { type: 'screen', id: 'home', name: 'Home' }, 2 * DAY, { actorId: uid }],
    ['Action ran on formSubmitted', { type: 'workflow', id: 'wf-follow-up', name: 'Order follow-up' }, 7 * HOUR, { actorId: 'system:engine' }],
  ]
  for (const [index, [action, target, ago, actor]] of pageActivity.entries()) {
    await put(`hosts/${hostId}/activity/seed-homestats-${index}`, { action, target, ...actor, createdAt: new Date(now - ago) })
  }
  return `a proposed plan, ${members.length} site accounts, ${pageActivity.length} page activity rows`
}
