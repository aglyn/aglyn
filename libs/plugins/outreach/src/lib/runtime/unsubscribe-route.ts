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

import type { PluginWebApiHandler } from '@aglyn/aglyn/server'
import { readOutreachComplianceSettingsDoc } from '../storage/compliance-settings-store'
import { outreachOrgCollection, readStoredOutreachEnrollment } from '../storage/outreach-records'
import { recordOutreachOptOut } from './enrollment-events'
import type { OutreachRuntimeDeps } from './runtime-deps'
import { readOutreachUnsubscribeToken } from './unsubscribe-link'

/**
 * ONE-CLICK UNSUBSCRIBE (AGL-2981): `GET` and `POST /api/outreach/unsubscribe?t=…`.
 *
 * The link in every Outreach email's `List-Unsubscribe` header. A mailbox
 * provider POSTs it with `List-Unsubscribe=One-Click` and no person present
 * (RFC 8058); a mail client that opens it for a person sends a GET. BOTH
 * act, and both answer a plain page saying it is done.
 *
 * That GET acts is deliberate, and the opposite of the platform's newsletter
 * links. A person who used their mail client's Unsubscribe command has asked
 * already, and a second button would be a way out with a hurdle in it. The
 * one caller that could fetch the link without asking — a link scanner — can
 * only make a cold sequence stop writing to somebody, which is the direction
 * cold email should err in.
 *
 * No sign-in: the signature in the token is the authority, and a token that
 * does not verify changes nothing. It is registered as a recipient link, so
 * it answers whether or not Outreach is released to the organization now —
 * an opt-out outlives a paused rollout. Each act is idempotent: the link
 * used twice changes nothing the first use did not.
 *
 * What it records is what a reply saying "stop" records: the organization's
 * do-not-contact list, the site's `sales` topic, and every open enrollment
 * of the address stopped. An enrollment that no longer exists belongs to a
 * person or a workspace already erased, whose every site already refuses
 * them; the page says the same thing either way, and reveals nothing.
 */

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
  'Referrer-Policy': 'no-referrer',
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)

/** The plain page both methods answer with. */
export function outreachUnsubscribePage(input: { title: string; body: string }, status = 200): Response {
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    // The reader's own colors, light or dark: the page has no theme to take.
    '<meta name="color-scheme" content="light dark">' +
    `<title>${escapeHtml(input.title)}</title>` +
    '<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}h1{font-size:1.5rem}</style>' +
    `</head><body><main><h1>${escapeHtml(input.title)}</h1><p>${escapeHtml(input.body)}</p></main></body></html>`
  return new Response(html, { status, headers: PAGE_HEADERS })
}

export function createOutreachUnsubscribeRoute(
  deps: Pick<OutreachRuntimeDeps, 'firestore' | 'now' | 'optOutOfSalesTopic'>,
): PluginWebApiHandler {
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } })
    }
    const target = readOutreachUnsubscribeToken(new URL(request.url).searchParams.get('t'))
    if (!target) {
      return outreachUnsubscribePage(
        {
          title: 'This link doesn’t work',
          body: 'This unsubscribe link isn’t valid. To stop these emails, reply to one of them with “no”.',
        },
        400,
      )
    }
    const firestore = deps.firestore()
    const snapshot = await outreachOrgCollection(firestore, target.orgId, 'enrollments').doc(target.enrollmentId).get()
    const enrollment = readStoredOutreachEnrollment(target.enrollmentId, snapshot.exists ? snapshot.data() : undefined)
    if (enrollment) {
      await recordOutreachOptOut(deps, {
        orgId: target.orgId,
        email: enrollment.email,
        source: 'unsubscribe',
        enrollment,
        hostIds: [enrollment.hostId],
        detail: request.method === 'POST' ? 'One-click unsubscribe.' : 'Used the unsubscribe link.',
        nowMs: deps.now(),
      })
    }
    const settings = await readOutreachComplianceSettingsDoc(firestore, target.orgId).catch(() => null)
    const sender = settings?.brandName || settings?.legalName || 'The sender'
    return outreachUnsubscribePage({
      title: 'You’re unsubscribed',
      body: `${sender} won’t send you any more of these emails.`,
    })
  }
}
