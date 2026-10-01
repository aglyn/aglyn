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

import type { SiteAlert } from '@aglyn/aglyn/server'

/**
 * WHO HEARS A HOST EVENT.
 *
 * A host event — a form submitted, a member signed up, a deal won — is raised
 * by the server door that performed the write, through `emitHostEvent`. What
 * runs because of it is not the runtime's business: an automation engine, an
 * integration, a marketplace plugin. Each registers a listener here and the
 * runtime fans every event out to all of them, knowing none by name.
 *
 * ## Registered by a call, at boot
 *
 * A listener is registered by a function the platform calls BY NAME — a
 * plugin's `serverDeclarations` entry, which both apps run once per process
 * from `instrumentation.ts`, and its API register functions, which the plugin
 * loader runs. Never by a bare `import './x'`: a bundler drops a module its
 * package does not list as a side effect, and jest does not, so a registration
 * that relies on one passes every spec and runs in no build (AGL-3025).
 *
 * Boot registration is what lets a core route that never loads a plugin — the
 * form submission, the page-view collector — still reach every listener.
 *
 * ## Isolated, and never thrown into the emitter
 *
 * The event has already happened: the submission is stored, the member exists.
 * A listener that throws is logged against its plugin and the others still
 * run, and the emitting request never sees the failure.
 */

/** What an event carries into everything that listens for it. */
export type HostEventPayload = Record<string, string | number | boolean>

/**
 * Who caused an event (AGL-3376): the console member who moved the deal, the
 * integration's key that added the contact, the visitor who submitted the
 * form, or the platform acting on its own (a Stripe webhook, a schedule).
 *
 * Kept OUT of the payload on purpose. The payload seeds a workflow's
 * expression scope and condition editor, and a site's automations have no
 * business reading a console member's address; this rides beside it, for
 * the record of who set a run off.
 */
export interface HostEventActor {
  kind: 'member' | 'visitor' | 'apiKey' | 'platform'
  /** The acting account, for a member. */
  uid?: string | null
  /** The address the actor had when they acted, when the door knew it. */
  email?: string | null
  /** The key's name, for an integration. */
  apiKeyName?: string | null
}

/** What rides beside an event's payload. */
export interface HostEventContext {
  /** Absent when the door that raised the event did not know. */
  actor?: HostEventActor
}

export interface HostEventListener {
  /**
   * Runs whatever this plugin does when `event` happens on the site.
   *
   * Resolves the site alerts a request/response emitter shows its visitor —
   * a form submission returns them in its response — or nothing.
   */
  onEvent(
    hostId: string,
    event: string,
    payload: HostEventPayload,
    context?: HostEventContext,
  ): Promise<readonly SiteAlert[] | void>
  /**
   * Runs the server half of ONE page interaction, by id, that a published
   * page fired for a site event it evaluated itself — a scroll depth, a
   * click, exit intent. The page has already decided the trigger matched, so
   * the listener runs what that one interaction names rather than everything
   * listening for the event; a listener that does not own the id resolves
   * nothing.
   */
  onDispatch?(
    hostId: string,
    interactionId: string,
    event: string,
    payload: HostEventPayload,
    context?: HostEventContext,
  ): Promise<readonly SiteAlert[] | void>
}

interface Registration {
  pluginId: string
  listener: HostEventListener
}

const registrations: Registration[] = []

/** Whether the no-listener warning has been printed in this process. */
let warnedEmpty = false

/** A listener's answer as a list: nothing it said counts as no alerts. */
function alertsOf(answer: readonly SiteAlert[] | void): SiteAlert[] {
  return Array.isArray(answer) ? [...answer] : []
}

/**
 * Subscribes a plugin to every host event. Registering again under the same
 * plugin id replaces the earlier listener in place, so a register function
 * the platform calls twice — boot, then the API surface — leaves one.
 */
export function registerHostEventListener(
  pluginId: string,
  listener: HostEventListener,
): void {
  const id = String(pluginId ?? '').trim()
  if (!id) {
    throw new Error('a host event listener needs the id of the plugin it belongs to')
  }
  const at = registrations.findIndex((entry) => entry.pluginId === id)
  if (at >= 0) registrations[at] = { pluginId: id, listener }
  else registrations.push({ pluginId: id, listener })
}

/** The plugins listening, in registration order, for diagnostics. */
export function listHostEventListeners(): string[] {
  return registrations.map((entry) => entry.pluginId)
}

/** Test seam: forget every listener. */
export function resetHostEventListenersForTests(): void {
  registrations.length = 0
  warnedEmpty = false
}

/**
 * Hands one event to every listener, concurrently, and gathers the alerts
 * they produced. Never rejects.
 */
export async function runHostEventListeners(
  hostId: string,
  event: string,
  payload: HostEventPayload = {},
  context: HostEventContext = {},
): Promise<SiteAlert[]> {
  if (!registrations.length) {
    /*
     * Said once per process rather than per event. No listener means the
     * plugins' server declarations never ran here — every automation on
     * every site served by this process is silent, and a line in the log is
     * the only place that is visible.
     */
    if (!warnedEmpty) {
      warnedEmpty = true
      console.warn(
        `[host-events] nothing is listening; "${event}" on ${hostId} ran no ` +
          'automation. Listeners register from the plugins’ server ' +
          'declarations at boot.',
      )
    }
    return []
  }
  const settled = await Promise.all(
    registrations.map(async ({ pluginId, listener }) => {
      try {
        return alertsOf(await listener.onEvent(hostId, event, payload, context))
      } catch (error) {
        console.error(`[host-events] ${pluginId} failed on ${event}`, hostId, error)
        return []
      }
    }),
  )
  return settled.flat()
}

/**
 * Hands one page-dispatched interaction to the listeners that dispatch, and
 * gathers the alerts it produced. Never rejects.
 */
export async function dispatchHostAutomation(
  hostId: string,
  interactionId: string,
  event: string,
  payload: HostEventPayload = {},
  context: HostEventContext = {},
): Promise<SiteAlert[]> {
  const alerts: SiteAlert[] = []
  for (const { pluginId, listener } of registrations) {
    if (!listener.onDispatch) continue
    try {
      alerts.push(
        ...alertsOf(
          await listener.onDispatch(hostId, interactionId, event, payload, context),
        ),
      )
    } catch (error) {
      console.error(
        `[host-events] ${pluginId} failed to dispatch ${interactionId}`,
        hostId,
        error,
      )
    }
  }
  return alerts
}
