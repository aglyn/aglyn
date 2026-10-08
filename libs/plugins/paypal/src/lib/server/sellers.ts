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

import { randomBytes } from 'node:crypto'
import type { PayPalConfig } from './config'
import { isDocumentId, sellersCollection } from './db'
import { payPalOk, payPalRequest } from './paypal-api'

/**
 * A workspace's PayPal seller account (AGL-3630), onboarded through PayPal's
 * Partner Referrals: the workspace owner follows PayPal's link, signs in to
 * (or opens) their own PayPal business account, and grants the platform
 * permission to take payments, refunds and its fee for them. Aglyn never
 * creates a PayPal account and never sees a PayPal password.
 *
 * What PayPal returns is a merchant id. The platform then acts with ITS
 * credentials on that merchant's behalf, so nothing of the merchant's is a
 * secret held here.
 *
 * A seller may take payments only when PayPal says all three of
 * `payments_receivable`, `primary_email_confirmed` and the platform's
 * third-party permissions — PayPal's own readiness test for a partner.
 */

export type PayPalSellerStatus = 'onboarding' | 'ready' | 'action-needed' | 'disconnected' | 'revoked'

export interface PayPalSellerRecord {
  orgId: string
  environment: PayPalConfig['environment']
  /** What PayPal links the referral to; fresh for each new connection. */
  trackingId: string
  merchantId?: string
  status: PayPalSellerStatus
  paymentsReceivable?: boolean
  primaryEmailConfirmed?: boolean
  permissionsGranted?: boolean
  startedByUid?: string
  createdAtMs: number
  updatedAtMs: number
  checkedAtMs?: number
}

/** What the console card draws: the record less nothing secret (there is nothing secret). */
export interface PayPalSellerView {
  status: PayPalSellerStatus | 'not-connected'
  merchantId: string | null
  /** What the merchant still has to do at PayPal, in their words. */
  actions: string[]
  livemode: boolean
}

/** The features the platform asks the seller to grant it. */
export const PAYPAL_PARTNER_FEATURES = ['PAYMENT', 'REFUND', 'PARTNER_FEE', 'ACCESS_MERCHANT_INFORMATION'] as const

export async function readSeller(orgId: string): Promise<PayPalSellerRecord | null> {
  if (!isDocumentId(orgId)) return null
  const snapshot = await sellersCollection().doc(orgId).get()
  return snapshot.exists ? (snapshot.data() as PayPalSellerRecord) : null
}

/** The seller, when it may take payments in this deployment's environment; else `null`. */
export async function readySeller(orgId: string, config: PayPalConfig): Promise<PayPalSellerRecord | null> {
  const seller = await readSeller(orgId)
  if (!seller || seller.status !== 'ready' || !seller.merchantId) return null
  return seller.environment === config.environment ? seller : null
}

export function sellerView(seller: PayPalSellerRecord | null, config: PayPalConfig): PayPalSellerView {
  if (!seller || seller.environment !== config.environment || seller.status === 'disconnected') {
    return { status: 'not-connected', merchantId: null, actions: [], livemode: config.environment === 'live' }
  }
  return {
    status: seller.status,
    merchantId: seller.merchantId ?? null,
    actions: sellerActions(seller),
    livemode: config.environment === 'live',
  }
}

function sellerActions(seller: PayPalSellerRecord): string[] {
  if (seller.status === 'revoked') return ['Your PayPal account withdrew Aglyn’s permission. Connect it again to accept PayPal.']
  if (seller.status === 'onboarding') return ['Finish setting up your account with PayPal.']
  const actions: string[] = []
  if (seller.primaryEmailConfirmed === false) {
    actions.push('Confirm your email address with PayPal. Until then you can’t take PayPal payments.')
  }
  if (seller.paymentsReceivable === false) {
    actions.push('PayPal is not letting your account receive payments yet. Sign in to PayPal and resolve its notice.')
  }
  if (seller.permissionsGranted === false) {
    actions.push('Grant Aglyn permission in PayPal to take payments for you: connect PayPal again and accept.')
  }
  return actions
}

/**
 * Opens (or resumes) PayPal onboarding for a workspace and answers the link
 * the owner follows. A workspace that is already connected and ready is
 * answered `null`: there is nothing to start.
 */
export async function startSellerOnboarding(
  config: PayPalConfig,
  input: { orgId: string; uid: string; returnUrl: string; nowMs?: number },
): Promise<{ actionUrl: string } | null> {
  const nowMs = input.nowMs ?? Date.now()
  const existing = await readSeller(input.orgId)
  if (existing?.status === 'ready' && existing.environment === config.environment) return null
  // A connection still in progress resumes on its tracking id; anything
  // else — none yet, disconnected, revoked, the other environment — starts
  // fresh, so PayPal links the new account rather than the old one.
  const resumable = existing?.status === 'onboarding' && existing.environment === config.environment
  const trackingId = resumable ? existing.trackingId : `aglyn-${input.orgId}-${randomBytes(6).toString('hex')}`.slice(0, 127)
  const referral = payPalOk(
    await payPalRequest<{ links?: Array<{ rel?: string; href?: string }> }>(config, {
      method: 'POST',
      path: '/v2/customer/partner-referrals',
      body: {
        tracking_id: trackingId,
        operations: [
          {
            operation: 'API_INTEGRATION',
            api_integration_preference: {
              rest_api_integration: {
                integration_method: 'PAYPAL',
                integration_type: 'THIRD_PARTY',
                third_party_details: { features: [...PAYPAL_PARTNER_FEATURES] },
              },
            },
          },
        ],
        products: ['EXPRESS_CHECKOUT'],
        legal_consents: [{ type: 'SHARE_DATA_CONSENT', granted: true }],
        partner_config_override: {
          return_url: input.returnUrl,
          return_url_description: 'Return to your store settings in Aglyn.',
        },
      },
    }),
    'start PayPal onboarding',
  )
  const actionUrl = referral.links?.find((link) => link.rel === 'action_url')?.href ?? ''
  if (!/^https:\/\/[^\s]+$/.test(actionUrl)) throw new Error('PayPal answered no onboarding link')
  const record: PayPalSellerRecord = {
    orgId: input.orgId,
    environment: config.environment,
    trackingId,
    status: 'onboarding',
    startedByUid: input.uid,
    createdAtMs: resumable ? existing.createdAtMs : nowMs,
    updatedAtMs: nowMs,
  }
  await sellersCollection().doc(input.orgId).set(record)
  return { actionUrl }
}

