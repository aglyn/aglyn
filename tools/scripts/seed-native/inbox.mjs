/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Form submissions for the Aglyn app's Inbox (AGL-3622): unread and read
 * messages to three of the forms `seed/forms.mjs` writes, one already
 * answered (with the replies the reply route recorded), one a dataset
 * refused, and one from before its form was an entity, with no email field.
 *
 * Shapes are what `/api/forms/submit` (`form-submit.ts`) writes to
 * `hosts/{hostId}/formSubmissions/{id}`: `hostId` and `orgId` (which the
 * rules freeze, and which the organization's Inbox lists by), `formId` for a
 * verified form, `formName`, `path`, `fields`, `messageSearchFields`
 * (`senderTokens`, `searchTokens`), `read`, `createdAt` and `routing`. A
 * reply is what `/api/inbox/reply` adds under `replies`, with `read` and
 * `repliedAtMs` stamped on the submission.
 *
 * A site member reads a site's rows under the host catch-all; the every-site
 * list is a collection-group read the rules admit only for an org-wide
 * member, so the seeded owner's member row is written here as well
 * (idempotent; the same row the other seeds write).
 */

/*
 * `messageSearchFields` from `libs/aglyn/src/lib/app-utils/message-search.ts`
 * (and `nameSearchKey` from `name-search.ts`), so the From filter and the
 * search find the seeded rows the way they find real ones.
 */
const NAME_KEYS = ['name', 'fullname', 'yourname', 'firstname', 'contactname']
const EMAIL_KEYS = ['email', 'emailaddress']
const WORD_JOINS = /[@.+_-]/
const WORD_PARTS = /[@.+_-]+/
const WORD_EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu

const nameSearchKey = (text) => String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

function textOf(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(' ')
  return ''
}

function senderOf(entries) {
  const reduced = new Map()
  for (const [key, value] of entries) {
    const text = textOf(value).trim()
    if (!text) continue
    const at = key.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!reduced.has(at)) reduced.set(at, text)
  }
  const name = NAME_KEYS.map((key) => reduced.get(key)).find(Boolean)
  const email = EMAIL_KEYS.map((key) => reduced.get(key)).find(Boolean)
  return { ...(name ? { name } : {}), ...(email ? { email } : {}) }
}

function wordsOf(text) {
  const words = []
  for (const raw of nameSearchKey(text).split(' ')) {
    const word = raw.replace(WORD_EDGES, '')
    if (!word) continue
    words.push(word)
    if (WORD_JOINS.test(word)) {
      for (const part of word.split(WORD_PARTS)) if (part && part !== word) words.push(part)
    }
  }
  return words
}

function addPrefixes(tokens, words, max) {
  for (const word of words) {
    const capped = word.slice(0, 12)
    for (let end = 1; end <= capped.length; end += 1) {
      if (tokens.size >= max) return
      tokens.add(capped.slice(0, end))
    }
  }
}

export function messageSearchFields(fields) {
  const sorted = Object.entries(fields ?? {}).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  const sender = senderOf(sorted)
  const senderSet = new Set()
  addPrefixes(senderSet, [...wordsOf(sender.name ?? ''), ...wordsOf(sender.email ?? '')], 60)
  const words = new Set()
  for (const word of sorted.flatMap(([, value]) => wordsOf(textOf(value)))) {
    if (words.size >= 40) break
    words.add(word)
  }
  const search = new Set(senderSet)
  addPrefixes(search, [...words], 200)
  return { senderTokens: [...senderSet], searchTokens: [...search] }
}

