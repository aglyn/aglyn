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

import {
  CRM_INBOUND_CEILING_ACTION,
  CRM_INBOUND_UNMATCHED_ACTION,
  crmInboundDomain,
  crmInboundTokensIn,
  isReleaseFlagOnForOrg,
  parseOrgReleaseFlagOverrides,
  pluginRequestFromWeb,
  resolveEffectivePlan,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/server'
import {
  type ReceivedEmailSource,
  resendReceivedEmailSource,
  resendReceivedEventId,
  resendReceivedEventRecipients,
} from '@aglyn/shared-util-email'
// By its own path, not the barrel: the check holds a `crypto` HMAC, and the
// barrel is reached from the browser through the campaign model.
import { verifySvixSignature } from '@aglyn/shared-util-email/svix-signature'
import {
  crmInboundHostIds,
  fileCrmInboundEmail,
  findOrgByCrmInboundToken,
  firebaseAdmin,
  getServerReleaseFlagValues,
  listOrgMembers,
  logOrgActivity,
} from '@aglyn/tenant-data-admin'

// lockdown-423: exempt — a provider webhook (Svix-signed), no user caller; it files one received message on the record it was with and reads nothing a locked org could lose.

/**
 * THE CAPTURE WEBHOOK (AGL-2657): `POST /api/crm/inbound`.
 *
 * Resend receives mail for the capture domain and announces each message
 * as an `email.received` event, signed the Svix way. This route verifies
 * the signature, finds the capture token among the event's recipients,
 * resolves the workspace the token names, reads the message from the
 * receiving API, and files it on the record of whoever it was with — see
 * `fileCrmInboundEmail` for the matching and `crm-inbound.ts` for the
 * rules. A message nobody in the workspace knows is noted in the org's
 * feed by its sender's domain and dropped.
 *
 * ## Why a route of its own, and not a plugin API path
 *
 * The plugin dispatcher gates every path on the org's release flag, and
 * resolves the org from a `hostId` the caller names. A webhook names no
 * site — the workspace is inside the address — so under the dispatcher
 * every delivery would be a subject-less request, which a partial rollout
 * refuses. Here the org is resolved from the token first and the flag is
 * judged for THAT org, which is the gate the CRM actually ships behind.
 *
 * ## What the provider is told
 *
 * A signed event is never answered with an error the provider would retry
 * forever: an event that is not a received message, a token nobody holds,
 * a workspace whose CRM is off, a message that matched no record — each
 * is acknowledged, `200` or `202`, with a `reason` in the body for a
 * person reading the delivery log. Only a bad signature (`401`), a missing
 * secret or read key (`501`), and a failure of ours (`500`) are refused,
 * and a `500` is the one the provider SHOULD retry.
 *
 * ## The body never reaches a log
 *
 * The message is read into memory, reduced to the row's bounded excerpt,
 * and released. Nothing here prints it, and the feed line for an
 * unmatched message carries the sender's domain and nothing else: a
 * stranger's mail to a stale address is not the workspace's to keep.
 *
 * ## Two secrets
 *
 * A Resend webhook endpoint carries its own signing secret. The capture
 * endpoint is its own subscription, so `CRM_INBOUND_WEBHOOK_SECRET` is
 * tried first; `RESEND_WEBHOOK_SECRET` — the delivery-events endpoint's —
 * is accepted too, for a deployment that subscribed `email.received` on
 * the endpoint it already had. The check itself is the one the
 * delivery-events webhook runs.
 */

/** The signing secrets a delivery may carry, dedicated first. */
export function inboundWebhookSecrets(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const secrets = [env['CRM_INBOUND_WEBHOOK_SECRET'], env['RESEND_WEBHOOK_SECRET']]
    .map((value) => String(value ?? '').trim())
    .filter((value) => value !== '')
  return [...new Set(secrets)]
}

/** The full-access key received mail is read with; `''` when unset. */
export function inboundReadApiKey(env: Record<string, string | undefined> = process.env): string {
  return String(env['RESEND_READ_API_KEY'] ?? '').trim()
}

/**
 * The reader the route uses — Resend's, unless a spec hands one in through
 * the module's seam. A function of the key so no fetch is built until a
 * signed event needs one.
 */
let readerFactory: (apiKey: string) => ReceivedEmailSource = resendReceivedEmailSource

/** The spec's seam: reads without the provider. */
export function setInboundReaderForTesting(
  factory: ((apiKey: string) => ReceivedEmailSource) | null,
): void {
  readerFactory = factory ?? resendReceivedEmailSource
}

const acknowledge = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status })