interface MerchantIntegration {
  merchant_id?: string
  tracking_id?: string
  payments_receivable?: boolean
  primary_email_confirmed?: boolean
  oauth_integrations?: Array<{
    integration_type?: string
    oauth_third_party?: Array<{ partner_client_id?: string; scopes?: string[] }>
  }>
}

/** Whether the merchant granted THIS partner app third-party access. */
export function permissionsGrantedTo(integration: MerchantIntegration, clientId: string): boolean {
  return (integration.oauth_integrations ?? []).some(
    (oauth) =>
      oauth.integration_type === 'OAUTH_THIRDPARTY' &&
      (oauth.oauth_third_party ?? []).some(
        (grant) => grant.partner_client_id === clientId && (grant.scopes ?? []).length > 0,
      ),
  )
}

/**
 * Re-reads the seller from PayPal: the merchant id the tracking id led to,
 * and the three readiness facts. Idempotent; a seller PayPal has not linked
 * yet stays `onboarding`.
 */
export async function refreshSeller(
  config: PayPalConfig,
  orgId: string,
  nowMs = Date.now(),
): Promise<PayPalSellerRecord | null> {
  const seller = await readSeller(orgId)
  if (!seller || seller.environment !== config.environment) return seller
  if (seller.status === 'disconnected') return seller
  let merchantId = seller.merchantId ?? ''
  if (!merchantId) {
    const found = await payPalRequest<{ merchant_id?: string }>(config, {
      method: 'GET',
      path: `/v1/customer/partners/${encodeURIComponent(config.partnerMerchantId)}/merchant-integrations?tracking_id=${encodeURIComponent(seller.trackingId)}`,
    })
    // 404: the merchant has not finished at PayPal yet.
    if (found.status === 404) {
      await sellersCollection().doc(orgId).set({ checkedAtMs: nowMs }, { merge: true })
      return { ...seller, checkedAtMs: nowMs }
    }
    merchantId = String(payPalOk(found, 'find the PayPal seller').merchant_id ?? '')
    if (!merchantId) return seller
  }
  const integration = payPalOk(
    await payPalRequest<MerchantIntegration>(config, {
      method: 'GET',
      path: `/v1/customer/partners/${encodeURIComponent(config.partnerMerchantId)}/merchant-integrations/${encodeURIComponent(merchantId)}`,
    }),
    'read the PayPal seller',
  )
  const paymentsReceivable = integration.payments_receivable === true
  const primaryEmailConfirmed = integration.primary_email_confirmed === true
  const permissionsGranted = permissionsGrantedTo(integration, config.clientId)
  const status: PayPalSellerStatus =
    paymentsReceivable && primaryEmailConfirmed && permissionsGranted ? 'ready' : 'action-needed'
  const next: PayPalSellerRecord = {
    ...seller,
    merchantId,
    status,
    paymentsReceivable,
    primaryEmailConfirmed,
    permissionsGranted,
    updatedAtMs: nowMs,
    checkedAtMs: nowMs,
  }
  await sellersCollection().doc(orgId).set(next)
  return next
}

/** Stops offering PayPal for the workspace. The merchant's PayPal account is untouched. */
export async function disconnectSeller(orgId: string, nowMs = Date.now()): Promise<void> {
  if (!isDocumentId(orgId)) return
  const seller = await readSeller(orgId)
  if (!seller) return
  await sellersCollection().doc(orgId).set({ status: 'disconnected', updatedAtMs: nowMs }, { merge: true })
}

/** The workspace whose seller is this merchant or tracking id, from a webhook. */
export async function findSellerOrg(by: { merchantId?: string; trackingId?: string }): Promise<string | null> {
  const [field, value] = by.trackingId ? ['trackingId', by.trackingId] : ['merchantId', by.merchantId ?? '']
  if (!value) return null
  const matches = await sellersCollection().where(field, '==', value).limit(2).get()
  return matches.docs.length === 1 ? String(matches.docs[0].get('orgId') ?? matches.docs[0].id) : null
}

/** PayPal said the merchant withdrew the platform's permission. */
export async function markSellerRevoked(orgId: string, nowMs = Date.now()): Promise<void> {
  await sellersCollection()
    .doc(orgId)
    .set({ status: 'revoked', permissionsGranted: false, updatedAtMs: nowMs }, { merge: true })
}
