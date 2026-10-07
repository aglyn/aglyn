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

import { platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import { openSecret, sealSecret, type SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { SHIPPING_API_ROUTES } from '../constants/api-routes'
import { SHIPPING_COLLECTIONS } from '../constants/bundle-common'
import {
  isOwnLabelKind,
  OWN_ACCOUNT_SERVICES,
  OWN_LABEL_KINDS,
  type OwnAccountKind,
  type OwnAccountView,
} from '../model/own-accounts'
import { createEasyshipProvider } from '../providers/easyship'
import { createSendcloudProvider } from '../providers/sendcloud'
import { createShipperHqEngine, type ShipperHqCredentials, type ShipperHqEngine } from '../providers/shipperhq'
import type { OwnAccountProviderId, ProviderAccount, ShippingProvider } from '../providers/types'
import {
  readOwnAccountKinds,
  readShippingConfig,
  readShippingKeyring,
  shippingFetch,
  type ShippingConfigResult,
} from './config'
import { orgRef, shippingDb } from './db'

/**
 * THE MERCHANT'S OWN SHIPPING ACCOUNTS (AGL-3632):
 * `orgs/{orgId}/shippingConnections/{kind}`, one per service, workspace-wide
 * like the carrier accounts — every site of the workspace ships through
 * them.
 *
 * The credentials are the merchant's, typed into the console once, checked
 * against the service before they are kept, sealed under
 * `SHIPPING_TOKEN_KEY` bound to this document (a sealed value copied onto
 * another workspace's record refuses to open there), and never returned to
 * any client. The Firestore rules refuse every client, the owner and staff
 * included.
 *
 * A workspace ships through ONE label platform: while Easyship or Sendcloud
 * is connected, it replaces the platform's Shippo or EasyPost account for
 * rates, labels and tracking (`resolveOrgShippingConfig`). ShipperHQ sits
 * beside either and only prices checkout.
 */

export interface StoredOwnAccount {
  kind: OwnAccountKind
  orgId: string
  status: 'active'
  sealedApiKey: string
  sealedApiSecret?: string
  sealedWebhookSecret?: string
  keyId: string
  accountName: string
  testMode: boolean
  settings: { itemCategory?: string; scope?: string; weightUnit?: string }
  connectedAtMs: number
  connectedByUid: string
}

/** A refusal the connect route answers with its own status and words. */
export class OwnAccountError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'OwnAccountError'
  }
}

export function ownAccountRef(orgId: string, kind: OwnAccountKind) {
  return orgRef(orgId).collection(SHIPPING_COLLECTIONS.ownAccounts).doc(kind)
}

const sealContext = (orgId: string, kind: OwnAccountKind, field: string) =>
  `orgs/${orgId}/${SHIPPING_COLLECTIONS.ownAccounts}/${kind}#${field}`

function readStored(data: unknown): StoredOwnAccount | null {
  const record = (data ?? null) as Partial<StoredOwnAccount> | null
  if (!record || record.status !== 'active' || !record.kind || !record.sealedApiKey) return null
  return record as StoredOwnAccount
}

export async function readOwnAccount(orgId: string, kind: OwnAccountKind): Promise<StoredOwnAccount | null> {
  return readStored((await ownAccountRef(orgId, kind).get()).data())
}

/** The workspace's connections, whatever the deployment offers now. */
export async function listOwnAccounts(orgId: string): Promise<StoredOwnAccount[]> {
  const snapshot = await orgRef(orgId).collection(SHIPPING_COLLECTIONS.ownAccounts).get()
  return snapshot.docs
    .map((doc: { data(): unknown }) => readStored(doc.data()))
    .filter((one: StoredOwnAccount | null): one is StoredOwnAccount => Boolean(one))
}

export interface OpenedOwnAccount {
  apiKey: string
  apiSecret?: string
  webhookSecret?: string
}

export function openOwnAccount(stored: StoredOwnAccount, keyring: SecretBoxKeyring): OpenedOwnAccount {
  const open = (sealed: string, field: string) =>
    openSecret(sealed, keyring, { context: sealContext(stored.orgId, stored.kind, field) }).plaintext
  return {
    apiKey: open(stored.sealedApiKey, 'apiKey'),
    ...(stored.sealedApiSecret ? { apiSecret: open(stored.sealedApiSecret, 'apiSecret') } : {}),
    ...(stored.sealedWebhookSecret ? { webhookSecret: open(stored.sealedWebhookSecret, 'webhookSecret') } : {}),
  }
}

