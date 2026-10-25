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

import { NO_CLIENT_ADDRESS_BUCKET, readClientIp } from '@aglyn/aglyn/app-utils/request-ip'
import { consumeRateLimit } from '@aglyn/tenant-data-admin'
import { validityLabel, type WaiverTemplate } from '../model/waiver'
import { WAIVER_ADULT_AGE, WAIVER_ESIGN_CONSENT, signatureWindowLabel } from '../model/waiver-signature'
import { isDocumentId, waiversRefs } from './db'
import { json, publicSite, readJsonBody, refuse } from './gate'
import { requestAudit } from './signature-routes'
import { readSignableWaiver, recordSignature, siteBusinessName } from './sign'

/*==========================================
 * THE SIGNER'S DOORS (AGL-4042), with no account: the share link's page on
 * the console, and the site's Sign waiver element. Reading names only what a
 * signer is shown; signing is held to the forms plugin's protection — a
 * honeypot field a person never sees, answered as a success so a bot learns
 * nothing, and a per-site, per-address rate limit — on top of the
 * dispatcher's lockdown and write limit.
 *=========================================*/

const RATE_WINDOW_MS = 60_000
const RATE_MAX = 10

/** What a signer is shown of one waiver. */
export interface PublicWaiver {
  id: string
  version: number
  title: string
  body: string
  checkboxes: WaiverTemplate['checkboxes']
  allowMinors: boolean
  validityText: string
}

export interface PublicWaiverAnswer {
  site: { name: string }
  waiver: PublicWaiver
  consent: { text: string; version: number }
  adultAge: number
}

function publicWaiver(waiver: WaiverTemplate): PublicWaiver {
  return {
    id: waiver.id,
    version: waiver.version,
    title: waiver.title,
    body: waiver.body,
    checkboxes: waiver.checkboxes,
    allowMinors: waiver.allowMinors,
    validityText: validityLabel(waiver.validity),
  }
}

/** `GET waivers/public?hostId=` lists the site's published waivers; `&waiverId=` reads one to sign. */
export async function publicWaiverRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return refuse(405, 'Method not allowed')
  const params = new URL(request.url).searchParams
  const site = await publicSite(String(params.get('hostId') ?? ''))
  if (site.ok === false) return site.response
  const hostId = String(params.get('hostId'))
  const waiverId = params.get('waiverId')
  if (!waiverId) {
    const snapshot = await waiversRefs
      .waivers(site.orgId)
      .where('hostId', '==', hostId)
      .where('status', '==', 'published')
      .orderBy('updatedAtMs', 'desc')
      .limit(50)
      .get()
    return json({
      site: { name: siteBusinessName(site.host) },
      waivers: snapshot.docs.map((doc) => ({ id: doc.id, title: String(doc.get('title') ?? '') })),
    })
  }
  if (!isDocumentId(waiverId)) return refuse(404, 'This waiver is not available.')
  const found = await readSignableWaiver(site.orgId, hostId, waiverId)
  if (found.ok === false) return refuse(found.status, found.error)
  const answer: PublicWaiverAnswer = {
    site: { name: siteBusinessName(site.host) },
    waiver: publicWaiver(found.waiver),
    consent: { text: WAIVER_ESIGN_CONSENT.text, version: WAIVER_ESIGN_CONSENT.version },
    adultAge: WAIVER_ADULT_AGE,
  }
  return json(answer)
}

/** `POST waivers/sign`: a signer signs, before they arrive. */
export async function publicSignRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return refuse(405, 'Method not allowed')
  const body = await readJsonBody(request)
  const hostId = String(body['hostId'] ?? '')
  // Honeypot filled: a success to the bot, and nothing stored.
  if (typeof body['website'] === 'string' && body['website'].trim()) return json({ received: true }, 201)
  if (!isDocumentId(hostId)) return refuse(400, 'Missing hostId')
  const ip = readClientIp(request.headers) ?? NO_CLIENT_ADDRESS_BUCKET
  const rate = await consumeRateLimit(`waiver:${hostId}:${ip}`, { limit: RATE_MAX, windowMs: RATE_WINDOW_MS })
  if (!rate.allowed) {
    return Response.json(
      { error: 'Too many signatures from this device. Wait a minute and try again.' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rate.resetMs - Date.now()) / 1000))) } },
    )
  }
  const site = await publicSite(hostId)
  if (site.ok === false) return site.response
  const outcome = await recordSignature(
    { orgId: site.orgId, hostId, host: site.host, org: site.org, timeZone: site.timeZone },
    body,
    { method: 'online', audit: { ...requestAudit(request), staffUid: null, staffName: null } },
  )
  if (outcome.ok === false) return json({ error: outcome.error, ...(outcome.code ? { code: outcome.code } : {}) }, outcome.status)
  const signature = outcome.signature
  return json(
    {
      received: true,
      signatureId: signature.id,
      people: [signature.signer.name, ...signature.minors.map((minor) => minor.name)],
      window: signatureWindowLabel(signature),
      emailed: Boolean(signature.signer.email),
    },
    outcome.replayed ? 200 : 201,
  )
}
