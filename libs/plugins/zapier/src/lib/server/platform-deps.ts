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

import { readApiKeyGrant } from '@aglyn/tenant-data-admin/server/api-keys'
import {
  describeConfiguredUrlRefusal,
  fetchConfiguredPublicUrl,
} from '@aglyn/tenant-data-admin/server/configured-url-fetch'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { getOrgDoc } from '@aglyn/tenant-data-admin/server/organizations'
import {
  PLUGIN_EVENT_MAX_ATTEMPTS,
  raisePluginEvent,
} from '@aglyn/tenant-data-admin/server/plugin-event-outbox'
import { getSiteLockdown } from '@aglyn/tenant-data-admin/server/tenant-write-lockdown'
import type { PluginDomainEventEnvelope } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import type { HostEventContext, HostEventPayload } from '@aglyn/tenant-runtime/host-event-listeners'
import { randomBytes } from 'node:crypto'
import {
  ZAPIER_APP_URL_ENV,
  ZAPIER_DELIVERY_TIMEOUT_MS,
  ZAPIER_PLUGIN_ID,
  ZAPIER_RELAY_EVENT,
} from '../constants'
import { zapierHookEventSpec, type ZapierHookEvent } from '../model/hook-events'
import { createZapierConsoleHooksHandler } from './console-hooks'
import { deliverToZapierHooks, type ZapierDeliveryDeps, type ZapierPostResult } from './deliver'
import { createZapierHooksHandler } from './hooks-api'
import { relayHostEventToZapier, type ZapierRelayPayload } from './relay'
import { createFirestoreZapierHookStore, type ZapierHookStore } from './store'

/**
 * The production wiring (AGL-3643): the Admin SDK's Firestore, the API key
 * registry, the outbox and the public-URL fetch. Every module above takes
 * these as arguments, so a spec drives them with fakes and this file is the
 * only one that reaches the real services.
 */

const firestore = () => firebaseAdmin.app().firestore()

let store: ZapierHookStore | null = null
const zapierStore = (): ZapierHookStore => (store ??= createFirestoreZapierHookStore(firestore))

/** The published app's link, or null while the deployment keeps it hidden. */
export function zapierAppUrl(): string | null {
  const raw = String(process.env[ZAPIER_APP_URL_ENV] ?? '').trim()
  return /^https:\/\//.test(raw) ? raw : null
}

/** One signed-off POST to a hook, under the public-URL rules. Never throws. */
async function postToZapier(url: string, body: string, headers: Record<string, string>): Promise<ZapierPostResult> {
  try {
    const answer = await fetchConfiguredPublicUrl(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(ZAPIER_DELIVERY_TIMEOUT_MS),
    })
    if ('refusal' in answer) return { status: null, error: `Not sent: ${describeConfiguredUrlRefusal(answer.refusal)}` }
    return { status: answer.status }
  } catch (error) {
    const name = (error as Error)?.name
    return {
      status: null,
      error:
        name === 'TimeoutError' || name === 'AbortError'
          ? `No answer within ${ZAPIER_DELIVERY_TIMEOUT_MS / 1000} seconds`
          : `The connection failed: ${String((error as Error)?.message ?? error).slice(0, 200)}`,
    }
  }
}

function deliveryDeps(): ZapierDeliveryDeps {
  return {
    store: zapierStore(),
    post: postToZapier,
    readGrant: (orgId, keyId) => readApiKeyGrant(orgId, keyId),
    readOrg: async (orgId) => (await getOrgDoc(orgId)) as Record<string, unknown> | null,
    now: () => Date.now(),
    maxAttempts: PLUGIN_EVENT_MAX_ATTEMPTS,
  }
}

/** An order or booking event from the outbox, to the site's hooks. */
export async function deliverDomainEnvelope(envelope: PluginDomainEventEnvelope): Promise<void> {
  if (!zapierHookEventSpec(envelope.event)) return
  await deliverToZapierHooks(deliveryDeps(), {
    eventId: envelope.id,
    event: envelope.event as ZapierHookEvent,
    hostId: envelope.hostId,
    occurredAtMs: envelope.occurredAtMs,
    attempt: envelope.attempt,
    data: envelope.payload,
  })
}

/** A relayed host event from the outbox, to the site's hooks. */
export async function deliverRelayEnvelope(envelope: PluginDomainEventEnvelope): Promise<void> {
  const payload = (envelope.payload ?? {}) as Partial<ZapierRelayPayload>
  if (!payload.event || !zapierHookEventSpec(payload.event)) return
  await deliverToZapierHooks(deliveryDeps(), {
    eventId: envelope.id,
    event: payload.event,
    hostId: envelope.hostId,
    occurredAtMs: envelope.occurredAtMs,
    attempt: envelope.attempt,
    data: payload.data ?? null,
  })
}

/** The host event listener: relays a contact or a submission onto the outbox. */
export async function relayHostEvent(
  hostId: string,
  event: string,
  payload: HostEventPayload,
  context: HostEventContext = {},
): Promise<void> {
  await relayHostEventToZapier(
    {
      hasHook: (site, hookEvent) => zapierStore().hasHook(site, hookEvent),
      raise: async (request) => {
        await raisePluginEvent(firestore(), {
          event: ZAPIER_RELAY_EVENT,
          pluginId: ZAPIER_PLUGIN_ID,
          hostId: request.hostId,
          payload: request.payload,
          key: request.key,
        })
      },
      randomKey: () => randomBytes(12).toString('base64url'),
    },
    hostId,
    event,
    payload,
    context,
  )
}

let hooksHandler: ReturnType<typeof createZapierHooksHandler> | null = null
/** `/v1/sites/{siteId}/hooks`, over the real store. */
export function zapierHooksHandler() {
  return (hooksHandler ??= createZapierHooksHandler({ store: zapierStore, now: () => Date.now() }))
}

/** The console card's route, over the real services. */
export function zapierConsoleHooksHandler() {
  return createZapierConsoleHooksHandler({
    verifyIdToken: (token) => firebaseAdmin.app().auth().verifyIdToken(token),
    readMemberRoles: async (hostId) => {
      const host = await firestore().collection('hosts').doc(hostId).get()
      return host.exists ? ((host.get('memberRoles') ?? {}) as Record<string, unknown>) : null
    },
    siteLocked: async (hostId) => Boolean(await getSiteLockdown(hostId)),
    store: zapierStore,
    appUrl: zapierAppUrl,
  })
}
