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
 * Attaching a serving console name reconciles the bucket's upload CORS
 * (AGL-1452).
 *
 * The gap this closes is a human one: GCS matches origins exactly, so every
 * name the console is SERVED on needs its own entry, and nothing anywhere
 * reminded anyone of that. Measured on the live bucket 2026-08-20 — five
 * workspace subdomains served the console at that moment and not one of them
 * could complete a large upload.
 *
 * The two properties that matter are (1) the write MERGES, because
 * `--cors-file` replaces and a fresh document drops every other customer, and
 * (2) nothing here throws or blocks the attach, because a domain must not fail
 * to attach over a storage API.
 */

import type { CorsRule } from '@aglyn/aglyn/server'

import {
  reconcileUploadCors,
  type BucketCorsIO,
} from './upload-cors-reconcile'

const EXISTING: CorsRule[] = [
  {
    origin: ['https://app.aglyn.com'],
    method: ['PUT'],
    responseHeader: ['Content-Type', 'x-goog-resumable'],
    maxAgeSeconds: 3600,
  },
]

function io(overrides: Partial<BucketCorsIO> = {}): BucketCorsIO & {
  written: CorsRule[][]
} {
  const written: CorsRule[][] = []
  return {
    written,
    bucket: 'aglyn-main.appspot.com',
    read: async () => ({ rules: EXISTING.map((r) => ({ ...r })), metageneration: '7' }),
    write: async (rules) => {
      written.push(rules)
    },
    ...overrides,
  } as BucketCorsIO & { written: CorsRule[][] }
}

describe('reconcileUploadCors', () => {
  let errors: jest.SpyInstance

  beforeEach(() => {
    errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => errors.mockRestore())

  it('does nothing when the origin is already permitted', async () => {
    const target = io()
    const verdict = await reconcileUploadCors('app.aglyn.com', target)
    expect(verdict).toEqual({
      origin: 'https://app.aglyn.com',
      permitted: true,
      added: [],
      remedy: null,
      detail: null,
    })
    expect(target.written).toEqual([])
  })

  it('adds a missing origin and keeps every origin already there', async () => {
    // The `--cors-file` foot-gun, asserted on the document we actually write.
    const target = io()
    const verdict = await reconcileUploadCors('acme.example.com', target)
    expect(verdict?.permitted).toBe(true)
    expect(verdict?.added).toEqual(['https://acme.example.com'])
    expect(target.written).toHaveLength(1)
    expect(target.written[0][0].origin).toEqual([
      'https://app.aglyn.com',
      'https://acme.example.com',
    ])
  })

  it('writes against the metageneration it read', async () => {
    // Two attaches racing would otherwise clobber each other, which is the
    // read-modify-write foot-gun wearing a different hat.
    const seen: string[] = []
    const target = io({
      write: async (_rules, metageneration) => {
        seen.push(metageneration)
      },
    })
    await reconcileUploadCors('acme.example.com', target)
    expect(seen).toEqual(['7'])
  })

  it('says so, loudly and with the command, when the write is refused', async () => {
    // The realistic production failure: the runtime service account has no
    // storage.buckets.update. Silence here would put us back where AGL-1452
    // started, with the symptom surfacing days later as a failed upload.
    const target = io({
      write: async () => {
        throw new Error('403 does not have storage.buckets.update access')
      },
    })
    const verdict = await reconcileUploadCors('acme.example.com', target)
    expect(verdict?.permitted).toBe(false)
    expect(verdict?.detail).toBe('write-failed')
    expect(verdict?.remedy).toContain('https://acme.example.com')
    expect(verdict?.remedy).toContain('aglyn-main.appspot.com')
    expect(errors).toHaveBeenCalled()
  })

  it('reports NOT permitted when the policy cannot be read', async () => {
    const target = io({ read: async () => null })
    const verdict = await reconcileUploadCors('acme.example.com', target)
    expect(verdict?.permitted).toBe(false)
    expect(verdict?.detail).toBe('read-failed')
    expect(verdict?.remedy).toContain('https://acme.example.com')
  })

  it('never throws, whatever the storage layer does', async () => {
    const target = io({
      read: async () => {
        throw new Error('network')
      },
    })
    await expect(reconcileUploadCors('acme.example.com', target)).resolves.toEqual(
      expect.objectContaining({ permitted: false }),
    )
  })

  it('has nothing to say without a bucket', async () => {
    // A self-host install that has not configured storage yet. Reporting a
    // CORS failure there would be noise about a feature they are not using.
    expect(await reconcileUploadCors('acme.example.com', null)).toBeNull()
  })

  it('has nothing to say about something that is not a hostname', async () => {
    expect(await reconcileUploadCors('', io())).toBeNull()
    expect(await reconcileUploadCors('*', io())).toBeNull()
  })
})