async function handler(request: Request): Promise<Response> {
  const req = await pluginRequestFromWeb(request)
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const secrets = inboundWebhookSecrets()
  if (!secrets.length) {
    return Response.json({ error: 'Email capture is not configured' }, { status: 501 })
  }
  const payload = Buffer.from(req.rawBody ?? '', 'utf8')
  const headers = req.headers as Partial<Record<string, string>>
  const svixId = String(headers['svix-id'] ?? '')
  const svixTimestamp = String(headers['svix-timestamp'] ?? '')
  const svixSignature = String(headers['svix-signature'] ?? '')
  const signed =
    svixId !== '' &&
    svixTimestamp !== '' &&
    secrets.some((secret) =>
      verifySvixSignature(secret, svixId, svixTimestamp, payload, svixSignature),
    )
  if (!signed) return Response.json({ error: 'Bad signature' }, { status: 401 })

  let event: unknown
  try {
    event = JSON.parse(payload.toString('utf8'))
  } catch {
    return acknowledge(200, { ignored: true, reason: 'not-json' })
  }
  const emailId = resendReceivedEventId(event)
  if (!emailId) return acknowledge(200, { ignored: true, reason: 'not-received-event' })

  const domain = crmInboundDomain()
  const tokens = crmInboundTokensIn(resendReceivedEventRecipients(event), domain)
  if (!tokens.length) return acknowledge(202, { filed: false, reason: 'no-token' })

  try {
    const firestore = firebaseAdmin.app().firestore()
    // The first token that names a workspace: a message copied to two
    // workspaces' addresses is filed on the first, which is the only
    // reading that keeps one message one row.
    let resolved: Awaited<ReturnType<typeof findOrgByCrmInboundToken>> = null
    for (const token of tokens) {
      resolved = await findOrgByCrmInboundToken(firestore, token)
      if (resolved) break
    }
    if (!resolved) return acknowledge(202, { filed: false, reason: 'unknown-token' })
    const { orgId, org } = resolved

    // The gate the CRM ships behind, judged for the org the token named:
    // the plan carries the CRM and the release flag is on for it.
    if (resolveOrgEntitlements(org as never).features?.['crm'] !== true) {
      return acknowledge(202, { filed: false, reason: 'not-entitled' })
    }
    const flagValues = await getServerReleaseFlagValues()
    const flagOn = isReleaseFlagOnForOrg(
      'release_crm',
      flagValues['release_crm'],
      orgId,
      parseOrgReleaseFlagOverrides(org['releaseFlags']),
      resolveEffectivePlan(org as never),
    )
    if (!flagOn) return acknowledge(202, { filed: false, reason: 'release-flag' })

    const apiKey = inboundReadApiKey()
    if (!apiKey) {
      console.warn('[crm] inbound: RESEND_READ_API_KEY is unset; received mail cannot be read')
      return Response.json(
        { error: 'Email capture cannot read received mail (RESEND_READ_API_KEY).' },
        { status: 501 },
      )
    }
    const message = await readerFactory(apiKey)(emailId)
    if (!message) return acknowledge(202, { filed: false, reason: 'message-gone' })

    const [members, hostIds] = await Promise.all([
      listOrgMembers(orgId),
      crmInboundHostIds(firestore, orgId),
    ])
    const result = await fileCrmInboundEmail(firestore, {
      orgId,
      org,
      message,
      domain,
      members: members
        .filter((member) => member.orgSuspended !== true && member.email)
        .map((member) => ({
          uid: member.$id,
          email: String(member.email),
          name: member.displayName ?? null,
        })),
      hostIds,
    })

    switch (result.outcome) {
      case 'filed':
        return acknowledge(200, {
          filed: true,
          activityId: result.activityId,
          direction: result.match.direction,
          kind: result.match.kind,
        })
      case 'duplicate':
        return acknowledge(200, { filed: false, reason: 'duplicate', activityId: result.activityId })
      case 'ceiling':
        await logOrgActivity(orgId, { uid: null }, CRM_INBOUND_CEILING_ACTION, {
          type: result.match.kind === 'lead' ? 'lead' : 'contact',
          ...(result.match.link.contactId
            ? { id: String(result.match.link.contactId) }
            : result.match.link.leadId
              ? { id: String(result.match.link.leadId) }
              : {}),
        })
        return acknowledge(202, { filed: false, reason: 'ceiling' })
      case 'unmatched':
      default:
        // The sender's domain and nothing else: the feed says a message
        // arrived that nobody could be matched to, never what it said.
        await logOrgActivity(orgId, { uid: null }, CRM_INBOUND_UNMATCHED_ACTION, {
          type: 'contact',
          ...(result.senderDomain ? { name: result.senderDomain } : {}),
        })
        return acknowledge(202, { filed: false, reason: 'unmatched' })
    }
  } catch (error) {
    console.error('[crm] inbound capture failed', svixId, (error as Error)?.message)
    return Response.json({ error: 'The message could not be filed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
