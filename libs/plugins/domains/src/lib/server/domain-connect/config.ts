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
import { DOMAINS_API_ROUTES } from '../../constants/bundle-common'
import { readDomainConnectPrivateKey, type DomainConnectSigningConfig } from './signing'

/*
 * WHAT ONE-CLICK DNS NEEDS FROM THE DEPLOYMENT (AGL-3963).
 *
 * - `DOMAIN_CONNECT_PRIVATE_KEY` — the RSA key whose public half is published
 *   in DNS (`tools/scripts/domain-connect-key.mjs` makes the pair). Without
 *   it nothing is offered: discovery answers "not supported" for every
 *   domain, so the widget draws nothing and the printed records stay.
 * - `DOMAIN_CONNECT_PROVIDER_ID` — the provider id the templates are
 *   published under. Aglyn's own deployment uses the default; an operator who
 *   publishes templates of their own names theirs.
 * - `DOMAIN_CONNECT_KEY_HOST` — the TXT host the public key sits at, under the
 *   templates' `syncPubKeyDomain`. A rotation publishes a new host and points
 *   this at it.
 */

/** The provider id Aglyn's templates are published under. */
const DEFAULT_PROVIDER_ID = 'aglyn.com'

/** The TXT host of the first published key. */
const DEFAULT_KEY_HOST = '_dcpubkeyv1'

export interface DomainConnectConfig {
  providerId: string
  signing: DomainConnectSigningConfig
  /** Where a provider sends the owner back to: the return route. */
  redirectUri: string
}

/** The console path a provider returns the owner to. */
export const DOMAIN_CONNECT_RETURN_PATH = `/api/${DOMAINS_API_ROUTES.connectReturn}`

let cached: { raw: string; config: DomainConnectConfig | null } | null = null

/** The deployment's configuration, or null when one-click DNS is off. */
export function readDomainConnectConfig(
  env: Record<string, string | undefined> = process.env,
): DomainConnectConfig | null {
  const raw = String(env['DOMAIN_CONNECT_PRIVATE_KEY'] ?? '')
  const providerId = String(env['DOMAIN_CONNECT_PROVIDER_ID'] ?? '').trim() || DEFAULT_PROVIDER_ID
  const keyHost = String(env['DOMAIN_CONNECT_KEY_HOST'] ?? '').trim() || DEFAULT_KEY_HOST
  // Parsing a PEM costs a millisecond or two; every discovery asks.
  const key = cached?.raw === raw ? (cached.config?.signing.privateKey ?? null) : readDomainConnectPrivateKey(raw)
  if (!key) {
    cached = { raw, config: null }
    return null
  }
  const config: DomainConnectConfig = {
    providerId,
    signing: { privateKey: key, keyHost },
    redirectUri: `${platformConsoleOrigin()}${DOMAIN_CONNECT_RETURN_PATH}`,
  }
  cached = { raw, config }
  return config
}
