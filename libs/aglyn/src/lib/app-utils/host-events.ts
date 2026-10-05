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
  PLUGIN_HOST_EVENTS,
  type PluginHostEventType,
} from './plugin-host-events.generated'

/**
 * HOST EVENTS: what happened on a site that an automation can start on
 * (AGL-128).
 *
 * SERVER DOORS ONLY. An event exists because a request handler that already
 * performed the write called `emitHostEvent` beside it; nothing watches the
 * database. So a record created by a console user's client-direct Firestore
 * write fires nothing, and an event is only as complete as the set of server
 * paths that raise it.
 *
 * The platform raises one event itself — a page view, from the analytics
 * collector. Every other event is raised by a plugin's door, and the plugin
 * DECLARES it under `hostEvents` in `plugins.config.json`: the type a trigger
 * stores, where it sorts in a picker, how a picker and a run row name it, and
 * the payload keys it puts in scope. The declarations are compiled, because
 * the event bus, the trigger pickers and every validator read them with no
 * plugin loaded. Nothing here names a plugin's event.
 */

/** One event a trigger can start on. */
export interface HostEventDeclaration {
  /** The plugin whose doors raise it; absent for the platform's own. */
  pluginId?: string
  /** What a stored trigger names. Never renamed. */
  type: string
  /** Where it sorts in every trigger picker. */
  order: number
  /** How a trigger picker and a run history row name it: "Form submitted". */
  label: string
  /**
   * The payload keys the event puts in scope, for the filter expression and
   * the step conditions — the thing an author has to know to write
   * `lifecycleStage == "customer"` and has nowhere else to read. Documented
   * from the door that raises it: an entry may describe keys no fixed list
   * can enumerate ("every submitted field by name").
   */
  payloadKeys?: readonly string[]
  /**
   * Whether the event IS the recipient's own action (AGL-3458): a visitor
   * submitted a form, booked, signed up. An email an automation sends at once
   * to that visitor answers what they just did, so it can go out as a
   * transactional reply — no unsubscribe header, no unsubscribe link — where
   * a message on any other event is mail the business chose to send.
   */
  recipientActed?: boolean
}

/** The events the platform raises itself, with no plugin loaded. */
const PLATFORM_HOST_EVENTS = [
  { type: 'pageView', order: 20, label: 'Page viewed', payloadKeys: ['path'] },
] as const satisfies readonly HostEventDeclaration[]

export type HostEventType =
  | (typeof PLATFORM_HOST_EVENTS)[number]['type']
  | PluginHostEventType

/** Every host event, the platform's and the plugins', in picker order. */
export const HOST_EVENTS: readonly HostEventDeclaration[] = [
  ...PLATFORM_HOST_EVENTS,
  ...PLUGIN_HOST_EVENTS,
].sort((a, b) => a.order - b.order)

/** Every host event's type, in picker order. */
export const HOST_EVENT_TYPES: readonly HostEventType[] = HOST_EVENTS.map(
  (event) => event.type as HostEventType,
)

/** How each event reads in a trigger picker and a run history row. */
export const HOST_EVENT_LABELS: Partial<Record<HostEventType, string>> =
  Object.fromEntries(HOST_EVENTS.map((event) => [event.type, event.label]))

/** The payload keys each event puts in scope, where they are documented. */
export const HOST_EVENT_PAYLOAD_KEYS: Partial<Record<HostEventType, readonly string[]>> =
  Object.fromEntries(
    HOST_EVENTS.filter((event) => event.payloadKeys?.length).map((event) => [
      event.type,
      event.payloadKeys,
    ]),
  )

/**
 * Whether an event is the recipient's own action — see
 * {@link HostEventDeclaration.recipientActed}. A custom event, and every
 * event no plugin declares that way, is not.
 */
export function hostEventRecipientActed(event: string | undefined | null): boolean {
  const key = String(event ?? '').trim()
  return HOST_EVENTS.some((declared) => declared.type === key && declared.recipientActed === true)
}

/**
 * `formSubmission` → `Form submitted`; a custom event keeps its own name,
 * because the author chose it and it is already the word they think in.
 */
export function hostEventLabel(event: string | undefined | null): string {
  const key = String(event ?? '').trim()
  if (!key) return 'Event'
  return HOST_EVENT_LABELS[key as HostEventType] ?? key
}

/**
 * One sentence naming what a trigger's filter and conditions can read, or
 * `null` for an event whose payload is not documented — a custom event, or
 * one whose door documents none.
 */
export function hostEventPayloadHint(
  event: string | undefined | null,
): string | null {
  const keys = HOST_EVENT_PAYLOAD_KEYS[String(event ?? '') as HostEventType]
  if (!keys?.length) return null
  return `In scope: ${keys.join(', ')}.`
}
