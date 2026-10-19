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

import { createHash } from 'node:crypto'
import type { PluginDomainEventEnvelope } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import type { CommerceOrderEventName, OrderEventPayload } from '@aglyn/plugins-commerce/contracts'
import { helpDeskOrderFromView } from '../model/orders'
import type { HelpDeskTicket } from '../providers/provider'
import { outboxItemId, type ConnectionStore, type StoredOutboxItem } from './store'

/**
 * WHAT A SITE'S HELP DESKS ARE OWED (AGL-3824).
 *
 * The subscriber half: it holds no credential and calls no help desk. It
 * writes each fact down once per connection on the site that takes it, and
 * the console job delivers it.
 *
 * - **Orders** come from commerce's order events through core's domain-event
 *   outbox. Each carries the order in the public API's shape, read by
 *   {@link helpDeskOrderFromView}; the shape comes from commerce's contracts
 *   (AGL-3980).
 * - **Contact form messages** come from the form submission's host event,
 *   which every plugin hears through the runtime's listener registry. Only
 *   a site that switched "Send contact form messages" on is owed one.
 *
 * An item's id names the fact — the envelope's id, the submission's id — so
 * a fact heard twice is owed once (the store's create is the dedupe).
 */

/** The order events this plugin takes, as commerce raises them. */
export const HELP_DESKS_ORDER_EVENTS: readonly CommerceOrderEventName[] = [
  'order.paid',
  'order.fulfilled',
  'order.delivered',
  'order.refunded',
  'order.cancelled',
]

/** The host event a form submission raises, as the forms plugin's door names it. */
export const FORM_SUBMISSION_HOST_EVENT = 'formSubmission'

export interface IntakeDeps {
  store: Pick<ConnectionStore, 'connectionsTaking' | 'enqueue'>
  /** The org a site belongs to, or `null` for a site that has none. */
  orgOf(hostId: string): Promise<string | null>
  now(): number
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function owe(
  deps: IntakeDeps,
  input: { hostId: string; orgId: string | null; kind: StoredOutboxItem['kind']; key: string },
  item: (connectionId: string, orgId: string) => StoredOutboxItem,
): Promise<number> {
  const connections = await deps.store.connectionsTaking(input.hostId, input.kind)
  if (!connections.length) return 0
  const orgId = input.orgId || (await deps.orgOf(input.hostId))
  if (!orgId) return 0
  for (const connectionId of connections) {
    await deps.store.enqueue(outboxItemId(connectionId, input.kind, input.key), item(connectionId, orgId))
  }
  return connections.length
}

/**
 * Owes one order event to every connection on its site that takes orders.
 * A failure throws, so the outbox retries the envelope; the store's create
 * makes the retry owe nothing twice.
 *
 * @returns how many connections it was owed to.
 */
export async function intakeOrderEvent(
  deps: IntakeDeps,
  envelope: PluginDomainEventEnvelope<OrderEventPayload>,
): Promise<number> {
  if (!(HELP_DESKS_ORDER_EVENTS as readonly string[]).includes(envelope.event) || !envelope.hostId) return 0
  const read = helpDeskOrderFromView(envelope.payload?.order, envelope.occurredAtMs)
  if (!read) return 0
  const nowMs = deps.now()
  return owe(deps, { hostId: envelope.hostId, orgId: envelope.orgId, kind: 'order', key: envelope.id }, (connectionId, orgId) => ({
    orgId,
    connectionId,
    hostId: envelope.hostId,
    kind: 'order',
    email: read.buyer.email,
    status: 'pending',
    attempts: 0,
    nextAttemptAtMs: nowMs,
    createdAtMs: nowMs,
    lastError: null,
    buyer: read.buyer,
    order: read.order,
  }))
}

/** The answers a submission's host event carries beside the form's, never part of the message. */
const NOT_ANSWERS = new Set(['formName', 'path', 'formId'])

const MESSAGE_KEYS = ['message', 'comments', 'comment', 'body', 'inquiry', 'question', 'details', 'description']
const NAME_KEYS = ['name', 'fullName', 'full_name', 'yourName']
const FIRST_NAME_KEYS = ['firstName', 'first_name', 'givenName']
const LAST_NAME_KEYS = ['lastName', 'last_name', 'familyName']

const answer = (payload: Record<string, unknown>, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/** A field's key as a label: `phoneNumber` → `Phone number`. */
export function answerLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key
}

/**
 * A form submission's host event as a ticket, or `null` for one with no
 * sender address to answer: a help desk ticket is a conversation with
 * someone, and a message nobody can be written back to is not one.
 */
export function ticketFromSubmission(
  payload: Record<string, unknown>,
  context: { actor?: { email?: string | null } | null; recordId?: string | null },
  submittedAtMs: number,
): HelpDeskTicket | null {
  const email = String(answer(payload, ['email', 'emailAddress', 'email_address']) ?? context.actor?.email ?? '')
    .trim()
    .toLowerCase()
  if (!EMAIL.test(email)) return null
  const first = answer(payload, FIRST_NAME_KEYS)
  const last = answer(payload, LAST_NAME_KEYS)
  const name = answer(payload, NAME_KEYS) ?? ([first, last].filter(Boolean).join(' ') || null)
  const formName = answer(payload, ['formName']) ?? 'Contact form'
  const message = answer(payload, MESSAGE_KEYS)
  const subject = answer(payload, ['subject', 'topic']) ?? `${formName}: a message from ${name ?? email}`
  const others = Object.entries(payload)
    .filter(([key, value]) => !NOT_ANSWERS.has(key) && !MESSAGE_KEYS.includes(key) && String(value ?? '').trim() !== '')
    .slice(0, 50)
    .map(([key, value]) => `${answerLabel(key)}: ${String(value).trim().slice(0, 2000)}`)
  const path = answer(payload, ['path'])
  const body = [
    message ?? '',
    others.length ? `${message ? '\n' : ''}${others.join('\n')}` : '',
    `\nSent with the form “${formName}”${path ? ` on ${path}` : ''}.`,
  ]
    .filter(Boolean)
    .join('\n')
    .trim()
    .slice(0, 9000)
  const key =
    typeof context.recordId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(context.recordId)
      ? context.recordId
      : createHash('sha256').update(JSON.stringify({ payload, submittedAtMs })).digest('hex').slice(0, 32)
  return { id: key, email, name, subject: subject.slice(0, 250), body, submittedAtMs }
}

/**
 * Owes one form submission to every connection on its site that sends
 * contact form messages as tickets. Never throws into the form's door: the
 * listener registry logs a failure, and the submission is in the Inbox
 * either way.
 */
export async function intakeFormSubmission(
  deps: IntakeDeps,
  hostId: string,
  payload: Record<string, unknown>,
  context: { actor?: { email?: string | null } | null; recordId?: string | null } = {},
): Promise<number> {
  const nowMs = deps.now()
  const ticket = ticketFromSubmission(payload, context, nowMs)
  if (!ticket) return 0
  return owe(deps, { hostId, orgId: null, kind: 'ticket', key: ticket.id }, (connectionId, orgId) => ({
    orgId,
    connectionId,
    hostId,
    kind: 'ticket',
    email: ticket.email,
    status: 'pending',
    attempts: 0,
    nextAttemptAtMs: nowMs,
    createdAtMs: nowMs,
    lastError: null,
    ticket,
  }))
}
