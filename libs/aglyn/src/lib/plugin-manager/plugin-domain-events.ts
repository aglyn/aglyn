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

import { getRegisteringPluginId } from '../app-utils/registering-plugin'

/**
 * Events a PLUGIN raises for other plugins (AGL-3611).
 *
 * `plugin-events.ts` carries the platform's own facts — a seat add-on, a paid
 * invoice — with payloads core declares. This is the same idea for facts
 * that belong to a plugin: one plugin declares an event and its payload,
 * raises it when the thing happens, and any other plugin subscribes by the
 * event's name without importing the plugin that raises it. Core names
 * nothing a plugin raises.
 *
 * DELIVERY IS RELIABLE, NOT FIRE-AND-FORGET. Raising an event writes an
 * outbox document (`plugin-event-outbox.ts` in the admin data lib), in the
 * same transaction as the write it reports where the raiser has one, and a
 * scheduled drain hands it to each subscriber in turn. A subscriber that
 * throws is retried with backoff, alone: the ones that already took the
 * event are not called again. Delivery is AT LEAST ONCE, so every envelope
 * carries `id`, stable across retries, for a subscriber to dedupe on.
 *
 * TYPED BY TOKEN. `definePluginDomainEvent<Payload>(name)` gives the raiser
 * and a subscriber the same payload type; a subscriber in another plugin
 * restates the shape it reads and defines its own token under the same
 * name, as a widget restates a zone's props.
 *
 * The registry lives on `globalThis` (AGL-3412): subscriptions register from
 * the plugins' server declarations at boot, in a module graph the routes and
 * the job runner do not share.
 */

/** A typed handle on one event name. */
export interface PluginDomainEvent<Payload> {
  readonly id: string
  /** Type-level only: the payload the event carries. */
  readonly __payload?: Payload
}

/** The payload an event token carries. */
export type PluginDomainEventPayload<Event> = Event extends PluginDomainEvent<infer Payload>
  ? Payload
  : never

const EVENT_NAME = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9_]*)+$/

/**
 * A token for one event name: lower-case words joined by dots, the first
 * naming what the event is about (`order.paid`, `return.requested`).
 */
export function definePluginDomainEvent<Payload>(id: string): PluginDomainEvent<Payload> {
  const name = String(id ?? '').trim()
  if (!EVENT_NAME.test(name)) {
    throw new Error(`plugin event name "${id}" must be dotted lower-case words, e.g. "order.paid"`)
  }
  return { id: name }
}

/** How a plugin describes an event it raises, for pickers and the docs. */
export interface PluginDomainEventDeclaration {
  event: PluginDomainEvent<unknown> | string
  /** "Order paid". */
  label: string
  /** One sentence: when it is raised. */
  description: string
  /** The top-level payload keys, for a person writing a subscriber. */
  payloadKeys?: readonly string[]
}

/** A declared event, with the plugin that raises it. */
export interface DeclaredPluginDomainEvent {
  pluginId: string
  event: string
  label: string
  description: string
  payloadKeys: readonly string[]
}

/** What a subscriber is handed. */
export interface PluginDomainEventEnvelope<Payload = unknown> {
  /** Stable across retries: the idempotency key for a subscriber. */
  id: string
  event: string
  /** The site the event happened on. */
  hostId: string
  /** The site's org, when the raiser knew it. */
  orgId: string | null
  /** When the fact happened, not when it was delivered. */
  occurredAtMs: number
  /** 1 on the first delivery to this subscriber, then 2, 3, … */
  attempt: number
  payload: Payload
}

export type PluginDomainEventHandler<Payload = unknown> = (
  envelope: PluginDomainEventEnvelope<Payload>,
) => void | Promise<void>

interface Subscription {
  pluginId: string
  handler: PluginDomainEventHandler<unknown>
}

interface Registry {
  declarations: Map<string, DeclaredPluginDomainEvent>
  subscriptions: Map<string, Subscription[]>
}

const REGISTRY_KEY = Symbol.for('@aglyn/aglyn:plugin-domain-events')
const globalScope = globalThis as typeof globalThis & { [REGISTRY_KEY]?: Registry }

function registry(): Registry {
  if (!globalScope[REGISTRY_KEY]) {
    globalScope[REGISTRY_KEY] = { declarations: new Map(), subscriptions: new Map() }
  }
  return globalScope[REGISTRY_KEY] as Registry
}

const nameOf = (event: PluginDomainEvent<unknown> | string): string =>
  typeof event === 'string' ? event : event.id