/** The label platform's adapter for a connection. */
export function ownLabelProvider(kind: OwnAccountProviderId, settings: StoredOwnAccount['settings']): ShippingProvider {
  return kind === 'easyship'
    ? createEasyshipProvider({
        fetchImpl: shippingFetch(),
        ...(settings.itemCategory ? { itemCategory: settings.itemCategory } : {}),
      })
    : createSendcloudProvider({ fetchImpl: shippingFetch() })
}

/** Where the service posts tracking for this workspace, for a service that does. */
export function ownWebhookUrl(kind: OwnAccountKind, orgId: string): string | null {
  const route =
    kind === 'easyship'
      ? SHIPPING_API_ROUTES.webhookEasyship
      : kind === 'sendcloud'
        ? SHIPPING_API_ROUTES.webhookSendcloud
        : null
  return route ? `${platformConsoleOrigin()}/api/${route}?org=${encodeURIComponent(orgId)}` : null
}

export function ownAccountView(stored: StoredOwnAccount): OwnAccountView {
  const service = OWN_ACCOUNT_SERVICES[stored.kind]
  return {
    kind: stored.kind,
    label: service.label,
    role: service.role,
    accountName: stored.accountName,
    testMode: stored.testMode,
    connectedAtMs: stored.connectedAtMs,
    followsParcels: stored.kind === 'sendcloud' || Boolean(stored.sealedWebhookSecret),
    webhookUrl: ownWebhookUrl(stored.kind, stored.orgId),
    settings: stored.settings ?? {},
  }
}

/**
 * The shipping config a workspace's routes and checkout use: its own label
 * platform when one is connected and the deployment still offers it, the
 * platform's provider otherwise. A connection whose seal no longer opens
 * (the key rotated away) is passed over, never thrown.
 */
export async function resolveOrgShippingConfig(orgId: string): Promise<ShippingConfigResult> {
  const offered = readOwnAccountKinds().filter(isOwnLabelKind)
  const keyring = readShippingKeyring()
  if (offered.length && keyring) {
    for (const kind of offered) {
      const stored = await readOwnAccount(orgId, kind).catch(() => null)
      if (!stored) continue
      let opened: OpenedOwnAccount
      try {
        opened = openOwnAccount(stored, keyring)
      } catch {
        continue
      }
      const ownAccount: ProviderAccount = {
        providerId: kind,
        accountId: orgId,
        apiKey: opened.apiKey,
        ...(opened.apiSecret ? { apiSecret: opened.apiSecret } : {}),
      }
      return {
        configured: true,
        config: {
          provider: ownLabelProvider(kind, stored.settings ?? {}),
          providerId: kind,
          keyring,
          testMode: stored.testMode,
          ownAccount,
        },
      }
    }
  }
  return readShippingConfig()
}

let shipperHqOverride: ShipperHqEngine | null = null
let shipperHqEngine: ShipperHqEngine | null = null

/** Test seam: the engine ShipperHQ quotes are asked of. */
export function setShipperHqEngineForTests(engine: ShipperHqEngine | null): void {
  shipperHqOverride = engine
  shipperHqEngine = null
}

export function shipperHq(): ShipperHqEngine {
  if (shipperHqOverride) return shipperHqOverride
  shipperHqEngine ??= createShipperHqEngine({ fetchImpl: shippingFetch() })
  return shipperHqEngine
}

/** The workspace's ShipperHQ credentials, opened, when it connected them and the deployment offers it. */
export async function readShipperHqCredentials(
  orgId: string,
): Promise<{ credentials: ShipperHqCredentials; cacheKey: string } | null> {
  if (!readOwnAccountKinds().includes('shipperhq')) return null
  const keyring = readShippingKeyring()
  if (!keyring) return null
  const stored = await readOwnAccount(orgId, 'shipperhq').catch(() => null)
  if (!stored) return null
  try {
    const opened = openOwnAccount(stored, keyring)
    if (!opened.apiSecret) return null
    return {
      credentials: shipperHqCredentials(opened.apiKey, opened.apiSecret, stored.settings),
      cacheKey: `${orgId}:${stored.connectedAtMs}`,
    }
  } catch {
    return null
  }
}

function shipperHqCredentials(
  apiKey: string,
  authCode: string,
  settings: StoredOwnAccount['settings'],
): ShipperHqCredentials {
  const scope = String(settings.scope ?? 'LIVE').toUpperCase()
  return {
    apiKey,
    authCode,
    scope: scope === 'TEST' || scope === 'DEVELOPMENT' || scope === 'INTEGRATION' ? scope : 'LIVE',
    weightUnit: settings.weightUnit === 'kg' ? 'kg' : 'lb',
  }
}

