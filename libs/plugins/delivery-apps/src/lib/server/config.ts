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
import { DELIVERY_APPS_ENV } from '../constants'
import { DELIVERY_SERVICE_IDS, type DeliveryServiceId } from '../model/delivery-apps'

/**
 * What this deployment can take orders from (AGL-3644), read from env on
 * the console.
 *
 * Each service admits a point-of-sale integration only through a partner
 * (integration provider) account the deployment's operator holds with it.
 * A service is offered only when every variable it names is set; with none
 * set, the plugin draws nothing, page or docs, and every route — webhooks
 * included — answers as though it did not exist. Nothing is stored per
 * merchant that is a secret: a store is linked by the id the service shows
 * the merchant, and every call is signed with the deployment's credentials.
 *
 * Read in the bracket form, so a bundler never inlines a value.
 */

export interface DoordashConfig {
  developerId: string
  keyId: string
  /** base64url, as DoorDash issues it; signs each request's JWT. */
  signingSecret: string
  /** The token DoorDash sends with each webhook, as set for the integration. */
  webhookSecret: string
  /** The provider type DoorDash assigned the integration, sent with each menu. */
  providerType: string | null
  sandbox: boolean
}

export interface UberEatsConfig {
  clientId: string
  /** Signs each webhook (`X-Uber-Signature`) and authenticates the token request. */
  clientSecret: string
  sandbox: boolean
}

export interface GrubhubConfig {
  clientId: string
  /** base64, as Grubhub issues it; the MAC key for each request and webhook. */
  secretKey: string
  partnerKey: string
  sandbox: boolean
}

export interface DeliveryAppsConfig {
  doordash: DoordashConfig | null
  'uber-eats': UberEatsConfig | null
  grubhub: GrubhubConfig | null
}

const read = (env: Record<string, string | undefined>, name: string) => String(env[name] ?? '').trim()
const sandbox = (env: Record<string, string | undefined>, name: string) => read(env, name).toLowerCase() === 'sandbox'

export function readDeliveryAppsConfig(env: Record<string, string | undefined> = process.env): DeliveryAppsConfig {
  const E = DELIVERY_APPS_ENV
  const dd = {
    developerId: read(env, E.doordashDeveloperId),
    keyId: read(env, E.doordashKeyId),
    signingSecret: read(env, E.doordashSigningSecret),
    webhookSecret: read(env, E.doordashWebhookSecret),
  }
  const uber = { clientId: read(env, E.uberEatsClientId), clientSecret: read(env, E.uberEatsClientSecret) }
  const gh = {
    clientId: read(env, E.grubhubClientId),
    secretKey: read(env, E.grubhubSecretKey),
    partnerKey: read(env, E.grubhubPartnerKey),
  }
  return {
    doordash: Object.values(dd).every(Boolean)
      ? { ...dd, providerType: read(env, E.doordashProviderType) || null, sandbox: sandbox(env, E.doordashEnvironment) }
      : null,
    'uber-eats': Object.values(uber).every(Boolean) ? { ...uber, sandbox: sandbox(env, E.uberEatsEnvironment) } : null,
    grubhub: Object.values(gh).every(Boolean) ? { ...gh, sandbox: sandbox(env, E.grubhubEnvironment) } : null,
  }
}

/** The services a merchant may connect here. Empty means the plugin shows nothing. */
export function offeredServices(config: DeliveryAppsConfig): DeliveryServiceId[] {
  return DELIVERY_SERVICE_IDS.filter((id) => config[id] !== null)
}

/** The sentence a route answers when the deployment takes no delivery service. */
export const NOT_CONFIGURED_MESSAGE = 'Delivery apps are not available on this deployment.'