function ownerOf(kind: string, name: string, options?: { pluginId?: string }): string {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      `plugin event "${name}" ${kind} with no owner: pass { pluginId } outside a plugin register fn`,
    )
  }
  return pluginId
}

/**
 * Declares the events a plugin raises. One plugin owns a name: a second
 * plugin declaring it throws, so two plugins cannot raise one event with two
 * payloads. The owner declaring again replaces its entry.
 */
export function declarePluginDomainEvents(
  declarations: readonly PluginDomainEventDeclaration[],
  options?: { pluginId?: string },
): void {
  for (const declaration of declarations) {
    const name = nameOf(declaration.event)
    if (!EVENT_NAME.test(name)) {
      throw new Error(`plugin event name "${name}" must be dotted lower-case words`)
    }
    const pluginId = ownerOf('declared', name, options)
    const existing = registry().declarations.get(name)
    if (existing && existing.pluginId !== pluginId) {
      throw new Error(
        `plugin event "${name}" is already declared by "${existing.pluginId}"; "${pluginId}" cannot declare it too`,
      )
    }
    registry().declarations.set(name, {
      pluginId,
      event: name,
      label: declaration.label,
      description: declaration.description,
      payloadKeys: [...(declaration.payloadKeys ?? [])],
    })
  }
}

/** Every declared event, sorted by name. */
export function listPluginDomainEvents(): DeclaredPluginDomainEvent[] {
  return [...registry().declarations.values()].sort((a, b) => a.event.localeCompare(b.event))
}

/** The declaration of one event, or `null` when no plugin declares it. */
export function pluginDomainEventDeclaration(event: string): DeclaredPluginDomainEvent | null {
  return registry().declarations.get(event) ?? null
}

/**
 * Subscribes to an event. A subscriber subscribing again to the same event
 * replaces its earlier handler, so a module evaluated twice delivers once.
 *
 * The subscriber is named by plugin id, or `pluginId:name` when a plugin
 * subscribes more than one handler to an event (its webhooks and its
 * workflow triggers, say) — and that name is what the outbox records as
 * delivered, so it must be stable.
 */
export function subscribePluginDomainEvent<Payload>(
  event: PluginDomainEvent<Payload> | string,
  handler: PluginDomainEventHandler<Payload>,
  options?: { pluginId?: string; name?: string },
): void {
  const name = nameOf(event as PluginDomainEvent<unknown> | string)
  const owner = ownerOf('subscribed', name, options)
  const pluginId = options?.name ? `${owner}:${options.name}` : owner
  const list = (registry().subscriptions.get(name) ?? []).filter((entry) => entry.pluginId !== pluginId)
  list.push({ pluginId, handler: handler as PluginDomainEventHandler<unknown> })
  registry().subscriptions.set(name, list)
}

/** The plugins subscribed to an event, in subscription order. */
export function listPluginDomainEventSubscribers(event: string): string[] {
  return (registry().subscriptions.get(event) ?? []).map((entry) => entry.pluginId)
}

/** What one delivery pass came to. */
export interface PluginDomainEventDeliveryResult {
  /** Subscribers that took the event on this pass. */
  delivered: string[]
  /** Subscribers that threw, with what they said. */
  failed: Array<{ pluginId: string; error: string }>
}

/**
 * Hands an envelope to every subscriber not in `skip`, one after another. A
 * throw is caught and reported and does not stop the others. The outbox
 * drain calls this; a raiser never does.
 */
export async function deliverPluginDomainEvent(
  envelope: Omit<PluginDomainEventEnvelope, 'attempt'>,
  options: { skip?: ReadonlySet<string>; attempts?: Readonly<Record<string, number>> } = {},
): Promise<PluginDomainEventDeliveryResult> {
  const result: PluginDomainEventDeliveryResult = { delivered: [], failed: [] }
  for (const { pluginId, handler } of registry().subscriptions.get(envelope.event) ?? []) {
    if (options.skip?.has(pluginId)) continue
    try {
      await handler({ ...envelope, attempt: (options.attempts?.[pluginId] ?? 0) + 1 })
      result.delivered.push(pluginId)
    } catch (error) {
      const message = String((error as Error)?.message ?? error).slice(0, 500)
      result.failed.push({ pluginId, error: message })
      console.error(`[plugin-events] ${pluginId} failed on ${envelope.event} ${envelope.id}`, error)
    }
  }
  return result
}

/** Test seam: forget every declaration and subscription. */
export function resetPluginDomainEventsForTests(): void {
  registry().declarations.clear()
  registry().subscriptions.clear()
}