export async function seedInbox({ put, uid, orgId, hostId, now }) {
  const nowMs = now.getTime()
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  await put(`orgs/${orgId}/members/${uid}`, { uid, role: 'owner', allHosts: true, joinedAt: now })

  const leads = { dataset: { id: 'leads', name: 'Leads', recordId: 'rec-1' } }
  const submissions = [
    {
      id: 'sub-priya',
      formId: 'contact',
      formName: 'Contact us',
      path: '/contact',
      ago: 25 * minute,
      read: false,
      fields: {
        name: 'Priya Nair',
        email: 'priya@lumen.example',
        phone: '(312) 555-0142',
        message: 'Do you ship to Canada? I would like to order twelve of the linen throws for a hotel lobby.',
      },
      routing: leads,
    },
    {
      id: 'sub-marcus',
      formId: 'quote-request',
      formName: 'Request a quote',
      path: '/services',
      ago: 3 * hour,
      read: false,
      fields: {
        name: 'Marcus Webb',
        email: 'marcus@webbandco.example',
        company: 'Webb & Co',
        budget: '$5k–$20k',
        details: 'A refresh of our storefront and an online booking page before the holidays.',
      },
      routing: leads,
    },
    {
      id: 'sub-elena',
      formId: 'contact',
      formName: 'Contact us',
      path: '/contact',
      ago: 9 * hour,
      read: true,
      replied: true,
      fields: {
        name: 'Elena Park',
        email: 'elena.park@example.com',
        message: 'Are you open on Sundays? I could only find weekday hours on the site.',
      },
      routing: leads,
    },
    {
      id: 'sub-tom',
      formId: 'event-rsvp',
      formName: 'Fall open house RSVP',
      path: '/events/open-house',
      ago: 2 * day,
      read: true,
      fields: { name: 'Tom Alvarez', email: 'tom.alvarez@example.com', guests: '3' },
    },
    {
      id: 'sub-aisha',
      formId: 'quote-request',
      formName: 'Request a quote',
      path: '/services',
      ago: 3 * day,
      read: false,
      fields: {
        name: 'Aisha Rahman',
        email: 'aisha@northwind.example',
        company: 'Northwind Studio',
        budget: 'Over $20k',
        details: 'We need a full rebrand site with a members area for 400 clients.',
      },
      routing: {
        datasetRefused: { id: 'leads', name: 'Leads', errors: { budget: 'Pick one of the listed budgets' } },
      },
    },
    {
      id: 'sub-ben',
      formId: 'contact',
      formName: 'Contact us',
      path: '/',
      ago: 5 * day,
      read: true,
      fields: { name: 'Ben Okafor', email: 'ben.okafor@example.com', message: 'Loved the workshop. Will there be another in spring?' },
      routing: leads,
    },
    {
      id: 'sub-grace',
      formId: 'quote-request',
      formName: 'Request a quote',
      path: '/pricing',
      ago: 8 * day,
      read: true,
      fields: {
        name: 'Grace Lin',
        email: 'grace@lin-design.example',
        company: 'Lin Design',
        budget: 'Under $5k',
        details: 'Just a landing page for a pop-up shop in November.',
      },
      routing: leads,
    },
    {
      id: 'sub-sofia',
      formId: 'contact',
      formName: 'Contact us',
      path: '/about',
      ago: 12 * day,
      read: true,
      fields: { name: 'Sofia Rossi', email: 'sofia.rossi@example.com', message: 'Can I pick up an order in person?' },
      routing: leads,
    },
    {
      // Sent before its form became an entity: no formId, and no email field.
      id: 'sub-legacy',
      formName: 'Get in touch',
      path: '/old-contact',
      ago: 40 * day,
      read: true,
      fields: { name: 'Walk-in visitor', message: 'Please call the front desk about the October order.' },
    },
  ]

  for (const submission of submissions) {
    const sentAtMs = nowMs - submission.ago + 40 * minute
    await put(`hosts/${hostId}/formSubmissions/${submission.id}`, {
      hostId,
      orgId,
      ...(submission.formId ? { formId: submission.formId } : {}),
      formName: submission.formName,
      path: submission.path,
      fields: submission.fields,
      ...messageSearchFields(submission.fields),
      read: submission.read,
      createdAt: new Date(nowMs - submission.ago),
      ...(submission.routing ? { routing: submission.routing } : {}),
      ...(submission.replied ? { repliedAtMs: sentAtMs } : {}),
    })
    if (submission.replied) {
      await put(`hosts/${hostId}/formSubmissions/${submission.id}/replies/reply-1`, {
        to: submission.fields.email,
        subject: 'Re: your message to Demo Site',
        message: 'Yes, we are open Sundays from 10 to 4. See you soon!',
        replyTo: 'mobile-owner@example.test',
        fromName: 'Demo Site',
        sentByUid: uid,
        providerMessageId: null,
        sentAtMs,
        createdAt: new Date(sentAtMs),
      })
    }
  }
  return { submissions: submissions.length }
}
