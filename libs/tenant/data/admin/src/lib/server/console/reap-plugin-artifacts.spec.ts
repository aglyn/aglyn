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
  ArtifactObject,
  artifactClaimKey,
  planArtifactReap,
} from './reap-plugin-artifacts'

const NOW = new Date('2026-07-27T00:00:00.000Z')
const OLD = new Date('2026-01-01T00:00:00.000Z')
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

const object = (
  name: string,
  createdAt: Date = OLD,
  size = 1000,
): ArtifactObject => ({ name, createdAt, size })

const plan = (
  objects: ArtifactObject[],
  claimed: string[] = [],
  liveListings: string[] = ['listing1'],
  overrides: Partial<{ minAgeDays: number; maxDeletes: number }> = {},
) =>
  planArtifactReap(
    objects,
    new Set(claimed),
    new Set(liveListings),
    { minAgeDays: 7, maxDeletes: 200, now: NOW, ...overrides },
  )

describe('planArtifactReap', () => {
  it('keeps an object a version doc claims', () => {
    const result = plan(
      [object(`artifacts/listing1/1.0.0/${SHA_A}.bundle`)],
      [artifactClaimKey('listing1', '1.0.0', SHA_A)],
    )
    expect(result.kept).toBe(1)
    expect(result.toDelete).toEqual([])
  })

  it('reaps the superseded object when a version is republished', () => {
    // Same version string, new bytes: the version doc now claims SHA_B and
    // nothing can ever ask for SHA_A again.
    const result = plan(
      [
        object(`artifacts/listing1/1.0.0/${SHA_A}.bundle`),
        object(`artifacts/listing1/1.0.0/${SHA_B}.bundle`),
      ],
      [artifactClaimKey('listing1', '1.0.0', SHA_B)],
    )
    expect(result.toDelete).toEqual([`artifacts/listing1/1.0.0/${SHA_A}.bundle`])
    expect(result.kept).toBe(1)
    expect(result.bytesToFree).toBe(1000)
  })

  it('keeps an old version nothing currently installs', () => {
    // `install-plugin` accepts a requestedVersion, so any version doc is
    // installable — install counts must not enter the decision.
    const result = plan(
      [
        object(`artifacts/listing1/1.0.0/${SHA_A}.bundle`),
        object(`artifacts/listing1/2.0.0/${SHA_B}.bundle`),
      ],
      [
        artifactClaimKey('listing1', '1.0.0', SHA_A),
        artifactClaimKey('listing1', '2.0.0', SHA_B),
      ],
    )
    expect(result.toDelete).toEqual([])
    expect(result.kept).toBe(2)
  })

  it('never reaps an unclaimed object inside the min-age window', () => {
    const fresh = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000)
    const result = plan([
      object(`artifacts/listing1/1.0.0/${SHA_A}.bundle`, fresh),
    ])
    expect(result.tooNew).toBe(1)
    expect(result.toDelete).toEqual([])
  })

  it('reports but never reaps an object whose listing doc is gone', () => {
    const result = plan(
      [object(`artifacts/ghost/1.0.0/${SHA_A}.bundle`)],
      [artifactClaimKey('ghost', '1.0.0', SHA_A)],
      [],
    )
    expect(result.orphanedListings).toEqual([
      `artifacts/ghost/1.0.0/${SHA_A}.bundle`,
    ])
    expect(result.toDelete).toEqual([])
    expect(result.kept).toBe(0)
  })

  it('reports but never reaps a non-canonical path', () => {
    const result = plan([object('artifacts/listing1/1.0.0/notasha.bundle')])
    expect(result.unrecognized).toEqual([
      'artifacts/listing1/1.0.0/notasha.bundle',
    ])
    expect(result.toDelete).toEqual([])
  })

  it('caps deletions per run and defers the rest', () => {
    const objects = Array.from({ length: 5 }, (_, index) =>
      object(`artifacts/listing1/1.0.${index}/${SHA_A}.bundle`),
    )
    const result = plan(objects, [], ['listing1'], { maxDeletes: 2 })
    expect(result.toDelete).toHaveLength(2)
    expect(result.deferredByCap).toBe(3)
    expect(result.bytesToFree).toBe(2000)
  })
})
