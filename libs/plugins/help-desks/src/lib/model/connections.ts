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
 * The help desks a site can connect (AGL-3824), as both the console card
 * and the server name them. Client-safe: no credential, no SDK.
 */

export type HelpDeskProviderId = 'gorgias' | 'reamaze' | 'kustomer' | 'gladly' | 'richpanel'

export const HELP_DESK_PROVIDER_IDS: readonly HelpDeskProviderId[] = ['gorgias', 'reamaze', 'kustomer', 'gladly', 'richpanel']

/** The parts of a merchant's credential, by what the connect form calls them. */
export type HelpDeskCredentialKey = 'account' | 'login' | 'token' | 'appClientId' | 'supportEmail'

export interface HelpDeskCredentialField {
  key: HelpDeskCredentialKey
  label: string
  help: string
  /** A secret is a password field, sealed at rest and never shown again. */
  secret: boolean
}

/** What a provider's one menu picks, when it has one. */
export interface HelpDeskTargetInfo {
  /** What the help desk calls it, for sentences. */
  noun: string
  label: string
  help: string
  /** What needs it: the contact form messages, or the orders. */
  purpose: 'tickets' | 'orders'
}

export interface HelpDeskProviderInfo {
  id: HelpDeskProviderId
  label: string
  /** The connect form, in order. */
  fields: HelpDeskCredentialField[]
  /** The vendor's own domain the account name is a subdomain of, for one that hosts an account per subdomain. */
  accountSuffix: string | null
  target: HelpDeskTargetInfo | null
  /** What a contact form message becomes there. */
  ticketNoun: 'ticket' | 'conversation' | 'task'
  /** How a buyer's orders show there, for the sentence under its name. */
  orders: string
}

const subdomainHelp = (label: string, suffix: string) =>
  `The first part of your ${label} address: acme for acme${suffix}.`

export const HELP_DESK_PROVIDERS: Readonly<Record<HelpDeskProviderId, HelpDeskProviderInfo>> = {
  gorgias: {
    id: 'gorgias',
    label: 'Gorgias',
    fields: [
      { key: 'account', label: 'Gorgias domain', help: subdomainHelp('Gorgias', '.gorgias.com'), secret: false },
      { key: 'login', label: 'Gorgias username', help: 'The email address Gorgias lists as the username for its REST API.', secret: false },
      { key: 'token', label: 'Gorgias API key', help: 'Gorgias lists it beside the username in its REST API settings.', secret: true },
    ],
    accountSuffix: '.gorgias.com',
    target: null,
    ticketNoun: 'ticket',
    orders: 'Each buyer with their recent orders as customer data, beside their tickets.',
  },
  reamaze: {
    id: 'reamaze',
    label: 'Re:amaze',
    fields: [
      { key: 'account', label: 'Re:amaze brand', help: subdomainHelp('Re:amaze', '.reamaze.io'), secret: false },
      { key: 'login', label: 'Re:amaze login email', help: 'The email address you sign in to Re:amaze with.', secret: false },
      { key: 'token', label: 'Re:amaze API token', help: 'In Re:amaze: Settings → Developer → API Token.', secret: true },
    ],
    accountSuffix: '.reamaze.io',
    target: {
      noun: 'channel',
      label: 'Channel',
      help: 'Contact form messages start conversations in this channel.',
      purpose: 'tickets',
    },
    ticketNoun: 'conversation',
    orders: 'Each buyer as a contact, with their recent orders as customer data.',
  },
  kustomer: {
    id: 'kustomer',
    label: 'Kustomer',
    fields: [
      {
        key: 'token',
        label: 'Kustomer API key',
        help: 'In Kustomer: Settings → Security → API Keys, with roles to read and write customers, custom objects and messages, and to read Klasses.',
        secret: true,
      },
    ],
    accountSuffix: null,
    target: {
      noun: 'custom object',
      label: 'Orders object',
      help: 'Each order is added to the customer as one of these custom objects.',
      purpose: 'orders',
    },
    ticketNoun: 'conversation',
    orders: 'Each buyer as a customer, with each order as a custom object on their timeline.',
  },
  gladly: {
    id: 'gladly',
    label: 'Gladly',
    fields: [
      { key: 'account', label: 'Gladly organization', help: subdomainHelp('Gladly', '.gladly.com'), secret: false },
      { key: 'login', label: 'Gladly user email', help: 'The email address of the Gladly user the API token belongs to.', secret: false },
      { key: 'token', label: 'Gladly API token', help: 'A token created by a Gladly user with the API User permission.', secret: true },
    ],
    accountSuffix: '.gladly.com',
    target: {
      noun: 'inbox',
      label: 'Inbox',
      help: 'Contact form messages become tasks in this inbox.',
      purpose: 'tickets',
    },
    ticketNoun: 'task',
    orders: 'Each buyer as a customer, with each order as an activity on their timeline.',
  },
  richpanel: {
    id: 'richpanel',
    label: 'Richpanel',
    fields: [
      { key: 'token', label: 'Richpanel API key', help: 'In Richpanel: Settings → Integrations → API Keys.', secret: true },
      { key: 'appClientId', label: 'Richpanel app client ID', help: 'Your store’s ID, listed under Settings → Connected Apps in Richpanel.', secret: true },
      { key: 'supportEmail', label: 'Support email address', help: 'The address your Richpanel email channel receives mail at. Contact form tickets are addressed to it.', secret: false },
    ],
    accountSuffix: null,
    target: null,
    ticketNoun: 'ticket',
    orders: 'Each buyer as a customer, with each order in their order history.',
  },
}

