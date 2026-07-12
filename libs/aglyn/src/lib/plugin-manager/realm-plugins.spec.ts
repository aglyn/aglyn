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

import { generateKeyPairSync, sign as nodeSign } from 'node:crypto'
import {
  sha256Hex,
  verifyRealmBundle,
  verifyRealmSignature,
} from './realm-plugins'

/** Mirrors the staff signing flow: Ed25519 over the sha256 hex string. */
function makeKeysAndSign(shaHex: string) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const signature = nodeSign(null, Buffer.from(shaHex, 'utf8'), privateKey)
  const publicRaw = publicKey.export({ format: 'jwk' }) as { x: string }
  // JWK x is base64url; the loader expects standard base64 raw key bytes.
  const publicKeyBase64 = Buffer.from(publicRaw.x, 'base64url').toString('base64')
  return { publicKeyBase64, signatureBase64: signature.toString('base64') }
}

describe('realm bundle verification (AGL-420)', () => {
  const bundle = new TextEncoder().encode(
    'export function register(host){/* demo */}',
  )
  const bytes = bundle.buffer.slice(0) as ArrayBuffer

  it('accepts a bundle whose sha matches the pinned install (no key configured)', async () => {
    const sha256 = await sha256Hex(bytes)
    const verdict = await verifyRealmBundle(bytes, {
      listingId: 'demo',
      version: '1.0.0',
      sha256,
      trust: 'realm',
    })
    expect(verdict).toEqual({ ok: true })
  })

  it('rejects tampered bytes (sha mismatch)', async () => {
    const sha256 = await sha256Hex(bytes)
    const tampered = new TextEncoder().encode(
      'export function register(host){/* evil */}',
    ).buffer.slice(0) as ArrayBuffer
    const verdict = await verifyRealmBundle(tampered, {
      listingId: 'demo',
      version: '1.0.0',
      sha256,
      trust: 'realm',
    })
    expect(verdict).toMatchObject({ ok: false })
    expect((verdict as { reason: string }).reason).toContain('sha256 mismatch')
  })

  it('verifies a platform Ed25519 signature (node sign → WebCrypto verify)', async () => {
    const sha256 = await sha256Hex(bytes)
    const { publicKeyBase64, signatureBase64 } = makeKeysAndSign(sha256)
    await expect(
      verifyRealmSignature(sha256, signatureBase64, publicKeyBase64),
    ).resolves.toBe(true)
    const verdict = await verifyRealmBundle(
      bytes,
      {
        listingId: 'demo',
        version: '1.0.0',
        sha256,
        trust: 'realm',
        signature: signatureBase64,
      },
      publicKeyBase64,
    )
    expect(verdict).toEqual({ ok: true })
  })

  it('fails closed with a configured key: missing or wrong signature', async () => {
    const sha256 = await sha256Hex(bytes)
    const { publicKeyBase64 } = makeKeysAndSign(sha256)
    const missing = await verifyRealmBundle(
      bytes,
      { listingId: 'demo', version: '1.0.0', sha256, trust: 'realm' },
      publicKeyBase64,
    )
    expect(missing).toMatchObject({ ok: false, reason: 'missing signature' })

    const other = makeKeysAndSign(sha256) // signed by a DIFFERENT key
    const forged = await verifyRealmBundle(
      bytes,
      {
        listingId: 'demo',
        version: '1.0.0',
        sha256,
        trust: 'realm',
        signature: other.signatureBase64,
      },
      publicKeyBase64,
    )
    expect(forged).toMatchObject({ ok: false, reason: 'invalid signature' })
  })
})
