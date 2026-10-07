/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Email sends for the Aglyn app's Email campaigns screens (AGL-3622): one in
 * every state the console draws — a draft, a scheduled send, one part way
 * through its batches, one held for review, two sent (one with every figure
 * recorded, one from before delivery events were recorded), a canceled one —
 * plus a campaign container one of them is filed under and the sent ones'
 * link rollups.
 *
 * Shapes are what `campaign-send.ts` writes to `orgs/{orgId}/campaigns/{id}`:
 * the site stamp (`hostId` + `visibleTo: ['host:{id}']`) the rules read, the
 * list fields (`createdAtMs`, `subjectTokens`, `emailCampaignId`) the lists
 * query, `stats` as the send and the delivery webhook count them, `resume`
 * for a batched send, and `sentAs` as the send records its sender.
 *
 * The rules admit an org read only for a member with a row at
 * `orgs/{orgId}/members/{uid}`, so the seeded owner's row is written here as
 * well (idempotent; a base seed that writes it first is unaffected).
 */

/** `nameSearchTokens` from `libs/aglyn/src/lib/app-utils/name-search.ts`: word prefixes, 12 deep. */
function nameSearchTokens(text) {
  const key = String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  const tokens = new Set()
  for (const word of key.split(' ')) {
    const capped = word.slice(0, 12)
    for (let end = 1; end <= capped.length; end += 1) {
      tokens.add(capped.slice(0, end))
      if (tokens.size >= 120) return [...tokens]
    }
  }
  return [...tokens]
}

export async function seedMarketing({ put, uid, orgId, hostId, now }) {
  const nowMs = now.getTime()
  const day = 24 * 60 * 60 * 1000
  const site = { hostId, visibleTo: [`host:${hostId}`] }
  const from = { from: 'hello@demo-site.example.test', fromName: 'Demo Site' }

  await put(`orgs/${orgId}/members/${uid}`, { uid, role: 'owner', allHosts: true, joinedAt: now })

  const campaignId = 'fall-launch'
  await put(`orgs/${orgId}/emailCampaigns/${campaignId}`, {
    name: 'Fall launch',
    nameLower: 'fall launch',
    nameTokens: nameSearchTokens('Fall launch'),
    visibleTo: ['org'],
    listIds: [],
    createdAtMs: nowMs - 20 * day,
    createdBy: uid,
  })

  const sends = [
    {
      id: 'welcome-series-draft',
      subject: 'Welcome to the new shop',
      status: 'draft',
      body: 'Hi {{firstName|there}}, our new shop is open.',
      audience: 'leads',
      displayName: 'Shop opening',
      emailCampaignId: null,
      createdAtMs: nowMs - 1 * day,
    },
    {
      id: 'fall-sale-scheduled',
      subject: 'Fall sale starts Friday',
      status: 'scheduled',
      body: 'Everything is 20% off from Friday.',
      audience: 'list',
      listId: 'newsletter',
      listName: 'Newsletter',
      fromName: 'Demo Site',
      emailCampaignId: campaignId,
      sendAtMs: nowMs + 3 * day,
      createdAtMs: nowMs - 2 * day,
    },
    {
      id: 'fall-sale-batching',
      subject: 'Last call for the fall sale',
      status: 'scheduled',
      body: 'Ends tonight.',
      audience: 'list',
      listId: 'newsletter',
      listName: 'Newsletter',
      emailCampaignId: campaignId,
      sendAtMs: nowMs + 60 * 60 * 1000,
      createdAtMs: nowMs - 3 * day,
      sentAt: new Date(nowMs - 2 * 60 * 60 * 1000),
      sendCount: 1,
      sentAs: from,
      resume: { remaining: 1200, batch: 1, nextAtMs: nowMs + 60 * 60 * 1000 },
      stats: { audienceSize: 2000, recipients: 800, sent: 800, delivered: 790, opens: 310, uniqueOpens: 240, clicks: 60, uniqueClicks: 51, bounced: 10, complained: 0, unsubscribes: 2, clickTracked: true, consented: 2000, suppressed: 0 },
    },
    {
      id: 'held-for-review',
      subject: 'Verify your account details',
      status: 'scheduled',
      body: 'Please confirm your details.',
      audience: 'leads',
      emailCampaignId: null,
      sendAtMs: 253402214400000,
      createdAtMs: nowMs - 4 * day,
      staffReview: { state: 'held', reference: 'HS-4821', heldAtMs: nowMs - 4 * day },
    },
    {
      id: 'summer-recap-sent',
      subject: 'Our summer in pictures',
      status: 'sent',
      body: 'Thanks for a great summer.',
      audience: 'list',
      listId: 'newsletter',
      listName: 'Newsletter',
      emailCampaignId: null,
      createdAtMs: nowMs - 30 * day,
      sentAt: new Date(nowMs - 29 * day),
      sendCount: 1,
      sentAs: { ...from, replyTo: 'support@demo-site.example.test' },
      resume: { remaining: 0, batch: 1, nextAtMs: 0 },
      stats: {
        audienceSize: 1240,
        recipients: 1200,
        sent: 1196,
        delivered: 1172,
        opens: 905,
        uniqueOpens: 611,
        clicks: 214,
        uniqueClicks: 162,
        bounced: 24,
        complained: 1,
        unsubscribes: 9,
        clickTracked: true,
        consented: 1200,
        consentWithheld: 40,
        suppressed: 4,
        cadenceHeld: 0,
        noMailServer: 0,
        gatewayHeld: 0,
      },
      links: {
        a1: { url: 'https://demo-site.example.test/gallery', clicks: 131 },
        a2: { url: 'https://demo-site.example.test/shop', clicks: 71 },
        a3: { url: 'https://demo-site.example.test/contact', clicks: 12 },
      },
    },
    {
      id: 'spring-hello-sent',
      subject: 'Hello from the spring market',
      status: 'sent',
      body: 'See you at the market.',
      audience: 'members',
      emailCampaignId: null,
      createdAtMs: nowMs - 180 * day,
      sentAt: new Date(nowMs - 180 * day),
      // Sent before delivery events were recorded: no `delivered`, so the
      // report withholds every rate over it.
      stats: { recipients: 300, sent: 300, opens: 120, clicks: 14 },
    },
    {
      id: 'canceled-promo',
      subject: 'Flash sale this weekend',
      status: 'canceled',
      body: 'Two days only.',
      audience: 'leads',
      emailCampaignId: campaignId,
      sendAtMs: nowMs - 5 * day,
      createdAtMs: nowMs - 9 * day,
      canceledAt: new Date(nowMs - 6 * day),
      canceledBy: uid,
    },
  ]

  for (const { id, links, ...send } of sends) {
    await put(`orgs/${orgId}/campaigns/${id}`, {
      ...site,
      ...send,
      subjectTokens: nameSearchTokens(send.subject),
    })
    if (links) {
      await put(`orgs/${orgId}/campaigns/${id}/reports/links`, { links, overflowClicks: 0, unattributedClicks: 0 })
    }
  }
  return { campaigns: 1, sends: sends.length }
}
