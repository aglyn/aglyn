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
  attestationLabels,
  attestationsForBytes,
  missingAttestations,
  PUBLISHER_ATTESTATION,
  requiredAttestationIds,
} from './publisher-attestation'

describe('publisher attestation (AGL-969)', () => {
  const ALL = PUBLISHER_ATTESTATION.map((item) => item.id)
  const UPDATE_ONLY = PUBLISHER_ATTESTATION.filter(
    (item) => item.updateOnly,
  ).map((item) => item.id)

  it('asks a first submission everything except the update-only items', () => {
    const required = requiredAttestationIds(false)
    expect(UPDATE_ONLY.length).toBeGreaterThan(0)
    for (const id of UPDATE_ONLY) expect(required).not.toContain(id)
    expect(required).toHaveLength(ALL.length - UPDATE_ONLY.length)
  })

  it('asks an update everything', () => {
    expect(requiredAttestationIds(true)).toEqual(ALL)
  })

  it('reports what a submission is missing', () => {
    expect(missingAttestations([], false)).toEqual(requiredAttestationIds(false))
    expect(missingAttestations(ALL, true)).toEqual([])
    // The changelog item is what an update adds on top of a first publish.
    expect(missingAttestations(requiredAttestationIds(false), true)).toEqual(
      UPDATE_ONLY,
    )
  })

  it('treats absent input as nothing attested rather than everything', () => {
    expect(missingAttestations(null, false)).toEqual(
      requiredAttestationIds(false),
    )
    expect(missingAttestations(undefined, true)).toEqual(ALL)
  })

  it('ignores ids that are not attestation items', () => {
    expect(missingAttestations(['not-an-item'], false)).toEqual(
      requiredAttestationIds(false),
    )
  })

  it('turns ids into labels a publisher can act on', () => {
    expect(attestationLabels(['license'])).toEqual([
      PUBLISHER_ATTESTATION.find((item) => item.id === 'license')?.label,
    ])
    expect(attestationLabels(['nope'])).toEqual([])
  })

  describe('attestationsForBytes', () => {
    const stored = {
      license: { by: 'uid-1', sha256: 'aaa' },
      tested: { by: 'uid-1', sha256: 'aaa' },
      // Left over from an earlier build of the same version string.
      repository: { by: 'uid-1', sha256: 'bbb' },
    }

    it('counts only attestations made against these bytes', () => {
      expect(attestationsForBytes(stored, 'aaa').sort()).toEqual([
        'license',
        'tested',
      ])
    })

    it('a republish under the same version starts clean', () => {
      expect(attestationsForBytes(stored, 'ccc')).toEqual([])
    })

    it('never counts anything without a sha to compare against', () => {
      expect(attestationsForBytes(stored, '')).toEqual([])
      expect(attestationsForBytes(null, 'aaa')).toEqual([])
    })
  })
})
