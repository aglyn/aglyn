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
 * AGL-1497. A clickwrap record is only worth having if it can answer, years
 * later, "what did this person see on the day they agreed?". The properties
 * that matter are therefore not "did a boolean flip" but:
 *
 *   - the VERSION and the exact document URLs presented are on the record;
 *   - the timestamp is the SERVER's, not a claim the client made;
 *   - a re-post can never rewrite the first acceptance (ToS §18.5 runs the
 *     arbitration opt-out window from FIRST acceptance, so that timestamp is
 *     load-bearing and must be immutable);
 *   - each version is its own document, so a later re-acceptance ADDS to the
 *     history instead of replacing it.
 */

import { recordLegalAcceptance } from './legal-acceptance'

const SERVER_TIMESTAMP = { __sentinel: 'serverTimestamp' }

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => SERVER_TIMESTAMP },
}))

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => undefined }) },
}))

/**
 * Records the sub-path each write landed on, because "which document did it
 * write" is half the contract here — a single mutable `users/{uid}` field
 * would pass any assertion about content while destroying the history.
 */
function fakeFirestore(existing?: Record<string, Record<string, unknown>>) {
  const docs: Record<string, Record<string, unknown>> = { ...(existing ?? {}) }
  const paths: string[] = []
  const make = (prefix: string) => ({
    collection: (name: string) => ({
      doc: (id: string) => {
        const path = `${prefix}${name}/${id}`
        return {
          ...make(`${path}/`),
          get: async () => ({
            exists: docs[path] !== undefined,
            get: (field: string) => docs[path]?.[field],
          }),
          set: async (data: Record<string, unknown>) => {
            paths.push(path)
            docs[path] = { ...(docs[path] ?? {}), ...data }
          },
        }
      },
    }),
  })
  return { ...make(''), docs, paths }
}

const DOCUMENTS = [
  { key: 'terms', url: 'https://aglyn.com/legal/terms', sha256: 'a'.repeat(64), bytes: 32119 },
  { key: 'privacy', url: 'https://aglyn.com/legal/privacy', sha256: 'b'.repeat(64), bytes: 9543 },
]

describe('recordLegalAcceptance', () => {
  it('captures the version and the documents that were presented', async () => {
    const firestore = fakeFirestore()
    const result = await recordLegalAcceptance('uid-1', {
      version: 'v1',
      documents: DOCUMENTS,
      context: 'signup-password',
      firestore,
    })

    expect(result).toEqual({ recorded: true, version: 'v1' })
    // One document PER VERSION under the user — not a field on the user doc.
    expect(firestore.paths).toEqual(['users/uid-1/legalAcceptances/v1'])
    const record = firestore.docs['users/uid-1/legalAcceptances/v1']
    expect(record).toMatchObject({
      version: 'v1',
      method: 'clickwrap',
      context: 'signup-password',
      documents: DOCUMENTS,
    })
  })

  it('pins the CONTENT, not just a mutable link', async () => {
    // A record naming only a URL proves nothing: the page can be edited after
    // the fact and the record would still "match". The hash is what makes the
    // acceptance self-contained evidence of what was actually agreed to.
    const firestore = fakeFirestore()
    await recordLegalAcceptance('uid-1', {
      version: 'v1',
      documents: DOCUMENTS,
      context: 'signup-password',
      firestore,
    })
    const documents = firestore.docs['users/uid-1/legalAcceptances/v1'][
      'documents'
    ] as Array<{ sha256?: string; bytes?: number }>
    expect(documents).toHaveLength(2)
    for (const doc of documents) {
      expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(typeof doc.bytes).toBe('number')
    }
  })

  it('stamps the SERVER clock, never a client-supplied time', async () => {
    const firestore = fakeFirestore()
    await recordLegalAcceptance('uid-1', {
      version: 'v1',
      documents: DOCUMENTS,
      context: 'signup-google',
      firestore,
    })
    expect(
      firestore.docs['users/uid-1/legalAcceptances/v1']['acceptedAt'],
    ).toBe(SERVER_TIMESTAMP)
  })

  it('keeps the evidence the request carried', async () => {
    const firestore = fakeFirestore()
    await recordLegalAcceptance('uid-1', {
      version: 'v1',
      documents: DOCUMENTS,
      context: 'signup-password',
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (Macintosh)',
      firestore,
    })
    expect(firestore.docs['users/uid-1/legalAcceptances/v1']).toMatchObject({
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (Macintosh)',
    })
  })

  it('never rewrites an acceptance that already exists (first wins)', async () => {
    const firestore = fakeFirestore({
      'users/uid-1/legalAcceptances/v1': {
        version: 'v1',
        acceptedAt: 'the-original-moment',
        context: 'signup-password',
      },
    })
    const result = await recordLegalAcceptance('uid-1', {
      version: 'v1',
      documents: DOCUMENTS,
      context: 'signup-google',
      firestore,
    })

    expect(result).toEqual({ recorded: false, version: 'v1' })
    // No write at all — the opt-out clock must not be restartable.
    expect(firestore.paths).toEqual([])
    expect(
      firestore.docs['users/uid-1/legalAcceptances/v1']['acceptedAt'],
    ).toBe('the-original-moment')
  })

  it('adds a new version alongside the old one rather than replacing it', async () => {
    const firestore = fakeFirestore({
      'users/uid-1/legalAcceptances/v1': { version: 'v1' },
    })
    await recordLegalAcceptance('uid-1', {
      version: 'v2',
      documents: DOCUMENTS,
      context: 'reconsent',
      firestore,
    })
    expect(firestore.docs['users/uid-1/legalAcceptances/v1']).toBeDefined()
    expect(firestore.docs['users/uid-1/legalAcceptances/v2']).toBeDefined()
  })

  it('refuses to record without a uid or a version', async () => {
    const firestore = fakeFirestore()
    await expect(
      recordLegalAcceptance('', {
        version: 'v1',
        documents: DOCUMENTS,
        context: 'signup-password',
        firestore,
      }),
    ).rejects.toThrow()
    await expect(
      recordLegalAcceptance('uid-1', {
        version: '',
        documents: DOCUMENTS,
        context: 'signup-password',
        firestore,
      }),
    ).rejects.toThrow()
    expect(firestore.paths).toEqual([])
  })
})
