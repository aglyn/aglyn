/**
 * @jest-environment node
 *
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
 * The signed apply link (AGL-3963). A DNS provider verifies the signature
 * over the query string WITHOUT `sig` and `key`, with the public key it
 * reads from DNS — so that is exactly what these cases do, with node's own
 * verifier, rather than comparing against a stored signature.
 */

import { generateKeyPairSync, verify } from 'node:crypto'
import { buildSignedApplyUrl, encodeQuery, readDomainConnectPrivateKey } from './signing'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const signing = { privateKey, keyHost: '_dcpubkeyv1' }

const base = {
  urlSyncUX: 'https://dash.provider.example/domainconnect/',
  providerId: 'aglyn.com',
  serviceId: 'website',
  domain: 'example.com',
  host: '',
  redirectUri: 'https://app.aglyn.com/api/domain-connect/return',
  state: 'S'.repeat(43),
}

/** The query as sent, split at `&sig=`: what was signed, and the rest. */
function split(url: string) {
  const query = url.slice(url.indexOf('?') + 1)
  const at = query.indexOf('&sig=')
  const signed = query.slice(0, at)
  const tail = new URLSearchParams(query.slice(at + 1))
  return { signed, sig: tail.get('sig') ?? '', key: tail.get('key') ?? '' }
}

describe('the apply link a provider is sent to', () => {
  it('is the provider’s apply path for our template, with the spec’s parameters', () => {
    const url = new URL(buildSignedApplyUrl(base, signing))
    expect(url.origin + url.pathname).toBe(
      'https://dash.provider.example/domainconnect/v2/domainTemplates/providers/aglyn.com/services/website/apply',
    )
    expect(url.searchParams.get('domain')).toBe('example.com')
    expect(url.searchParams.get('redirect_uri')).toBe(base.redirectUri)
    expect(url.searchParams.get('state')).toBe(base.state)
    expect(url.searchParams.get('key')).toBe('_dcpubkeyv1')
  })

  it('leaves host out for the zone root rather than sending it empty', () => {
    const url = buildSignedApplyUrl(base, signing)
    expect(new URL(url).searchParams.has('host')).toBe(false)
    expect(url).not.toContain('host=')
  })

  it('sends host for a subdomain', () => {
    const url = buildSignedApplyUrl({ ...base, serviceId: 'website-subdomain', host: 'shop' }, signing)
    expect(new URL(url).searchParams.get('host')).toBe('shop')
  })

  it('URL-encodes every value BEFORE signing, as the spec requires', () => {
    const { signed } = split(buildSignedApplyUrl(base, signing))
    expect(signed).toBe(
      'domain=example.com&redirect_uri=https%3A%2F%2Fapp.aglyn.com%2Fapi%2Fdomain-connect%2Freturn&state=' +
        base.state,
    )
    expect(encodeQuery([['a b', 'c&d=e']])).toBe('a%20b=c%26d%3De')
  })
})

describe('the signature', () => {
  it('verifies with the public key over the query without sig and key', () => {
    const { signed, sig } = split(buildSignedApplyUrl({ ...base, host: 'shop' }, signing))
    expect(verify('sha256', Buffer.from(signed), publicKey, Buffer.from(sig, 'base64'))).toBe(true)
  })

  it('fails for any change to what was signed: a different redirect is refused', () => {
    const { signed, sig } = split(buildSignedApplyUrl(base, signing))
    const tampered = signed.replace('app.aglyn.com', 'evil.example')
    expect(verify('sha256', Buffer.from(tampered), publicKey, Buffer.from(sig, 'base64'))).toBe(false)
  })

  it('is carried URL-encoded, so a base64 + survives the query string', () => {
    const url = buildSignedApplyUrl(base, signing)
    const raw = url.slice(url.indexOf('&sig=') + 5, url.indexOf('&key='))
    expect(raw).not.toMatch(/[+/=]/)
    expect(decodeURIComponent(raw)).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })
})

describe('the key from DOMAIN_CONNECT_PRIVATE_KEY', () => {
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

  it('reads a PEM, and the same PEM written on one line with \\n', () => {
    expect(readDomainConnectPrivateKey(pem)?.asymmetricKeyType).toBe('rsa')
    expect(readDomainConnectPrivateKey(pem.trim().replace(/\n/g, '\\n'))?.asymmetricKeyType).toBe('rsa')
  })

  it('answers null for nothing, for junk, and for a key that is not RSA', () => {
    expect(readDomainConnectPrivateKey(undefined)).toBeNull()
    expect(readDomainConnectPrivateKey('   ')).toBeNull()
    expect(readDomainConnectPrivateKey('-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----')).toBeNull()
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
    expect(readDomainConnectPrivateKey(ec.export({ type: 'pkcs8', format: 'pem' }).toString())).toBeNull()
  })
})