const text = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)

/**
 * Connects a service with the merchant's credentials: each field the
 * service asks for, checked against the service itself, then sealed. A
 * second label platform is refused while one is connected; connecting the
 * same one again replaces its credentials.
 */
export async function connectOwnAccount(input: {
  orgId: string
  uid: string
  kind: OwnAccountKind
  values: Record<string, unknown>
}): Promise<OwnAccountView> {
  const { orgId, kind } = input
  const keyring = readShippingKeyring()
  if (!keyring || !readOwnAccountKinds().includes(kind)) {
    throw new OwnAccountError('That service is not offered on this deployment.', 404)
  }
  const service = OWN_ACCOUNT_SERVICES[kind]
  const values: Record<string, string> = {}
  for (const field of service.fields) {
    const value = text(input.values[field.key], field.secret ? 400 : 120)
    if (field.required && !value) throw new OwnAccountError(`Enter the ${field.label.toLowerCase()}.`, 400)
    if (field.options && value && !field.options.some((option) => option.value === value)) {
      throw new OwnAccountError(`Pick a ${field.label.toLowerCase()} from the list.`, 400)
    }
    if (value) values[field.key] = value
  }
  if (isOwnLabelKind(kind)) {
    const other = OWN_LABEL_KINDS.find((one) => one !== kind)
    if (other && (await readOwnAccount(orgId, other))) {
      throw new OwnAccountError(
        `This workspace ships through ${OWN_ACCOUNT_SERVICES[other].label}. Disconnect it first.`,
        409,
      )
    }
  }
  const settings: StoredOwnAccount['settings'] = {
    ...(values['itemCategory'] ? { itemCategory: values['itemCategory'] } : {}),
    ...(values['scope'] ? { scope: values['scope'] } : {}),
    ...(values['weightUnit'] ? { weightUnit: values['weightUnit'] } : {}),
  }
  let accountName: string
  let testMode: boolean
  if (kind === 'shipperhq') {
    const credentials = shipperHqCredentials(values['apiKey'], values['apiSecret'] ?? '', settings)
    await shipperHq().verify(credentials)
    accountName = `ShipperHQ (${credentials.scope.toLowerCase()})`
    testMode = credentials.scope !== 'LIVE'
  } else {
    const provider = ownLabelProvider(kind, settings)
    const verified = await provider.verifyCredentials!({
      providerId: kind,
      accountId: orgId,
      apiKey: values['apiKey'],
      ...(values['apiSecret'] ? { apiSecret: values['apiSecret'] } : {}),
    })
    accountName = text(verified.accountName, 120) || service.label
    // Easyship's sandbox tokens are `sand_…`; Sendcloud has no sandbox.
    testMode = kind === 'easyship' && values['apiKey'].startsWith('sand_')
  }
  const seal = (value: string, field: string) =>
    sealSecret(value, keyring.current, { context: sealContext(orgId, kind, field) })
  const stored: StoredOwnAccount = {
    kind,
    orgId,
    status: 'active',
    sealedApiKey: seal(values['apiKey'], 'apiKey'),
    ...(values['apiSecret'] ? { sealedApiSecret: seal(values['apiSecret'], 'apiSecret') } : {}),
    ...(values['webhookSecret'] ? { sealedWebhookSecret: seal(values['webhookSecret'], 'webhookSecret') } : {}),
    keyId: keyring.current.id,
    accountName,
    testMode,
    settings,
    connectedAtMs: Date.now(),
    connectedByUid: input.uid,
  }
  // The other label platform is read again inside the write, so two members
  // connecting Easyship and Sendcloud at once leave one, not both.
  await shippingDb().runTransaction(async (transaction) => {
    if (isOwnLabelKind(kind)) {
      const other = OWN_LABEL_KINDS.find((one) => one !== kind)
      if (other && readStored((await transaction.get(ownAccountRef(orgId, other))).data())) {
        throw new OwnAccountError(
          `This workspace ships through ${OWN_ACCOUNT_SERVICES[other].label}. Disconnect it first.`,
          409,
        )
      }
    }
    transaction.set(ownAccountRef(orgId, kind), stored)
  })
  return ownAccountView(stored)
}

/** Forgets a connection. Labels already bought stay, with their tracking. */
export async function disconnectOwnAccount(orgId: string, kind: OwnAccountKind): Promise<void> {
  await ownAccountRef(orgId, kind).delete()
}
