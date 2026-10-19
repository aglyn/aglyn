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

import { createPrivateKey, sign, type KeyObject } from 'node:crypto'

/*
 * THE SIGNED APPLY LINK (AGL-3963).
 *
 * Both templates name `syncPubKeyDomain`, so a DNS provider refuses an apply
 * link that is not signed by the key published for it. That is what stops a
 * stranger from building a link that writes Aglyn's records into a zone with
 * a redirect of their choosing: the signature covers the domain, the host,
 * the return address and the state together.
 *
 * The rule, from the Domain Connect spec: the signature is RS256 (RSA with
 * SHA-256) over the query string exactly as sent — every parameter after the
 * `?`, values URL-encoded — EXCEPT `sig` and `key`, which are appended after
 * it. `key` names the TXT host the public key is published at, under the
 * template's `syncPubKeyDomain` (`_dcpubkeyv1.aglyn.com`); a new key under a
 * new name is a rotation with no template change.
 */

/** Configuration the signer reads from the deployment. */
export interface DomainConnectSigningConfig {
  /** The key, parsed once. */
  privateKey: KeyObject
  /** The TXT host the public half is published at, under `syncPubKeyDomain`. */
  keyHost: string
}

/**
 * The private key from `DOMAIN_CONNECT_PRIVATE_KEY`: a PEM, with its line
 * breaks written as `\n` where the variable store keeps one line. Null when
 * unset or unreadable, which turns one-click DNS off rather than failing it.
 */
export function readDomainConnectPrivateKey(raw: string | undefined): KeyObject | null {
  const pem = String(raw ?? '').trim().replace(/\\n/g, '\n')
  if (!pem) return null
  try {
    const key = createPrivateKey(pem)
    return key.asymmetricKeyType === 'rsa' ? key : null
  } catch {
    return null
  }
}

/** One query parameter, in the order it is sent. */
export type QueryPair = readonly [name: string, value: string]

/** `name=value&…`, each side URL-encoded, in the order given. */
export function encodeQuery(pairs: readonly QueryPair[]): string {
  return pairs
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&')
}

/** The base64 RS256 signature of `query`, as the spec's `sig` carries it before encoding. */
export function signDomainConnectQuery(query: string, privateKey: KeyObject): string {
  return sign('sha256', Buffer.from(query, 'utf8'), privateKey).toString('base64')
}

export interface ApplyUrlInput {
  /** The provider's `urlSyncUX`, from its settings. */
  urlSyncUX: string
  providerId: string
  serviceId: string
  /** The zone root. */
  domain: string
  /** The name under the root the template applies to; empty for the root. */
  host: string
  redirectUri: string
  state: string
}

/**
 * The provider's apply link for one template, signed.
 *
 * `host` is left out entirely for the zone root, rather than sent empty: the
 * spec reads a missing `host` as the root, and an empty one is a parameter a
 * strict provider may refuse.
 */
export function buildSignedApplyUrl(input: ApplyUrlInput, signing: DomainConnectSigningConfig): string {
  const pairs: QueryPair[] = [['domain', input.domain]]
  if (input.host) pairs.push(['host', input.host])
  pairs.push(['redirect_uri', input.redirectUri], ['state', input.state])
  const query = encodeQuery(pairs)
  const sig = signDomainConnectQuery(query, signing.privateKey)
  const base = input.urlSyncUX.replace(/\/+$/, '')
  const path =
    `/v2/domainTemplates/providers/${encodeURIComponent(input.providerId)}` +
    `/services/${encodeURIComponent(input.serviceId)}/apply`
  return `${base}${path}?${query}&sig=${encodeURIComponent(sig)}&key=${encodeURIComponent(signing.keyHost)}`
}
