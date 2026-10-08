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

import type { HostEventContext, HostEventPayload } from '@aglyn/tenant-runtime/host-event-listeners'
import { type ZapierHookEvent, zapierEventForHostEvent } from '../model/hook-events'

/**
 * A contact created and a form submitted reach the plugin as HOST events
 * (AGL-3643): raised in the request that made them, handed to every listener
 * at once, and never retried. A post to Zapier inside a visitor's form
 * submission would make them wait on Zapier, and one that failed would be
 * lost. So the listener only RELAYS: when the site has a hook taking the
 * event it writes the event to core's outbox as `zapier.relay`, and the
 * outbox delivers it like an order, with backoff. A site with no such hook
 * costs the request one read.
 */

/** What a relayed event carries on the outbox. */
export interface ZapierRelayPayload {
  event: ZapierHookEvent
  data: Record<string, unknown>
}

export interface ZapierRelayRequest {
  hostId: string
  payload: ZapierRelayPayload
  /** Names the occurrence, so the same record relayed twice is one event. */
  key: string
}

export interface ZapierRelayDeps {
  hasHook: (hostId: string, event: ZapierHookEvent) => Promise<boolean>
  raise: (request: ZapierRelayRequest) => Promise<void>
  /** A key for an occurrence the event does not name. */
  randomKey: () => string
}

const text = (value: unknown): string | null => {
  const out = value === undefined || value === null ? '' : String(value).trim()
  return out ? out : null
}

/**
 * The record a host event describes, in the shape a hook is posted, and the
 * key naming it — or null when the event does not describe one.
 */
export function zapierRelayFor(
  event: ZapierHookEvent,
  payload: HostEventPayload,
  context: HostEventContext,
  randomKey: () => string,
): { data: Record<string, unknown>; key: string } | null {
  if (event === 'contact.created') {
    const id = text(payload['contactId'])
    if (!id) return null
    const rest = Object.fromEntries(
      Object.entries(payload).filter(([field]) => field !== 'contactId' && field !== 'hostId'),
    )
    return { data: { contact: { id, ...rest } }, key: `contact:${id}` }
  }
  if (event === 'form.submitted') {
    const { formId, formName, path, ...fields } = payload
    const id = text(context.recordId)
    // The REST API's form submission, so a Zap reads one shape whether it
    // was sent the submission or listed it (`GET …/form-submissions`).
    return {
      data: {
        submission: {
          id,
          object: 'form_submission',
          form_id: text(formId),
          form: text(formName),
          path: text(path),
          fields,
          read: false,
        },
      },
      key: id ? `submission:${id}` : `submission:${randomKey()}`,
    }
  }
  return null
}

/** The host event listener's body: relay what a hook takes, ignore the rest. */
export async function relayHostEventToZapier(
  deps: ZapierRelayDeps,
  hostId: string,
  hostEvent: string,
  payload: HostEventPayload,
  context: HostEventContext = {},
): Promise<boolean> {
  const event = zapierEventForHostEvent(hostEvent)
  if (!event || !hostId) return false
  if (!(await deps.hasHook(hostId, event))) return false
  const relay = zapierRelayFor(event, payload, context, deps.randomKey)
  if (!relay) return false
  await deps.raise({ hostId, payload: { event, data: relay.data }, key: `${event}:${relay.key}` })
  return true
}
