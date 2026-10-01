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

/**
 * WHICH PROVIDER CARRIES THIS DEPLOYMENT'S MAIL.
 *
 * | provider  | for                                                          |
 * |-----------|--------------------------------------------------------------|
 * | `resend`  | Aglyn's own deployment, and anyone with a Resend account      |
 * | `webhook` | anything else — the operator's own relay, SMTP, SES, Postmark |
 * | any other | a provider a plugin or a fork registered under that id        |
 *
 * `AGLYN_MAIL_PROVIDER` picks one. Unset, the first built-in that has its
 * settings wins, in the order above — so a deployment that already had
 * `RESEND_API_KEY` keeps Resend however else it is configured, and a
 * self-hosted one that set only `AGLYN_MAIL_WEBHOOK_URL` gets its own relay
 * with no other setting. With neither, it is Resend, unconfigured, and every
 * send is skipped with a log line naming the setting — the behavior an
 * install without mail has always had.
 *
 * ## Why the built-ins are compiled in, and not registered by a plugin
 *
 * This is the transactional rail: password resets, invitations, receipts,
 * billing notices and operator alerts, sent from every server process with
 * or without any plugin loaded. A provider a plugin registered at boot is a
 * provider that can be absent — a boot whose declarations threw part-way, a
 * route bundle that evaluates the registry apart from boot's — and an absent
 * provider is indistinguishable from an unconfigured one: every send skipped
 * as if mail were simply off, nothing red. Selecting among providers that
 * are part of this library has no such state. Registration is kept for what
 * cannot be compiled in, and is only ever consulted when the operator named
 * the provider.
 *
 * ## An explicit choice never becomes another vendor
 *
 * A value naming no built-in and no registered provider is REFUSED — every
 * send skipped with an error naming the value — rather than falling back to
 * detection. Falling back would hand an operator's mail, recipients and
 * bodies included, to a vendor they did not choose, because a plugin failed
 * to load or a name was misspelled.
 */

import {
  type MailInboundEvent,
  type MailProvider,
  type MailProviderReads,
} from './mail-provider'
import { resendMailProvider } from './mail-provider-resend'
import { webhookMailProvider } from './mail-provider-webhook'
import type { EmailDeliveryEvent } from './email-delivery-events'

/** The setting that names the provider. */
export const MAIL_PROVIDER_SETTING = 'AGLYN_MAIL_PROVIDER'

type Env = Record<string, string | undefined>

/** The built-in providers, in the order detection tries them. */
function builtInMailProviders(env: Env): MailProvider[] {
  return [resendMailProvider(env), webhookMailProvider(env)]
}

/** The ids no registration may take. */
export function builtInMailProviderIds(): string[] {
  return builtInMailProviders({}).map((provider) => provider.id)
}

/*==========================================
 * PROVIDERS A PLUGIN OR A FORK SUPPLIES.
 *
 * The slots live on `globalThis` under a registered symbol: a Next server
 * evaluates a module once for boot and again inside a route's bundle, and a
 * module-level map would give the route an empty copy of what boot filled.
 *=========================================*/

const REGISTRY_KEY = Symbol.for('aglyn.mail-providers')

function registered(): Map<string, MailProvider> {
  const slots = globalThis as { [REGISTRY_KEY]?: Map<string, MailProvider> }
  if (!slots[REGISTRY_KEY]) slots[REGISTRY_KEY] = new Map()
  return slots[REGISTRY_KEY] as Map<string, MailProvider>
}

/**
 * Registers a provider under its `id`, for a deployment that names it in
 * `AGLYN_MAIL_PROVIDER`. The same provider object again is a no-op; a
 * different one under a taken id throws naming it, because two providers
 * answering to one name would split an account's mail between them. A
 * built-in id throws too: the platform's default carrier is not something a
 * plugin can replace by registering.
 */
export function registerMailProvider(provider: MailProvider): void {
  const id = String(provider?.id ?? '').trim().toLowerCase()
  if (!id) throw new Error('a mail provider needs an id')
  if (builtInMailProviderIds().includes(id)) {
    throw new Error(`"${id}" is a built-in mail provider and cannot be registered`)
  }
  const slots = registered()
  const existing = slots.get(id)
  if (existing && existing !== provider) {
    throw new Error(`a different mail provider is already registered as "${id}"`)
  }
  slots.set(id, provider)
}

