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

import { openSecret, sealSecret } from '@aglyn/shared-util-tools/secret-box'
import { SHIPPING_COLLECTIONS } from '../constants/bundle-common'
import type { ProviderAccount, ShippingProviderId } from '../providers/types'
import type { ShippingConfig } from './config'
import { orgRef } from './db'

/**
 * A WORKSPACE'S ACCOUNT AT THE CARRIER PLATFORM (AGL-3612):
 * `orgs/{orgId}/shippingAccounts/{provider}_{mode}`.
 *
 * Opened lazily — the first time a member of the workspace asks for a rate
 * or a label — and never shown. Its ids are sealed under
 * `SHIPPING_TOKEN_KEY`, bound to this document by the seal's context, so a
 * sealed value copied onto another workspace's record refuses to open there.
 * Test and live are separate documents: a provider's test credential opens
 * test accounts, and a live label must never be bought on one.
 *
 * The document also carries the member's CONSENT to label charges being
 * taken from the Stripe balance (Stripe: account debits require "legally
 * binding consent from your connected accounts"): who agreed, when, and to
 * which wording.
 */

export interface StoredShippingAccount {
  providerId: ShippingProviderId
  mode: 'test' | 'live'
  status: 'creating' | 'active'
  sealedAccountId?: string
  sealedApiKey?: string
  keyId?: string
  createdAtMs: number
  createdByUid?: string
  debitConsent?: { acceptedAtMs: number; uid: string; version: string }
}

/** The wording a member agrees to, versioned so a change asks again. */
export const LABEL_DEBIT_CONSENT_VERSION = '2026-10-06'
export const LABEL_DEBIT_CONSENT_TEXT =
  'I authorize Aglyn to take the cost of each shipping label I buy from my store’s ' +
  'Stripe balance when the label is bought, and to return it there when a voided ' +
  'label is refunded. Labels the balance cannot cover are added to my monthly invoice.'

export function shippingAccountDocId(config: Pick<ShippingConfig, 'providerId' | 'testMode'>): string {
  return `${config.providerId}_${config.testMode ? 'test' : 'live'}`
}

export function shippingAccountRef(orgId: string, config: Pick<ShippingConfig, 'providerId' | 'testMode'>) {
  return orgRef(orgId).collection(SHIPPING_COLLECTIONS.accounts).doc(shippingAccountDocId(config))
}

const sealContext = (orgId: string, docId: string, field: string) =>
  `orgs/${orgId}/${SHIPPING_COLLECTIONS.accounts}/${docId}#${field}`

/** The workspace's account, opened, or `null` when it has none yet. */
export async function openShippingAccount(
  orgId: string,
  config: ShippingConfig,
): Promise<ProviderAccount | null> {
  const snapshot = await shippingAccountRef(orgId, config).get()
  const stored = snapshot.data() as StoredShippingAccount | undefined
  if (!stored || stored.status !== 'active' || !stored.sealedAccountId) return null
  const docId = shippingAccountDocId(config)
  const accountId = openSecret(stored.sealedAccountId, config.keyring, {
    context: sealContext(orgId, docId, 'accountId'),
  }).plaintext
  const apiKey = stored.sealedApiKey
    ? openSecret(stored.sealedApiKey, config.keyring, {
        context: sealContext(orgId, docId, 'apiKey'),
      }).plaintext
    : undefined
  return { providerId: stored.providerId, accountId, ...(apiKey ? { apiKey } : {}) }
}

/** How long a half-opened account blocks a second opening before it is retried. */
const CREATING_STALE_MS = 2 * 60 * 1000

/**
 * The workspace's account, opened at the provider the first time it is
 * needed. The `creating` marker is taken with `create()` so two members
 * asking at once open ONE account; the second waits for the first, and a
 * marker left by a process that died is retried after two minutes.
 */
export async function ensureShippingAccount(
  orgId: string,
  config: ShippingConfig,
  owner: { name: string; email: string; company: string; uid?: string },
): Promise<ProviderAccount> {
  const existing = await openShippingAccount(orgId, config)
  if (existing) return existing
  const ref = shippingAccountRef(orgId, config)
  const docId = shippingAccountDocId(config)
  try {
    await ref.create({
      providerId: config.providerId,
      mode: config.testMode ? 'test' : 'live',
      status: 'creating',
      createdAtMs: Date.now(),
      ...(owner.uid ? { createdByUid: owner.uid } : {}),
    } satisfies StoredShippingAccount)
  } catch {
    const current = (await ref.get()).data() as StoredShippingAccount | undefined
    if (current?.status === 'active') {
      const opened = await openShippingAccount(orgId, config)
      if (opened) return opened
    }
    if (current && Date.now() - current.createdAtMs < CREATING_STALE_MS) {
      throw Object.assign(new Error('The shipping account is being opened. Try again in a moment.'), {
        status: 409,
      })
    }
    await ref.set({ status: 'creating', createdAtMs: Date.now() }, { merge: true })
  }
  try {
    const account = await config.provider.createAccount({
      orgId,
      name: owner.name,
      email: owner.email,
      company: owner.company,
    })
    await ref.set(
      {
        status: 'active',
        sealedAccountId: sealSecret(account.accountId, config.keyring.current, {
          context: sealContext(orgId, docId, 'accountId'),
        }),
        ...(account.apiKey
          ? {
              sealedApiKey: sealSecret(account.apiKey, config.keyring.current, {
                context: sealContext(orgId, docId, 'apiKey'),
              }),
            }
          : {}),
        keyId: config.keyring.current.id,
      },
      { merge: true },
    )
    return account
  } catch (error) {
    await ref.delete().catch(() => undefined)
    throw error
  }
}

/** The member's consent to balance debits, or `null`. */
export async function readDebitConsent(
  orgId: string,
  config: ShippingConfig,
): Promise<StoredShippingAccount['debitConsent'] | null> {
  const stored = (await shippingAccountRef(orgId, config).get()).data() as StoredShippingAccount | undefined
  const consent = stored?.debitConsent
  return consent && consent.version === LABEL_DEBIT_CONSENT_VERSION ? consent : null
}

/** Records the member's consent, or withdraws it. */
export async function writeDebitConsent(
  orgId: string,
  config: ShippingConfig,
  uid: string,
  accepted: boolean,
): Promise<void> {
  await shippingAccountRef(orgId, config).set(
    accepted
      ? { debitConsent: { acceptedAtMs: Date.now(), uid, version: LABEL_DEBIT_CONSENT_VERSION } }
      : { debitConsent: null },
    { merge: true },
  )
}
