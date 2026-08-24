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
 * Detaching a console name takes its upload origin back off the bucket
 * (AGL-1452).
 *
 * The attach half shipped in `6d8a848ef` and only ever GROWS the allowlist.
 * That direction alone is why the live bucket carried five origins for
 * `agl1514-smoke-*.aglyn.com` on 2026-08-24 — names a smoke run attached, whose
 * permission outlived whatever the run was for.
 *
 * For an `*.aglyn.com` subdomain that is untidy. For a WHITE-LABEL console
 * domain (AGL-1378, shipped 2026-08-24) it is a standing permission to complete
 * a signed `PUT`, held by a host the customer keeps and we no longer serve —
 * and the signed URL carries its own authorization, so that host can spend one
 * that leaks.
 */

import type { CorsRule } from '@aglyn/aglyn/server'

import { releaseUploadCors, type BucketCorsIO } from './upload-cors-reconcile'

const EXISTING: CorsRule[] = [
  {
    origin: [
      'https://app.aglyn.com',
      'https://acme.example',
      'https://zgover.aglyn.com',
    ],
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
    read: async () => ({
      rules: EXISTING.map((rule) => ({ ...rule, origin: [...(rule.origin ?? [])] })),
      metageneration: '11',
    }),
    write: async (rules) => {
      written.push(rules)
    },
    ...overrides,
  } as BucketCorsIO & { written: CorsRule[][] }
}

const originsIn = (rules: CorsRule[]) => rules.flatMap((rule) => rule.origin ?? [])

describe('releaseUploadCors', () => {
  it('removes the detached origin and NOTHING else', async () => {
    const bucket = io()
    const release = await releaseUploadCors('acme.example', bucket)

    expect(release).toEqual({ origin: 'https://acme.example', revoked: true, detail: null })
    expect(bucket.written).toHaveLength(1)
    // The assertion that fails the moment a revoke becomes a rewrite: every
    // other customer's origin, and the platform's, must survive.
    expect(originsIn(bucket.written[0])).toEqual([
      'https://app.aglyn.com',
      'https://zgover.aglyn.com',
    ])
  })

  it('writes CONDITIONAL on the metageneration it read', async () => {
    const seen: string[] = []
    const bucket = io({
      write: async (_rules, metageneration) => {
        seen.push(metageneration)
      },
    })
    await releaseUploadCors('acme.example', bucket)
    // Two detaches racing would otherwise clobber each other, and the loser's
    // customer is the one whose uploads silently break.
    expect(seen).toEqual(['11'])
  })

  it('REFUSES the platform origin, and writes nothing', async () => {
    const bucket = io()
    const release = await releaseUploadCors('app.aglyn.com', bucket)

    expect(release).toEqual({
      origin: 'https://app.aglyn.com',
      revoked: false,
      detail: 'platform-origin',
    })
    // Removing it would break large uploads for every customer at once.
    expect(bucket.written).toHaveLength(0)
  })

  it('treats an origin that is already gone as done, not as a failure', async () => {
    const bucket = io()
    const release = await releaseUploadCors('never-attached.example', bucket)

    expect(release).toEqual({
      origin: 'https://never-attached.example',
      revoked: true,
      detail: null,
    })
    // A detach that runs twice must not read as a permission that would not go.
    expect(bucket.written).toHaveLength(0)
  })

  it('reports a failed read rather than assuming the bucket is empty', async () => {
    const bucket = io({ read: async () => null })
    const release = await releaseUploadCors('acme.example', bucket)

    expect(release).toEqual({
      origin: 'https://acme.example',
      revoked: false,
      detail: 'read-failed',
    })
    expect(bucket.written).toHaveLength(0)
  })

  it('reports a failed write instead of throwing at the detach', async () => {
    const bucket = io({
      write: async () => {
        throw new Error('403 storage.buckets.update')
      },
    })
    const release = await releaseUploadCors('acme.example', bucket)

    // A domain must not fail to detach because a storage API refused, but the
    // operator must be able to see the permission outlived the customer.
    expect(release).toEqual({
      origin: 'https://acme.example',
      revoked: false,
      detail: 'write-failed',
    })
  })

  it('is a no-op with no bucket configured — a self-host install has none', async () => {
    expect(await releaseUploadCors('acme.example', null)).toBeNull()
  })

  it('is a no-op for something that is not a hostname', async () => {
    expect(await releaseUploadCors('*', io())).toBeNull()
    expect(await releaseUploadCors('', io())).toBeNull()
  })

  it('leaves a non-upload rule on the bucket alone', async () => {
    const bucket = io({
      read: async () => ({
        rules: [
          { origin: ['https://acme.example'], method: ['GET'] },
          ...EXISTING.map((rule) => ({ ...rule, origin: [...(rule.origin ?? [])] })),
        ],
        metageneration: '11',
      }),
    })
    await releaseUploadCors('acme.example', bucket)
    // Only the rule governing the signed PUT is ours to edit.
    expect(bucket.written[0][0]).toEqual({
      origin: ['https://acme.example'],
      method: ['GET'],
    })
  })
})
