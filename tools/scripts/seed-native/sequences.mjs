/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The workspace's outreach sequences (AGL-3966), so the Aglyn app's
 * Sequences screens (the list, a sequence's people, mailboxes) show rows:
 *
 * - The workspace opens Outreach the way staff open it for a customer: the
 *   per-org overrides the console reads, `releaseFlags.release_outreach` and
 *   `entitlements.features.outreach` on `orgs/{orgId}` (the Pro plan leaves
 *   Outreach out, and its release flag is off by default).
 * - `orgs/{orgId}/outreachSettings/compliance`, `outreachMailboxes`,
 *   `outreachSequences` and `outreachEnrollments` in the shapes of
 *   outreach.types.ts, against the CRM seed's contacts (`personKey` ids).
 *
 * Nothing here can send: the mailbox is PAUSED and holds no grant, no
 * sequence is active and no enrollment is active or due.
 */

import { createHash } from 'node:crypto'
import { emailSearchTokens } from '../lib/email-search-tokens.mjs'
import { nameSearchTokens } from '../lib/name-search-tokens.mjs'

const DAY = 24 * 60 * 60_000
/** The CRM seed's contact id for an address (people.mjs). */
const personKey = (email) => createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex')

export async function seedSequences({ put, uid, orgId, hostId, now: date, nameSearchFields }) {
  const now = date.getTime()
  await put(
    `orgs/${orgId}`,
    { releaseFlags: { release_outreach: true }, entitlements: { features: { outreach: true } } },
    { merge: true },
  )
  await put(`orgs/${orgId}/outreachSettings/compliance`, {
    legalName: 'Juniper Street Co. LLC',
    brandName: 'Juniper Street Co.',
    postalAddress: '100 Main St\nAustin, TX 78701',
    allowedCountries: ['US'],
    updatedAtMs: now - 30 * DAY,
    updatedByUid: uid,
  })

  const mailbox = 'seed-mailbox-hannah'
  const address = 'hannah@juniperstreet.example'
  await put(`orgs/${orgId}/outreachMailboxes/${mailbox}`, {
    provider: 'google',
    email: address,
    sendAs: address,
    sendAsOptions: [{ email: address, displayName: 'Hannah Reyes', isPrimary: true, isDefault: true }],
    displayName: 'Hannah Reyes',
    status: 'paused',
    dailyCap: 20,
    window: { days: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 17 * 60 },
    timezone: 'America/Chicago',
    rampStartedAtMs: null,
    health: { sentToday: 0, sentOnDay: null, bounces: 0, replies: 2, lastSentAtMs: now - 6 * DAY, lastErrorAtMs: null, lastErrorCode: null },
    connectedByUid: uid,
    connectedAtMs: now - 40 * DAY,
    createdAtMs: now - 40 * DAY,
    updatedAtMs: now - 2 * DAY,
  })

  const settings = { window: null, allowedCountries: ['US'], allowCustomers: false, trackClicks: false, countOpens: false, listUnsubscribe: true }
  const sequences = [
    {
      id: 'seed-sequence-catering',
      name: 'Office catering follow-up',
      status: 'paused',
      days: 25,
      steps: [
        {
          id: 'step-intro',
          kind: 'email',
          delayBusinessDays: 0,
          subject: 'Lunch for the {{contact.company}} team?',
          replyInThread: false,
          body: 'Hi {{contact.firstName}},\n\n{{enrollment.personalLine}}\n\nWe bake office lunch boxes every weekday. Want a tasting tray?',
          templateId: null,
        },
        { id: 'step-call', kind: 'task', taskKind: 'call', title: 'Call about a tasting', delayBusinessDays: 2 },
        {
          id: 'step-nudge',
          kind: 'email',
          delayBusinessDays: 3,
          subject: '',
          replyInThread: true,
          body: 'Just following up, {{contact.firstName}}. Happy to drop a tray by on Friday.',
          templateId: null,
        },
      ],
      stats: { sent: 7, people: 3 },
    },
    {
      id: 'seed-sequence-wholesale',
      name: 'Wholesale cafes',
      status: 'draft',
      days: 3,
      steps: [
        {
          id: 'step-wholesale',
          kind: 'email',
          delayBusinessDays: 0,
          subject: 'Pastries for {{contact.company}}',
          replyInThread: false,
          body: 'Hi {{contact.firstName}},\n\nWe deliver croissants and cinnamon rolls to cafes before 7 AM.',
          templateId: null,
        },
      ],
    },
  ]
  for (const { id, days, ...sequence } of sequences) {
    await put(`orgs/${orgId}/outreachSequences/${id}`, {
      ...sequence,
      ...nameSearchFields(sequence.name),
      hostId,
      mailboxId: mailbox,
      settings,
      createdAtMs: now - days * DAY,
      updatedAtMs: now - Math.min(days, 2) * DAY,
    })
  }

  const people = [
    ['daniel.kim@harbormarket.example', 'Daniel Kim', 'finished', 3, null, 'I loved the photos of your new storefront.'],
    ['marcus.hale@larkspur.example', 'Marcus Hale', 'replied', 1, 'reply', 'Your cold brew menu caught my eye.'],
    ['lena.fischer@fernhill.example', 'Lena Fischer', 'paused', 1, 'manual', 'Congrats on the spring wedding season.'],
  ]
  for (const [email, contactName, status, stepIndex, stopReason, personalLine] of people) {
    const contactId = personKey(email)
    const sentAtMs = now - (8 - stepIndex) * DAY
    await put(`orgs/${orgId}/outreachEnrollments/seed-sequence-catering_${contactId}`, {
      sequenceId: 'seed-sequence-catering',
      target: 'contact',
      contactId,
      leadId: null,
      contactName,
      email,
      searchTokens: [...new Set([...nameSearchTokens(contactName), ...emailSearchTokens(email)])],
      hostId,
      mailboxId: mailbox,
      stepIndex,
      nextDueAtMs: null,
      status,
      stopReason,
      stopDetail: null,
      stoppedAtMs: stopReason ? now - 5 * DAY : null,
      stoppedByUid: stopReason === 'manual' ? uid : null,
      personalLine,
      cold: false,
      attestations: {},
      enrolledByUid: uid,
      gmailThreadId: null,
      gmailThreadIds: [],
      threadSubject: 'Lunch for the team?',
      messageIds: [],
      lastSentAtMs: sentAtMs,
      createdAtMs: now - 10 * DAY,
      updatedAtMs: now - 5 * DAY,
    })
  }
  return `outreach opened, 1 paused mailbox, ${sequences.length} sequences, ${people.length} people`
}
