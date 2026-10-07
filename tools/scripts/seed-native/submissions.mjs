/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A site's forms for the Aglyn app's Forms screens (AGL-3622): four in use
 * and one retired, each with what it collected.
 *
 * Shapes are what `/api/hosts/resources` writes to `hosts/{hostId}/forms/{id}`
 * for a form: the allowed fields (`displayName`, `slug`, the declared
 * `fields`, `routing`), `newFormListFields` (`nameLower`, `nameTokens`,
 * `nameReversed`, `searchTokens`, `retired`, `inCampaign`, `stats`) and the
 * create stamps. `stats` holds the counters the submit route increments; the
 * submission counts agree with the rows `seed/inbox.mjs` writes for the same
 * form ids. A site member reads them under the host catch-all.
 */

const key = (text) => String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

/** `nameSearchTokens` from `libs/aglyn/src/lib/app-utils/name-search.ts`: word prefixes, 12 deep. */
function nameSearchTokens(text) {
  const tokens = new Set()
  for (const word of key(text).split(' ')) {
    if (!word) continue
    const capped = word.slice(0, 12)
    for (let end = 1; end <= capped.length; end += 1) {
      tokens.add(capped.slice(0, end))
      if (tokens.size >= 120) return [...tokens]
    }
  }
  return [...tokens]
}

/** `formListFields` from `libs/aglyn/src/lib/app-utils/forms.ts`. */
function formListFields({ id, displayName, slug }) {
  return {
    nameLower: key(displayName),
    nameTokens: nameSearchTokens(displayName),
    nameReversed: [...key(displayName)].reverse().join(''),
    searchTokens: [
      ...new Set([
        ...nameSearchTokens(displayName),
        ...nameSearchTokens(String(slug ?? '').replace(/-+/g, ' ')),
        ...nameSearchTokens(id),
      ]),
    ],
  }
}

const field = (fieldName, label, fieldType, extra = {}) => ({ fieldName, label, fieldType, ...extra })

export async function seedForms({ put, uid, hostId, now }) {
  const nowMs = now.getTime()
  const day = 24 * 60 * 60 * 1000
  const forms = [
    {
      id: 'contact',
      displayName: 'Contact us',
      fields: [
        field('name', 'Your name', 'text', { required: true, role: 'name' }),
        field('email', 'Email', 'email', { required: true, role: 'email' }),
        field('phone', 'Phone', 'text', { role: 'phone' }),
        field('message', 'How can we help?', 'textarea', { required: true }),
      ],
      lead: true,
      stats: { submissions: 4, leads: 3, views: 412, lastSubmissionAtMs: nowMs - 25 * 60 * 1000 },
      createdDaysAgo: 120,
    },
    {
      id: 'quote-request',
      displayName: 'Request a quote',
      fields: [
        field('name', 'Name', 'text', { required: true, role: 'name' }),
        field('email', 'Email', 'email', { required: true, role: 'email' }),
        field('company', 'Company', 'text'),
        field('budget', 'Budget', 'select', { options: ['Under $5k', '$5k–$20k', 'Over $20k'] }),
        field('details', 'Project details', 'textarea', { required: true }),
      ],
      lead: true,
      stats: { submissions: 3, leads: 3, views: 188, lastSubmissionAtMs: nowMs - 3 * 60 * 60 * 1000 },
      createdDaysAgo: 60,
    },
    {
      id: 'event-rsvp',
      displayName: 'Fall open house RSVP',
      fields: [
        field('name', 'Name', 'text', { required: true, role: 'name' }),
        field('email', 'Email', 'email', { required: true, role: 'email' }),
        field('guests', 'Guests', 'select', { options: ['1', '2', '3', '4'] }),
      ],
      lead: false,
      stats: { submissions: 1, leads: null, views: 95, lastSubmissionAtMs: nowMs - 2 * day },
      createdDaysAgo: 14,
    },
    {
      id: 'newsletter',
      displayName: 'Newsletter sign-up',
      fields: [field('email', 'Email', 'email', { required: true, role: 'email' })],
      lead: false,
      stats: { submissions: null, leads: null, views: 37, lastSubmissionAtMs: null },
      createdDaysAgo: 3,
    },
    {
      id: 'feedback-2025',
      displayName: 'Feedback survey 2025',
      fields: [
        field('rating', 'Rating', 'rating'),
        field('comments', 'Comments', 'textarea'),
      ],
      lead: false,
      retired: true,
      stats: { submissions: 0, leads: null, views: 0, lastSubmissionAtMs: null },
      createdDaysAgo: 300,
    },
  ]
  for (const form of forms) {
    const slug = form.id
    await put(`hosts/${hostId}/forms/${form.id}`, {
      displayName: form.displayName,
      slug,
      fields: form.fields,
      routing: { lead: form.lead },
      ...formListFields({ id: form.id, displayName: form.displayName, slug }),
      retired: form.retired === true,
      ...(form.retired ? { archivedAt: new Date(nowMs - 30 * day) } : {}),
      inCampaign: false,
      stats: form.stats,
      createdAt: new Date(nowMs - form.createdDaysAgo * day),
      updatedAt: new Date(nowMs - Math.min(form.createdDaysAgo, 2) * day),
      createdBy: uid,
    })
  }
  return { forms: forms.length }
}
