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

import {
  ASSIST_ANSWER_CACHE_LIMIT,
  ASSIST_ANSWER_CACHE_TTL_MS,
  assistAnswerCacheKey,
  assistCacheEntryIsFresh,
  normaliseAssistQuestion,
  readAssistAnswerCache,
  writeAssistAnswerCache,
} from './assist-answer-cache'

/**
 * The assist answer cache (AGL-2486).
 *
 * Two properties carry all the risk and both are asserted directly rather than
 * through the route: a key that collapses a difference it must not collapse
 * serves the WRONG answer, and a document that never prunes grows until it
 * hits Firestore's 1MB limit and then fails every write silently from the
 * caller's point of view.
 */

const ORG = 'org-1'
const DOC = `orgs/${ORG}/counters/assistAnswerCache`

let docs: Map<string, Record<string, unknown>>

/**
 * A Firestore double that models the two behaviours this module depends on:
 * `set` WITHOUT merge replaces the document (which is what makes pruning
 * prune), and `snapshot.data()` returns undefined for a document that does not
 * exist. A double that merged everything would report the pruning test green
 * while the real thing kept every entry forever.
 */
function makeFirestore(): FirebaseFirestore.Firestore {
  const makeDoc = (path: string) => ({
    get: async () => ({
      exists: docs.has(path),
      data: () => docs.get(path),
      get: (field: string) => (docs.get(path) ?? {})[field],
    }),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...data } : data)
    },
  })
  return {
    collection: (name: string) => ({
      doc: (id: string) => ({
        ...makeDoc(`${name}/${id}`),
        collection: (sub: string) => ({
          doc: (subId: string) => makeDoc(`${name}/${id}/${sub}/${subId}`),
        }),
      }),
    }),
  } as unknown as FirebaseFirestore.Firestore
}

const INPUTS = {
  question: 'How do I connect a custom domain?',
  tier: 'free',
  route: '/acme/hosts',
  model: 'claude-sonnet-5',
  productName: 'Aglyn',
}

beforeEach(() => {
  docs = new Map()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('normalisation collapses only what cannot change the answer', () => {
  it('ignores case, padding, repeated spaces and trailing punctuation', () => {
    const canonical = normaliseAssistQuestion('how do i connect a custom domain')
    expect(normaliseAssistQuestion('How do I connect a custom domain?')).toBe(canonical)
    expect(normaliseAssistQuestion('  HOW DO I   connect a custom domain!! ')).toBe(
      canonical,
    )
  })

  it('GUARD: it does NOT collapse a word that reverses the question', () => {
    // The temptation is stemming or stop-word removal, which would make these
    // one key. Serving the "off" answer to the "on" question is not a missed
    // saving, it is a wrong answer with our name on it.
    expect(normaliseAssistQuestion('how do I turn on maintenance mode')).not.toBe(
      normaliseAssistQuestion('how do I turn off maintenance mode'),
    )
  })
})

describe('the key carries every input that changes the answer', () => {
  it('is stable for identical inputs', () => {
    expect(assistAnswerCacheKey(INPUTS)).toBe(assistAnswerCacheKey({ ...INPUTS }))
  })

  it.each([
    ['question', { question: 'How do I add a redirect?' }],
    ['tier', { tier: 'entitled' }],
    ['route', { route: '/acme/billing' }],
    ['model', { model: 'claude-haiku-4-5' }],
    ['productName', { productName: 'Northwind' }],
  ])('changes with %s', (_label, override) => {
    expect(assistAnswerCacheKey({ ...INPUTS, ...override })).not.toBe(
      assistAnswerCacheKey(INPUTS),
    )
  })

  it('GUARD: no two different inputs concatenate into the same key', () => {
    // The classic hashed-composite defect — `a|b` and `ab|` hashing alike.
    // Here the route is part of the key and a route can contain a space, so
    // this is reachable rather than theoretical.
    expect(
      assistAnswerCacheKey({ ...INPUTS, question: 'a b', route: 'c' }),
    ).not.toBe(assistAnswerCacheKey({ ...INPUTS, question: 'a', route: 'b c' }))
  })
})

describe('freshness', () => {
  it('serves an entry inside the window and drops one past it', () => {
    const now = 1_000_000_000_000
    const entry = { answer: 'text', docs: [], at: now }
    expect(assistCacheEntryIsFresh(entry, now + 1000)).toBe(true)
    expect(assistCacheEntryIsFresh(entry, now + ASSIST_ANSWER_CACHE_TTL_MS)).toBe(false)
  })

  it('an entry that cannot say WHEN it was written is not fresh', () => {
    // `strictNullChecks` is off repo-wide, so a missing `at` arrives as NaN
    // rather than tripping a null check — and every NaN comparison is false,
    // which must land on "not fresh" rather than "no expiry".
    expect(assistCacheEntryIsFresh({ answer: 'text', docs: [] } as never)).toBe(false)
    expect(assistCacheEntryIsFresh(null)).toBe(false)
    expect(assistCacheEntryIsFresh({ answer: '', docs: [], at: Date.now() })).toBe(false)
  })
})

describe('read and write', () => {
  it('round-trips an answer', async () => {
    const firestore = makeFirestore()
    const key = assistAnswerCacheKey(INPUTS)
    expect(await readAssistAnswerCache(firestore, ORG, key)).toBeNull()
    await writeAssistAnswerCache(firestore, ORG, key, {
      answer: 'Open Settings → Domains.',
      docs: [{ title: 'Domains', url: 'https://docs.aglyn.com/x' }],
    })
    const hit = await readAssistAnswerCache(firestore, ORG, key)
    expect(hit?.answer).toBe('Open Settings → Domains.')
    expect(hit?.docs).toEqual([{ title: 'Domains', url: 'https://docs.aglyn.com/x' }])
  })

  it('a stale entry reads as a MISS even though it is still stored', async () => {
    const firestore = makeFirestore()
    const key = assistAnswerCacheKey(INPUTS)
    const longAgo = Date.now() - ASSIST_ANSWER_CACHE_TTL_MS - 1000
    docs.set(DOC, { [key]: { answer: 'stale', docs: [], at: longAgo } })
    expect(await readAssistAnswerCache(firestore, ORG, key)).toBeNull()
  })

  it('PRUNES to the cap, keeping the newest', async () => {
    const firestore = makeFirestore()
    const base = Date.now()
    const overflow = ASSIST_ANSWER_CACHE_LIMIT + 15
    for (let index = 0; index < overflow; index += 1) {
      await writeAssistAnswerCache(
        firestore,
        ORG,
        `key-${index}`,
        { answer: `answer ${index}`, docs: [] },
        base + index,
      )
    }
    const stored = docs.get(DOC) as Record<string, { answer: string }>
    expect(Object.keys(stored)).toHaveLength(ASSIST_ANSWER_CACHE_LIMIT)
    // Newest kept, oldest gone — not an arbitrary subset.
    expect(stored[`key-${overflow - 1}`]).toBeDefined()
    expect(stored['key-0']).toBeUndefined()
  })

  it('an unavailable cache costs a model call, never the answer', async () => {
    const broken = {
      collection: () => {
        throw new Error('firestore down')
      },
    } as unknown as FirebaseFirestore.Firestore
    // A miss, not a throw: the caller cannot tell an outage from a miss, and
    // both correctly mean "call the model".
    await expect(readAssistAnswerCache(broken, ORG, 'k')).resolves.toBeNull()
    await expect(
      writeAssistAnswerCache(broken, ORG, 'k', { answer: 'a', docs: [] }),
    ).resolves.toBeUndefined()
  })
})