export function isHelpDeskProviderId(value: unknown): value is HelpDeskProviderId {
  return typeof value === 'string' && (HELP_DESK_PROVIDER_IDS as readonly string[]).includes(value)
}

/**
 * Where a connection stands.
 *
 * - `active` syncs on every tick.
 * - `paused` was paused by the merchant.
 * - `error` stopped after too many failures in a row; Sync now retries it.
 * - `reconnect` the help desk refused the credential; only connecting again fixes it.
 */
export type HelpDeskConnectionStatus = 'active' | 'paused' | 'error' | 'reconnect'

/** One choice for a provider's menu: a channel, an inbox, a custom object. */
export interface HelpDeskTarget {
  id: string
  name: string
}

/** A connection as the console card sees it. Never carries a credential. */
export interface HelpDeskConnectionView {
  id: string
  provider: HelpDeskProviderId
  hostId: string
  status: HelpDeskConnectionStatus
  /** The account's name at the help desk, or the domain it was connected with. */
  accountName: string | null
  /** The channel, inbox or custom object the provider's menu picked. */
  targetId: string | null
  targets: HelpDeskTarget[]
  /** Send buyers and their orders. On by default. */
  syncCustomers: boolean
  /** Send the site's contact form messages as new tickets. Off by default. */
  sendTickets: boolean
  /** Whether the first copy of the site's buyers and recent orders has finished. */
  backfillDone: boolean
  lastRunAtMs: number | null
  lastSuccessAtMs: number | null
  nextRunAtMs: number | null
  /** The last error, in words a merchant can act on; `null` after a clean run. */
  lastError: string | null
  consecutiveFailures: number
  totals: {
    /** Buyers added or updated at the help desk. */
    customersPushed: number
    /** Orders sent. */
    ordersPushed: number
    /** Contact form messages sent as tickets. */
    ticketsCreated: number
  }
  connectedAtMs: number | null
}

/** One run, or one error, on a connection's log. */
export interface HelpDeskLogEntry {
  id: string
  atMs: number
  kind: 'run' | 'error' | 'item-failed'
  /** What happened, in words. */
  message: string
  customersPushed?: number
  ordersPushed?: number
  ticketsCreated?: number
}

/** The settings a merchant may change on a connection. */
export interface HelpDeskConnectionSettings {
  targetId?: string | null
  syncCustomers?: boolean
  sendTickets?: boolean
  paused?: boolean
}

const TARGET_ID = /^[A-Za-z0-9_.:-]{1,128}$/

/**
 * The settings in a request body, validated. Unknown keys are ignored; a bad
 * value refuses the whole change with a sentence for the card.
 */
export function readConnectionSettings(
  body: Record<string, unknown>,
): { ok: true; settings: HelpDeskConnectionSettings } | { ok: false; error: string } {
  const settings: HelpDeskConnectionSettings = {}
  if ('targetId' in body) {
    const value = body['targetId']
    if (value === null || value === '') settings.targetId = null
    else if (typeof value === 'string' && TARGET_ID.test(value)) settings.targetId = value
    else return { ok: false, error: 'Choose one from the menu' }
  }
  for (const key of ['syncCustomers', 'sendTickets', 'paused'] as const) {
    if (key in body) {
      if (typeof body[key] !== 'boolean') return { ok: false, error: 'Use the switch to change that setting' }
      settings[key] = body[key] as boolean
    }
  }
  return { ok: true, settings }
}

/** The connection id for one site and one provider: one connection per pair. */
export function helpDeskConnectionId(hostId: string, provider: HelpDeskProviderId): string {
  return `${hostId}_${provider}`
}

/** The values the connect form posts, by key. */
export type HelpDeskCredentialInput = Partial<Record<HelpDeskCredentialKey, string>>

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * The account name as typed — `acme`, `acme.gorgias.com` or the whole
 * address — reduced to the subdomain, or `null` when it is not one.
 */
export function normalizeAccount(value: string, suffix: string): string | null {
  let text = value.trim().toLowerCase()
  text = text.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (text.endsWith(suffix)) text = text.slice(0, -suffix.length)
  return SUBDOMAIN.test(text) ? text : null
}

/**
 * The connect form's values for one provider, checked: every field present,
 * no spaces in a secret, an email where one is asked for. A refusal is a
 * sentence for the form.
 */
export function readCredentialInput(
  provider: HelpDeskProviderId,
  body: Record<string, unknown>,
): { ok: true; values: Record<HelpDeskCredentialKey, string | null> } | { ok: false; error: string } {
  const info = HELP_DESK_PROVIDERS[provider]
  const values: Record<HelpDeskCredentialKey, string | null> = {
    account: null,
    login: null,
    token: null,
    appClientId: null,
    supportEmail: null,
  }
  for (const field of info.fields) {
    const raw = String(body[field.key] ?? '').trim()
    if (!raw) return { ok: false, error: `Enter your ${field.label}` }
    if (raw.length > 500) return { ok: false, error: `That ${field.label} is too long` }
    if (field.key === 'account') {
      const account = normalizeAccount(raw, info.accountSuffix ?? '')
      if (!account) return { ok: false, error: `Enter your ${field.label}, like acme` }
      values.account = account
      continue
    }
    if (field.key === 'login' || field.key === 'supportEmail') {
      if (!EMAIL.test(raw)) return { ok: false, error: `Enter your ${field.label} as an email address` }
      values[field.key] = raw.toLowerCase()
      continue
    }
    if (/\s/.test(raw)) return { ok: false, error: `Paste the whole ${field.label}, with no spaces` }
    values[field.key] = raw
  }
  return { ok: true, values }
}
