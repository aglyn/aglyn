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
  compareArtifactVersions,
  resolveUpdateState,
  updateStateLabel,
} from './marketplace-update-state'

describe('compareArtifactVersions (AGL-1016)', () => {
  it('orders integers numerically, not as strings', () => {
    expect(compareArtifactVersions(9, 10)).toBe(-1)
  })

  it('orders semver segment by segment', () => {
    expect(compareArtifactVersions('1.9.0', '1.10.0')).toBe(-1)
    expect(compareArtifactVersions('2.0.0', '1.99.99')).toBe(1)
  })

  it('treats missing trailing segments as zero', () => {
    expect(compareArtifactVersions('1.0', '1.0.0')).toBe(0)
  })

  it('refuses to order a prerelease rather than guessing', () => {
    expect(compareArtifactVersions('1.0.0-beta.1', '1.0.0')).toBeNull()
  })

  it('is null when either side is absent', () => {
    expect(compareArtifactVersions(null, '1.0.0')).toBeNull()
    expect(compareArtifactVersions('1.0.0', '')).toBeNull()
  })

  it('is zero for identical non-numeric strings', () => {
    expect(compareArtifactVersions('2026-01-01', '2026-01-01')).toBe(0)
  })
})

describe('resolveUpdateState (AGL-1016)', () => {
  const pin = {
    listingId: 'listing-1',
    pluginId: 'acme.widgets',
    version: '1.0.0',
    sha256: 'abc',
  }

  it('reports an update when the newest approved version is ahead of the pin', () => {
    expect(
      resolveUpdateState(pin, {
        artifactType: 'plugin',
        latestVersion: '1.2.0',
        latestApprovedVersion: '1.1.0',
      }),
    ).toEqual({
      state: 'update-available',
      installedVersion: '1.0.0',
      availableVersion: '1.1.0',
    })
  })

  it('never advertises an unreviewed plugin version', () => {
    // v1.2.0 is published but pending; the install route would refuse it, so
    // the badge must not offer it (AGL-966).
    const status = resolveUpdateState(pin, {
      artifactType: 'plugin',
      latestVersion: '1.2.0',
      latestApprovedVersion: '1.0.0',
    })
    expect(status.state).toBe('current')
    expect(status.availableVersion).toBe('1.0.0')
  })

  /**
   * The offer follows the kill switch (AGL-2368).
   *
   * `latestApprovedVersion` is a review verdict and revocation does not clear
   * it, so the badge offered "Update to vX" for bytes `install-plugin`
   * answers 409 to — the same leak AGL-1016 closed against `latestVersion`,
   * reopened one state over.
   */
  describe('and the kill switch (AGL-2368)', () => {
    const listing = {
      artifactType: 'plugin' as const,
      latestVersion: '1.2.0',
      latestApprovedVersion: '1.1.0',
    }

    it('CONTROL: still offers the update when nothing is revoked', () => {
      expect(
        resolveUpdateState(pin, listing, undefined, { versions: ['9.9.9'] })
          .state,
      ).toBe('update-available')
      expect(resolveUpdateState(pin, listing, undefined, null).state).toBe(
        'update-available',
      )
    })

    it('offers no update when the version it would offer is revoked', () => {
      const status = resolveUpdateState(pin, listing, undefined, {
        versions: ['1.1.0'],
      })
      expect(status.state).toBe('unknown')
      expect(status.unknownReason).toBe('nothing-published')
      expect(status.availableVersion).toBeNull()
    })

    it('offers no update under a listing-wide takedown', () => {
      expect(
        resolveUpdateState(pin, listing, undefined, { versions: 'all' }).state,
      ).toBe('unknown')
    })

    it('does not fall through to latestVersion when the offer is revoked', () => {
      // The failure that would look like a fix: dropping to `latestVersion`
      // advertises an UNREVIEWED version, which is exactly what AGL-1016
      // removed from this function.
      const status = resolveUpdateState(pin, listing, undefined, {
        versions: ['1.1.0'],
      })
      expect(status.availableVersion).not.toBe('1.2.0')
    })

    it('leaves COPIED artifacts alone — they have no kill switch', () => {
      // `versions` is a plugin document; a component compares against
      // `latestVersion` and must not be silenced by one.
      const status = resolveUpdateState(
        { listingId: 'listing-1', version: '1.0.0' },
        { artifactType: 'component', latestVersion: '1.1.0' },
        'component',
        { versions: 'all' },
      )
      expect(status.state).toBe('update-available')
      expect(status.availableVersion).toBe('1.1.0')
    })
  })

  it('is unknown for a plugin listing with nothing approved yet', () => {
    const status = resolveUpdateState(pin, {
      artifactType: 'plugin',
      latestVersion: '1.2.0',
    })
    expect(status.state).toBe('unknown')
    expect(status.unknownReason).toBe('nothing-published')
  })

  it('compares copied artifacts against latestVersion', () => {
    const status = resolveUpdateState(
      { installedFrom: { listingId: 'l', version: '2', sha256: 'h', artifactType: 'layout' } },
      { artifactType: 'layout', latestVersion: 3 },
    )
    expect(status).toEqual({
      state: 'update-available',
      installedVersion: '2',
      availableVersion: '3',
    })
  })

  it('reports `ahead` when the installed version outruns the offer', () => {
    const status = resolveUpdateState(
      { ...pin, version: '2.0.0' },
      { artifactType: 'plugin', latestApprovedVersion: '1.0.0' },
    )
    expect(status.state).toBe('ahead')
  })

  it('is unknown — not current — for an artifact with no provenance', () => {
    const status = resolveUpdateState({}, { latestVersion: 4 })
    expect(status.state).toBe('unknown')
    expect(status.unknownReason).toBe('no-provenance')
  })

  it('still compares a pre-AGL-1015 install, which knows its version', () => {
    const status = resolveUpdateState(
      { marketplace: { listingId: 'l', version: 1 } },
      { latestVersion: 2 },
      'component',
    )
    expect(status.state).toBe('update-available')
  })

  it('is unknown when the two versions cannot be ordered', () => {
    const status = resolveUpdateState(
      { ...pin, version: '1.0.0-rc.1' },
      { artifactType: 'plugin', latestApprovedVersion: '1.0.0' },
    )
    expect(status.state).toBe('unknown')
    expect(status.unknownReason).toBe('incomparable')
  })
})

describe('updateStateLabel (AGL-1016)', () => {
  it('names both versions when an update exists', () => {
    expect(
      updateStateLabel({
        state: 'update-available',
        installedVersion: '1.0.0',
        availableVersion: '1.1.0',
      }),
    ).toBe('You have v1.0.0 · v1.1.0 available')
  })

  it('says an unprovenanced artifact is unknown, not current', () => {
    expect(
      updateStateLabel({
        state: 'unknown',
        installedVersion: null,
        availableVersion: null,
        unknownReason: 'no-provenance',
      }),
    ).toBe('Installed before update tracking — version unknown')
  })
})
