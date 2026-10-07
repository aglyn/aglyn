/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The member's notification feed (`users/{uid}/notifications`) for both
 * native apps' Home and Notifications screens: one row per family the rows
 * draw a glyph for (an order, a form submission, a booking, low stock, a
 * task, a lead, a digest, an AI job, billing and the team), unread and read,
 * spread over the last few days.
 *
 * Shapes are what `notifyUsers` (`libs/tenant/data/admin/src/lib/server/notifications.ts`)
 * writes: the emitter's payload (`type`, `title`, `body`, `link`, `orgId`,
 * `hostId`, and `level` when the emitter stamps one) with `read` and
 * `createdAt`, and `readAt` on a read row. Titles follow their emitters' own
 * wording, with `{site}` already filled in the way the fan-out fills it.
 * Links use the host-link shape (`/{hostId}/…`) every host notification uses.
 */

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

export async function seedNotifications({ put, uid, orgId, hostId, now }) {
  const at = (ago) => new Date(now.getTime() - ago)
  const site = 'Demo Site'
  const rows = [
    {
      id: 'n-order',
      type: 'content.order',
      title: `New order on ${site} — $52.37`,
      body: 'A shopper ordered 2 × Stoneware Mug on Demo Site.',
      link: `/${hostId}/orders`,
      ago: 12 * MINUTE,
    },
    {
      id: 'n-form',
      type: 'content.formSubmission',
      title: 'New form submission — Contact us',
      body: 'Someone submitted “Contact us” on Demo Site (page /contact).',
      link: `/${hostId}/inbox/submissions?submission=sub-priya`,
      ago: 47 * MINUTE,
    },
    {
      id: 'n-booking',
      type: 'content.booking',
      title: `New booking on ${site}`,
      body: 'Marcus Lee booked a Haircut on Demo Site for tomorrow at 10:00 AM.',
      link: `/${hostId}/bookings`,
      ago: 2 * HOUR,
    },
    {
      id: 'n-stock',
      type: 'content.lowStock',
      title: 'Low stock — House Blend Coffee Beans',
      body: 'House Blend Coffee Beans on Demo Site is down to 4 in stock across its tracked variants, at or below its low-stock threshold of 5.',
      link: `/${hostId}/products`,
      level: 'warning',
      ago: 5 * HOUR,
    },
    {
      id: 'n-lead',
      type: 'content.leadAssigned',
      title: 'Lead assigned to you — Priya Shah',
      body: 'Priya Shah from the Contact us form is yours to follow up.',
      link: '/demo-workspace/crm/leads',
      ago: 9 * HOUR,
      read: true,
    },
    {
      id: 'n-task',
      type: 'content.taskReminder',
      title: 'Task due today — Call back Marcus Lee',
      body: 'Call back Marcus Lee about the color consultation.',
      link: '/demo-workspace/crm/tasks',
      ago: 20 * HOUR,
      read: true,
    },
    {
      id: 'n-ai',
      type: 'content.aiJobDone',
      title: 'Your new page is ready',
      body: 'The About page you asked for on Demo Site is drafted. Review it, then publish.',
      link: `/${hostId}/screens`,
      level: 'success',
      ago: 26 * HOUR,
      read: true,
    },
    {
      id: 'n-digest',
      type: 'content.insightsDigest',
      title: 'Your week on Demo Site',
      body: '312 visits, 9 orders and 4 form submissions in the last 7 days.',
      link: `/${hostId}/analytics`,
      ago: 2 * 24 * HOUR,
      read: true,
    },
    {
      id: 'n-invoice',
      type: 'billing.invoice',
      title: 'Your invoice is available',
      body: 'Your Pro plan invoice for Demo Workspace is ready to view.',
      link: '/demo-workspace/billing',
      ago: 3 * 24 * HOUR,
      read: true,
    },
    {
      id: 'n-team',
      type: 'team.hostAccessGranted',
      title: 'You have access to Demo Site',
      body: 'You were added to Demo Site as an admin.',
      link: `/${hostId}`,
      ago: 4 * 24 * HOUR,
      read: true,
    },
  ]
  for (const { id, ago, read = false, level, ...row } of rows) {
    const createdAt = at(ago)
    await put(`users/${uid}/notifications/${id}`, {
      ...row,
      orgId,
      ...(row.link?.startsWith(`/${hostId}`) ? { hostId } : {}),
      ...(level ? { level } : {}),
      read,
      createdAt,
      ...(read ? { readAt: new Date(createdAt.getTime() + 30 * MINUTE) } : {}),
    })
  }
}