/** Forgets every registration — for specs. */
export function resetMailProvidersForTests(): void {
  registered().clear()
}

/*==========================================
 * SELECTION.
 *=========================================*/

/** Why each provider that cannot be used cannot, keyed by the stand-in {@link mailProvider} returned. */
const UNAVAILABLE = new WeakMap<MailProvider, string>()

/**
 * The stand-in for a provider the operator named and this process does not
 * have. It sends nothing and says why in everything that reads it.
 */
function unavailableMailProvider(id: string): MailProvider {
  const problem =
    `${MAIL_PROVIDER_SETTING} is "${id}", which is not a built-in mail ` +
    `provider (${builtInMailProviderIds().join(', ')}) and was not registered ` +
    'in this process, so no mail is sent.'
  const provider: MailProvider = {
    id,
    missingSettings: () => [MAIL_PROVIDER_SETTING],
    send: async () => {
      throw new Error(problem)
    },
  }
  UNAVAILABLE.set(provider, problem)
  return provider
}

/**
 * The provider this deployment's mail is handed to. Never `null`: an
 * unconfigured provider reports what it is missing, and a provider the
 * operator named that this process lacks is a stand-in that refuses (see
 * {@link mailProviderProblem}). Read per call, so a spec — or a runtime
 * whose environment arrives after module load — sees its current settings.
 */
export function mailProvider(env: Env = process.env as Env): MailProvider {
  const requested = String(env[MAIL_PROVIDER_SETTING] ?? '').trim().toLowerCase()
  const builtIns = builtInMailProviders(env)
  if (!requested) {
    return builtIns.find((provider) => !provider.missingSettings().length) ?? builtIns[0]
  }
  return (
    builtIns.find((provider) => provider.id === requested) ??
    registered().get(requested) ??
    unavailableMailProvider(requested)
  )
}

/**
 * A sentence saying the operator's chosen provider is not available in this
 * process, or `null` when it is (or none was chosen). Printed as an ERROR
 * wherever a skipped send is reported, because unlike an absent key it is
 * not a deployment that simply has no mail: somebody chose a provider and
 * this process cannot find it.
 */
export function mailProviderProblem(provider: MailProvider = mailProvider()): string | null {
  return UNAVAILABLE.get(provider) ?? null
}

/*==========================================
 * WHAT THE REST OF THE PLATFORM ASKS.
 *
 * Each question in the platform's own vocabulary, answered by whichever
 * provider this deployment uses. A provider that cannot answer one gives the
 * empty answer — no events, no inbound message, reads that say they cannot
 * be made — never a guess.
 *=========================================*/

/** One delivery-webhook payload as events, one per recipient; `[]` for anything else. */
export function normalizeDeliveryEvents(
  payload: unknown,
  receivedAtMs: number,
  provider: MailProvider = mailProvider(),
): EmailDeliveryEvent[] {
  return provider.deliveryEvents?.(payload, receivedAtMs) ?? []
}

/** A received-mail notification, or `null` for any other payload. */
export function readInboundMailEvent(
  payload: unknown,
  provider: MailProvider = mailProvider(),
): MailInboundEvent | null {
  return provider.inboundEvent?.(payload) ?? null
}

/**
 * The provider's reads of its own account. A provider without any answers
 * with reads whose `unmet` says so, so a route handles "cannot read" the
 * same way whichever the reason.
 */
export function mailProviderReads(
  provider: MailProvider = mailProvider(),
): MailProviderReads {
  if (provider.reads) return provider.reads
  const reason =
    mailProviderProblem(provider) ??
    `The "${provider.id}" mail provider cannot read mail it sent or received.`
  const refuse = async (): Promise<never> => {
    throw new Error(reason)
  }
  return {
    unmet: () => reason,
    history: refuse,
    message: refuse,
    received: refuse,
    sendingDomains: refuse,
  }
}
