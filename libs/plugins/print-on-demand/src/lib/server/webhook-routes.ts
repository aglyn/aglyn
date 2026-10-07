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

import { createHmac, timingSafeEqual } from 'node:crypto'
import { POD_COLLECTIONS } from '../constants/bundle-common'
import type { PodProviderId } from '../model/print-on-demand'
import { podProviderFor, readPodKeyring } from './config'
import { refreshPodOrder } from './orders'
import { isDocumentId, openWebhookToken, podDb, readStoredConnection } from './store'

/**
 * The services' webhook doors (AGL-3641): machine routes, so the console's
 * dispatcher skips its per-site gates and each door proves its caller itself
 * before it reads the payload.
 *
 * The address a service was given names the connection (`c`) and carries
 * that connection's own secret (`t`), compared in constant time; Printify
 * also signs the body with the same secret (`X-Pfy-Signature`). And the
 * payload is never believed: it only says WHICH order to look at, and the
 * order is then read from the service with the merchant's own token. A
 * forged notice can at most make the store ask the service about an order
 * it already sent.
 *
 * A verified notice is answered 200 even when it names an order this store
 * never sent — a service retries a non-2xx for days.
 */

function same(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

async function handle(request: Request, provider: PodProviderId): Promise<Response> {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })
  const keyring = readPodKeyring()
  if (!keyring) return Response.json({ error: 'Not found' }, { status: 404 })
  const url = new URL(request.url)
  const connection = String(url.searchParams.get('c') ?? '')
  const token = String(url.searchParams.get('t') ?? '')
  if (!isDocumentId(connection) || !connection.endsWith(`__${provider}`) || !token) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const rawBody = await request.text()
  const stored = readStoredConnection((await podDb().collection(POD_COLLECTIONS.connections).doc(connection).get()).data())
  const secret = stored ? openWebhookToken(stored, keyring) : null
  if (!stored || !secret || !same(secret, token)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (provider === 'printify') {
    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
    if (!same(expected, String(request.headers.get('x-pfy-signature') ?? ''))) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return Response.json({ ok: true, applied: 'unreadable' })
  }
  const sourceOrderId = podProviderFor(provider).webhookOrderId(body)
  if (!sourceOrderId) return Response.json({ ok: true, applied: 'not_an_order' })
  const snapshot = await podDb()
    .collection(POD_COLLECTIONS.orders)
    .where('sourceOrderKey', '==', `${provider}:${stored.storeId}:${sourceOrderId}`)
    .limit(1)
    .get()
  const doc = snapshot.docs[0]
  if (!doc || String(doc.get('hostId')) !== stored.hostId) return Response.json({ ok: true, applied: 'unknown_order' })
  const outcome = await refreshPodOrder(doc.id, { keyring })
  return Response.json({ ok: true, applied: outcome })
}

export function printfulWebhookRoute(request: Request): Promise<Response> {
  return handle(request, 'printful')
}

export function printifyWebhookRoute(request: Request): Promise<Response> {
  return handle(request, 'printify')
}
