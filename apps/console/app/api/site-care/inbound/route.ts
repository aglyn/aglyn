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

import { inboundMailDomain, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { mailProviderReads, readInboundMailEvent } from '@aglyn/shared-util-email'
// By its own path, not the barrel: the check holds a `crypto` HMAC.
import { verifySvixSignature } from '@aglyn/shared-util-email/svix-signature'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  fileSiteCareInboundEmail,
  siteCareInboundTarget,
} from '@aglyn/tenant-data-admin/server/site-care-inbound'

// lockdown-423: exempt — a provider webhook (Svix-signed), no user caller; it turns a message to
// the Site Care address into a support ticket, and support must stay reachable under a lock.

/**
 * THE SITE CARE ADDRESS'S WEBHOOK (AGL-3959): `POST /api/site-care/inbound`.
 *
 * The mail provider receives mail for the inbound domain and announces each
 * message, signed the Svix way — the same notification the CRM's capture
 * webhook reads, on its own subscription. This route answers only messages
 * addressed to `care@` or `care+<requestId>@` that domain and files each as
 * a Site Care request or a reply on one (`site-care-inbound.ts`). Anything
 * else is acknowledged and ignored, never refused, so the provider does not
 * retry it forever.
 *
 * `SITE_CARE_INBOUND_WEBHOOK_SECRET` is the endpoint's own signing secret;
 * the delivery-events one, `RESEND_WEBHOOK_SECRET`, is accepted too, for a
 * deployment that subscribed received mail on the endpoint it already had.
 */

function secrets(env: Record<string, string | undefined> = process.env): string[] {
  return [
    ...new Set(
      [env['SITE_CARE_INBOUND_WEBHOOK_SECRET'], env['RESEND_WEBHOOK_SECRET']]
        .map((value) => String(value ?? '').trim())
        .filter(Boolean),
    ),
  ]
}

const acknowledge = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status })

async function handler(request: Request): Promise<Response> {
  const req = await pluginRequestFromWeb(request)
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })
  const keys = secrets()
  if (!keys.length) return Response.json({ error: 'The Site Care address is not configured' }, { status: 501 })
  const payload = Buffer.from(req.rawBody ?? '', 'utf8')
  const headers = req.headers as Partial<Record<string, string>>
  const svixId = String(headers['svix-id'] ?? '')
  const svixTimestamp = String(headers['svix-timestamp'] ?? '')
  const svixSignature = String(headers['svix-signature'] ?? '')
  const signed =
    svixId !== '' &&
    svixTimestamp !== '' &&
    keys.some((secret) => verifySvixSignature(secret, svixId, svixTimestamp, payload, svixSignature))
  if (!signed) return Response.json({ error: 'Bad signature' }, { status: 401 })

  let event: unknown
  try {
    event = JSON.parse(payload.toString('utf8'))
  } catch {
    return acknowledge(200, { ignored: true, reason: 'not-json' })
  }
  const inbound = readInboundMailEvent(event)
  if (!inbound) return acknowledge(200, { ignored: true, reason: 'not-received-event' })
  const target = siteCareInboundTarget(inbound.recipients, inboundMailDomain())
  if (!target) return acknowledge(202, { filed: false, reason: 'not-site-care' })

  try {
    const reads = mailProviderReads()
    const unmet = reads.unmet()
    if (unmet) {
      return Response.json({ error: `The Site Care address cannot read received mail. ${unmet}` }, { status: 501 })
    }
    const message = await reads.received(inbound.id)
    if (!message) return acknowledge(202, { filed: false, reason: 'message-gone' })
    const app = firebaseAdmin.app()
    const result = await fileSiteCareInboundEmail(app.firestore(), { target, message })
    return acknowledge(result.outcome === 'opened' || result.outcome === 'replied' ? 200 : 202, {
      ...result,
    })
  } catch (error) {
    // The body never reaches a log: the id is enough to find the delivery.
    console.error('[site-care] inbound failed', svixId, (error as Error)?.message)
    return Response.json({ error: 'The message could not be filed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
