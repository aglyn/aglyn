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
 * SHIPPING ON THE MERCHANT'S OWN ACCOUNT (AGL-3632). Client-safe and pure:
 * the services a workspace can connect with credentials of its own, what
 * each one asks for, and what a member reads back. The server keeps the
 * credentials sealed (`server/own-accounts.ts`) and never returns them.
 *
 * Two kinds of service:
 *
 * - **Label platforms** (Easyship, Sendcloud): rates, labels and tracking on
 *   the merchant's own account, in place of the platform's Shippo or
 *   EasyPost account. The platform bills the merchant for every label, so
 *   Aglyn recovers nothing. One at a time: a workspace ships through one.
 * - **Checkout rate rules** (ShipperHQ): the rates a shopper is offered at
 *   checkout come from the merchant's ShipperHQ rules instead of the
 *   carriers' list prices. Labels are still bought on the label platform.
 */

export type OwnAccountKind = 'easyship' | 'sendcloud' | 'shipperhq'

export const OWN_ACCOUNT_KINDS: readonly OwnAccountKind[] = ['easyship', 'sendcloud', 'shipperhq']

/** The services that buy labels, as opposed to only pricing checkout. */
export const OWN_LABEL_KINDS: readonly OwnAccountKind[] = ['easyship', 'sendcloud']

export function isOwnAccountKind(value: unknown): value is OwnAccountKind {
  return typeof value === 'string' && (OWN_ACCOUNT_KINDS as readonly string[]).includes(value)
}

export function isOwnLabelKind(value: unknown): value is 'easyship' | 'sendcloud' {
  return value === 'easyship' || value === 'sendcloud'
}

/** One thing a connect form asks for. */
export interface OwnAccountField {
  key: 'apiKey' | 'apiSecret' | 'webhookSecret' | 'itemCategory' | 'scope' | 'weightUnit'
  label: string
  helper?: string
  /** A credential: typed as a password, sealed, never shown again. */
  secret: boolean
  required: boolean
  /** A pick from these, rather than free text. */
  options?: Array<{ value: string; label: string }>
}

export interface OwnAccountService {
  kind: OwnAccountKind
  label: string
  /** One line on what connecting it does. */
  summary: string
  role: 'labels' | 'checkout_rates'
  fields: OwnAccountField[]
}

export const OWN_ACCOUNT_SERVICES: Readonly<Record<OwnAccountKind, OwnAccountService>> = {
  easyship: {
    kind: 'easyship',
    label: 'Easyship',
    summary: 'Buy labels and get rates from the couriers on your Easyship account. Easyship bills you for each label.',
    role: 'labels',
    fields: [
      {
        key: 'apiKey',
        label: 'API access token',
        helper: 'In Easyship, Connect → API Integration. A sandbox token (sand_…) buys test labels.',
        secret: true,
        required: true,
      },
      {
        key: 'webhookSecret',
        label: 'Webhook secret key',
        helper: 'Optional. Add the webhook address below in Easyship to follow parcels, then paste its secret key (webh_…).',
        secret: true,
        required: false,
      },
      {
        key: 'itemCategory',
        label: 'Item category',
        helper: 'Optional. The Easyship item category your products ship as, used when a product has no tariff code.',
        secret: false,
        required: false,
      },
    ],
  },
  sendcloud: {
    kind: 'sendcloud',
    label: 'Sendcloud',
    summary: 'Buy labels and get rates from the carriers on your Sendcloud account. Sendcloud bills you for each label.',
    role: 'labels',
    fields: [
      {
        key: 'apiKey',
        label: 'Public key',
        helper: 'In Sendcloud, Settings → Integrations → Sendcloud API.',
        secret: false,
        required: true,
      },
      {
        key: 'apiSecret',
        label: 'Secret key',
        helper: 'It also signs the tracking updates Sendcloud sends to the webhook address below.',
        secret: true,
        required: true,
      },
    ],
  },
  shipperhq: {
    kind: 'shipperhq',
    label: 'ShipperHQ',
    summary: 'Price checkout shipping with your ShipperHQ rules: carriers, markups, free-shipping offers and packing.',
    role: 'checkout_rates',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        helper: 'In ShipperHQ, Websites → your website.',
        secret: false,
        required: true,
      },
      {
        key: 'apiSecret',
        label: 'Authentication code',
        secret: true,
        required: true,
      },
      {
        key: 'scope',
        label: 'Scope',
        secret: false,
        required: true,
        options: [
          { value: 'LIVE', label: 'Live' },
          { value: 'TEST', label: 'Test' },
          { value: 'DEVELOPMENT', label: 'Development' },
          { value: 'INTEGRATION', label: 'Integration' },
        ],
      },
      {
        key: 'weightUnit',
        label: 'Weight unit in ShipperHQ',
        secret: false,
        required: true,
        options: [
          { value: 'lb', label: 'Pounds' },
          { value: 'kg', label: 'Kilograms' },
        ],
      },
    ],
  },
}

/** A connection as a member reads it: never a credential. */
export interface OwnAccountView {
  kind: OwnAccountKind
  label: string
  role: OwnAccountService['role']
  accountName: string
  testMode: boolean
  connectedAtMs: number
  /** Whether a webhook secret is kept (Easyship) or implied (Sendcloud). */
  followsParcels: boolean
  /** The address to paste into the service's webhook settings, when it sends tracking. */
  webhookUrl: string | null
  settings: { itemCategory?: string; scope?: string; weightUnit?: string }
}
