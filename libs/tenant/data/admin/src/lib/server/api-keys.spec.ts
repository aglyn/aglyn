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

import { createHash } from 'node:crypto'
import {
  API_KEY_TOKEN_PREFIX,
  type ApiKeyDocument,
  generateApiKeyToken,
  generateKeyId,
  hasScope,
  hashApiKey,
  isApiScope,
  isValidApiKeyFormat,
  normalizeScopes,
  toPublicApiKey,
} from './api-keys'

// The storage functions import the Admin SDK facade (side-effecting init);
// stub it so this pure-function suite never touches Firestore.
jest.mock('./firebase-admin', () => ({ firebaseAdmin: {} }))

describe('api-keys (pure helpers)', () => {
  describe('isApiScope / normalizeScopes', () => {
    it('recognizes known scopes and rejects others', () => {
      expect(isApiScope('datasets:read')).toBe(true)
      expect(isApiScope('datasets:delete')).toBe(false)
      expect(isApiScope('')).toBe(false)
    })

    it('drops invalid scopes, de-dupes, and canonicalizes order', () => {
      expect(
        normalizeScopes([
          'contacts:read',
          'datasets:read',
          'datasets:read',
          'bogus',
          'sites:read',
        ]),
      ).toEqual(['datasets:read', 'contacts:read', 'sites:read'])
    })

    it('returns an empty array when nothing is valid', () => {
      expect(normalizeScopes(['nope', 'also:nope'])).toEqual([])
    })
  })

  describe('hashApiKey', () => {
    it('is a stable SHA-256 hex digest of the token', () => {
      const token = 'aglyn_sk_example-token-value'
      const expected = createHash('sha256').update(token).digest('hex')
      expect(hashApiKey(token)).toBe(expected)
      expect(hashApiKey(token)).toHaveLength(64)
    })

    it('differs for different tokens', () => {
      expect(hashApiKey('aglyn_sk_aaaa1111')).not.toBe(
        hashApiKey('aglyn_sk_bbbb2222'),
      )
    })
  })

  describe('isValidApiKeyFormat', () => {
    it('accepts a well-formed token', () => {
      const { token } = generateApiKeyToken()
      expect(isValidApiKeyFormat(token)).toBe(true)
    })

    it('rejects wrong prefix, short body, and non-strings', () => {
      expect(isValidApiKeyFormat('sk_live_abcdefghijklmnop')).toBe(false)
      expect(isValidApiKeyFormat('aglyn_sk_short')).toBe(false)
      expect(isValidApiKeyFormat('')).toBe(false)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(isValidApiKeyFormat(undefined as any)).toBe(false)
    })
  })

  describe('generateApiKeyToken', () => {
    it('returns a valid token, matching hash, and a truncated display prefix', () => {
      const { token, hash, keyPrefix } = generateApiKeyToken()
      expect(token.startsWith(API_KEY_TOKEN_PREFIX)).toBe(true)
      expect(isValidApiKeyFormat(token)).toBe(true)
      expect(hash).toBe(hashApiKey(token))
      expect(keyPrefix.startsWith(API_KEY_TOKEN_PREFIX)).toBe(true)
      expect(keyPrefix.endsWith('…')).toBe(true)
      // The prefix must NOT reveal the whole secret.
      expect(keyPrefix.length).toBeLessThan(token.length)
    })

    it('produces unique tokens', () => {
      const tokens = new Set(
        Array.from({ length: 50 }, () => generateApiKeyToken().token),
      )
      expect(tokens.size).toBe(50)
    })
  })

  describe('generateKeyId', () => {
    it('produces unique key_-prefixed ids', () => {
      const a = generateKeyId()
      expect(a.startsWith('key_')).toBe(true)
      const ids = new Set(Array.from({ length: 50 }, () => generateKeyId()))
      expect(ids.size).toBe(50)
    })
  })

  describe('hasScope', () => {
    it('checks membership', () => {
      expect(hasScope(['datasets:read', 'sites:read'], 'sites:read')).toBe(true)
      expect(hasScope(['datasets:read'], 'datasets:write')).toBe(false)
    })
  })

  describe('toPublicApiKey', () => {
    it('projects metadata to ISO strings and never leaks a hash', () => {
      const ts = (iso: string) =>
        ({ toDate: () => new Date(iso) }) as FirebaseFirestore.Timestamp
      const doc: ApiKeyDocument = {
        keyId: 'key_abc',
        orgId: 'org_1',
        name: 'CI key',
        keyPrefix: 'aglyn_sk_abcdef…',
        scopes: ['datasets:read'],
        createdBy: 'uid_1',
        createdAt: ts('2026-07-20T00:00:00.000Z'),
        lastUsedAt: null,
        revokedAt: null,
        expiresAt: ts('2027-01-01T00:00:00.000Z'),
      }
      const pub = toPublicApiKey(doc)
      expect(pub).toEqual({
        keyId: 'key_abc',
        name: 'CI key',
        keyPrefix: 'aglyn_sk_abcdef…',
        scopes: ['datasets:read'],
        createdAt: '2026-07-20T00:00:00.000Z',
        lastUsedAt: null,
        revokedAt: null,
        expiresAt: '2027-01-01T00:00:00.000Z',
      })
      expect(JSON.stringify(pub)).not.toContain('org_1')
      expect(Object.keys(pub)).not.toContain('createdBy')
    })
  })
})
