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

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import {
  enrollListMember,
  orgDataCollectionForHost,
  upsertHostContact,
} from '@aglyn/tenant-data-admin'
import { isDocumentId } from '@aglyn/tenant-data-admin/server/document-id'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Enrolls one address into an org list's members (AGL-2499).
 *
 * The document id comes from `enrollListMember`, which is the only writer of
 * that collection — the workflow `enrollList` step reaches it too, and when
 * the two derived their own ids the same person subscribing by both routes
 * became two members of one list.
 *
 * Best-effort and silent on any problem: list enrollment rides along with
 * the newsletter signup, which must still succeed (and still upsert the
 * contact) even when the list id is stale, was mistyped into the besigner
 * prop, or belongs to an org this host cannot resolve.
 */
async function enrollInList(options: {
  hostId: string
  listId: string
  email: string
  name?: string
}): Promise<void> {
  if (!isDocumentId(options.listId)) return
  try {
    const contactsRef = await orgDataCollectionForHost(options.hostId, 'contacts')
    const listRef = contactsRef.parent?.collection('lists').doc(options.listId)
    if (!listRef) return
    const listSnapshot = await listRef.get()
    // A stale/mistyped id must not silently CREATE a list — campaign-send's
    // `list` audience would then read a list nobody set up.
    if (!listSnapshot.exists) return
    await enrollListMember({
      listRef,
      email: options.email,
      ...(options.name ? { name: options.name } : {}),
      source: 'newsletter',
    })
  } catch (error) {
    console.error('list enrollment failed', error)
  }
}

// Best-effort per-instance flood damper.
const attemptsByIp = new Map<string, number[]>()
import {
  NO_CLIENT_ADDRESS_BUCKET,
  readClientIp,
} from '@aglyn/aglyn/app-utils/request-ip'

/**
 * Newsletter opt-in (AGL-301): footer signups and checkout opt-ins land
 * in the contacts CRM with an explicit consent timestamp, feeding the
 * email-campaign audiences.
 */
export const newsletterHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
  const email = String(body.email ?? '')
    .trim()
    .toLowerCase()
  const listId = String(body.listId ?? '').trim()
  if (!hostId || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email' })
  }
  // Keeps counting under the no-address bucket rather than being skipped: an
  // unauthenticated signup endpoint that stops counting is an open write into
  // the contacts CRM.
  const ip =
    readClientIp(req.headers, { remoteAddress: req.socket?.remoteAddress }) ??
    NO_CLIENT_ADDRESS_BUCKET
  const now = Date.now()
  const attempts = (attemptsByIp.get(ip) ?? []).filter(
    (at) => now - at < 60_000,
  )
  attempts.push(now)
  attemptsByIp.set(ip, attempts)
  if (attempts.length > 10) {
    return res.status(429).json({ error: 'Too many attempts' })
  }
  try {
    await upsertHostContact({
      hostId,
      email,
      source: 'newsletter',
      marketingConsent: true,
      interaction: {
        refId: `newsletter-${now}`,
        summary: 'Subscribed to the newsletter',
      },
    })
    if (listId) {
      await enrollInList({ hostId, listId, email })
    }
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Signup failed' })
  }
}
