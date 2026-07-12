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

import { assignExperimentVariant, type HostExperiment } from '@aglyn/plugins-marketing/model'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { createHmac, timingSafeEqual } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * Svix signature check (Resend webhooks): HMAC-SHA256 over
 * `{id}.{timestamp}.{payload}` with the base64 secret after `whsec_`;
 * the header carries space-delimited `v1,<base64sig>` entries.
 */
function verifySvix(
  secret: string,
  id: string,
  timestamp: string,
  payload: Buffer,
  signatureHeader: string,
): boolean {
  try {
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
    const expected = createHmac('sha256', key)
      .update(`${id}.${timestamp}.`)
      .update(payload)
      .digest()
    return signatureHeader.split(' ').some((entry) => {
      const [, signature] = entry.split(',')
      if (!signature) return false
      const candidate = Buffer.from(signature, 'base64')
      return (
        candidate.length === expected.length &&
        timingSafeEqual(candidate, expected)
      )
    })
  } catch {
    return false
  }
}

/** Tags arrive as an array of {name, value} or a plain map — accept both. */
function tagMap(raw: unknown): Record<string, string> {
  if (Array.isArray(raw)) {
    const map: Record<string, string> = {}
    for (const tag of raw) {
      if (tag?.name) map[String(tag.name)] = String(tag.value ?? '')
    }
    return map
  }
  if (raw && typeof raw === 'object') {
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([key, value]) => [
        key,
        String(value ?? ''),
      ]),
    )
  }
  return {}
}

/**
 * Resend event ingestion (AGL-268): opened/clicked events increment the
 * tagged campaign's stats; clicks on experiment sends also count as the
 * recipient's variant conversion — the variant re-derives
 * deterministically from the address, so nothing per-send is stored.
 * Counters accept repeat events (Resend fires opens repeatedly); they
 * are engagement meters, not unique counts.
 */
async function handler(request: Request): Promise<Response> {
  // Svix signs the RAW body: read the exact bytes off the Web request
  // (nothing else may consume the stream first) — no bodyParser config
  // needed on the App Router.
  const method = request.method
  const headers = Object.fromEntries(request.headers) as Partial<
    Record<string, string>
  >
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    return Response.json({ error: 'Webhook is not configured' }, { status: 501 })
  }
  const payload = Buffer.from(await request.arrayBuffer())
  const svixId = String(headers['svix-id'] ?? '')
  const svixTimestamp = String(headers['svix-timestamp'] ?? '')
  const svixSignature = String(headers['svix-signature'] ?? '')
  if (
    !svixId ||
    !svixTimestamp ||
    !verifySvix(secret, svixId, svixTimestamp, payload, svixSignature)
  ) {
    return Response.json({ error: 'Bad signature' }, { status: 401 })
  }

  try {
    const event = JSON.parse(payload.toString('utf8'))
    const type = String(event?.type ?? '')
    if (type !== 'email.opened' && type !== 'email.clicked') {
      return Response.json({ ignored: true }, { status: 200 })
    }
    const data = event?.data ?? {}
    const tags = tagMap(data?.tags)
    const hostId = tags['hostId']
    const campaignId = tags['campaignId']
    if (!hostId || !campaignId) {
      return Response.json({ ignored: true }, { status: 200 })
    }
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    await hostRef
      .collection('campaigns')
      .doc(campaignId)
      .set(
        {
          stats: {
            [type === 'email.opened' ? 'opens' : 'clicks']:
              FieldValue.increment(1),
          },
        },
        { merge: true },
      )
      .catch(() => undefined)

    // Experiment conversion (AGL-268): clicks are the signal.
    const experimentId = tags['experimentId']
    const recipient = String(
      Array.isArray(data?.to) ? (data.to[0] ?? '') : (data?.to ?? ''),
    )
      .trim()
      .toLowerCase()
    if (type === 'email.clicked' && experimentId && recipient) {
      const experimentSnapshot = await hostRef
        .collection('experiments')
        .doc(experimentId)
        .get()
      const experiment = experimentSnapshot.data() as
        | HostExperiment
        | undefined
      if (experimentSnapshot.exists && experiment) {
        const variant = assignExperimentVariant(
          experiment,
          experimentId,
          recipient,
        )
        if (variant) {
          await experimentSnapshot.ref
            .collection('stats')
            .doc(variant.id)
            .set(
              {
                conversions: FieldValue.increment(1),
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true },
            )
            .catch(() => undefined)
        }
      }
    }
    return Response.json({ ok: true }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ ok: true }, { status: 200 }) // never make Resend retry-storm
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
