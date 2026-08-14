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
  isReleaseFlagOn,
  isReleaseFlagOnForOrg,
  parseOrgReleaseFlagOverrides,
  releaseFlagBucket,
  RELEASE_FLAGS,
  type ReleaseFlagKey,
} from './release-flags'

/**
 * Per-org release-flag overrides (AGL-1635).
 *
 * The reported symptom was that the admin bar (`release_edit_bar`) had no
 * per-org override. The cause was broader: no release flag had one, because
 * the only levers were a global flip and a percentage rollout that picks its
 * members by hash. These cover the override layer that closes that.
 */
describe('per-org release flag overrides (AGL-1635)', () => {
  describe('parseOrgReleaseFlagOverrides', () => {
    it('keeps booleans on known flag keys', () => {
      expect(
        parseOrgReleaseFlagOverrides({
          release_edit_bar: true,
          release_contacts: false,
        }),
      ).toEqual({ release_edit_bar: true, release_contacts: false })
    })

    it('drops keys the registry does not declare', () => {
      // A retired flag key outlives its registry entry in Firestore. It must
      // never gate anything — a stale grant for a flag that no longer exists
      // is a grant nobody can see or revoke from the dialog.
      expect(
        parseOrgReleaseFlagOverrides({
          release_edit_bar: true,
          release_retired_thing: true,
          notAFlag: false,
        }),
      ).toEqual({ release_edit_bar: true })
    })

    it('drops non-boolean values rather than coercing them', () => {
      // Coercion is the dangerous direction: `'false'` is truthy, so a
      // string written by hand in the Firebase console would turn a
      // forced-OFF into a forced-ON.
      expect(
        parseOrgReleaseFlagOverrides({
          release_edit_bar: 'false',
          release_contacts: 1,
          release_email: null,
          release_inbox: true,
        }),
      ).toEqual({ release_inbox: true })
    })

    it('treats absent, null and non-object values as no override', () => {
      expect(parseOrgReleaseFlagOverrides(undefined)).toEqual({})
      expect(parseOrgReleaseFlagOverrides(null)).toEqual({})
      expect(parseOrgReleaseFlagOverrides('release_edit_bar')).toEqual({})
      expect(parseOrgReleaseFlagOverrides(42)).toEqual({})
      // An array has string keys too; it must not be walked as a map.
      expect(parseOrgReleaseFlagOverrides(['release_edit_bar'])).toEqual({})
    })
  })

  describe('isReleaseFlagOnForOrg', () => {
    const off = { enabled: false }
    const on = { enabled: true }

    it('grants a globally-off flag to one org — the reported case', () => {
      // `release_edit_bar` ships dark. Before this, the only way to give one
      // customer the admin bar was to turn it on for everybody.
      expect(
        isReleaseFlagOnForOrg('release_edit_bar', off, 'org_a', {
          release_edit_bar: true,
        }),
      ).toBe(true)
      // and it stays off for everyone else
      expect(isReleaseFlagOnForOrg('release_edit_bar', off, 'org_b', {})).toBe(
        false,
      )
    })

    it('revokes a globally-on flag for one org', () => {
      // The per-org KILL switch is half the point: a customer hitting a bug
      // in a released feature can be taken off it without a global rollback.
      expect(
        isReleaseFlagOnForOrg('release_bookings', on, 'org_a', {
          release_bookings: false,
        }),
      ).toBe(false)
    })

    it('beats a rollout bucket in both directions', () => {
      // Find a subject the hash puts INSIDE a 50% rollout, and one outside,
      // so neither assertion depends on a lucky literal.
      const key: ReleaseFlagKey = 'release_marketing'
      const inside = ['org_1', 'org_2', 'org_3', 'org_4', 'org_5'].find(
        (id) => releaseFlagBucket(key, id) < 50,
      )
      const outside = ['org_1', 'org_2', 'org_3', 'org_4', 'org_5'].find(
        (id) => releaseFlagBucket(key, id) >= 50,
      )
      expect(inside).toBeDefined()
      expect(outside).toBeDefined()
      const rollout = { enabled: false, rolloutPercent: 50 }

      // Sanity: the bucket really does decide without an override.
      expect(isReleaseFlagOn(key, rollout, inside)).toBe(true)
      expect(isReleaseFlagOn(key, rollout, outside)).toBe(false)

      // An override wins over the bucket either way.
      expect(
        isReleaseFlagOnForOrg(key, rollout, inside, { [key]: false }),
      ).toBe(false)
      expect(
        isReleaseFlagOnForOrg(key, rollout, outside, { [key]: true }),
      ).toBe(true)
    })

    it('inherits when the flag has no override entry', () => {
      const rollout = { enabled: false, rolloutPercent: 100 }
      // An override for a DIFFERENT flag must not leak across.
      expect(
        isReleaseFlagOnForOrg('release_email', rollout, 'org_a', {
          release_edit_bar: false,
        }),
      ).toBe(true)
      expect(isReleaseFlagOnForOrg('release_email', off, 'org_a', {})).toBe(
        false,
      )
    })

    it('matches isReleaseFlagOn exactly when there is no override', () => {
      // The override layer must be a pure addition: with no overrides set,
      // every flag and subject resolves as it did before AGL-1635.
      const values = [
        { enabled: true },
        { enabled: false },
        { enabled: false, rolloutPercent: 30 },
        { enabled: false, rolloutPercent: 100 },
      ]
      for (const definition of RELEASE_FLAGS) {
        for (const value of values) {
          for (const subject of ['org_a', 'org_b', 'uid_c', null]) {
            expect(
              isReleaseFlagOnForOrg(definition.key, value, subject, {}),
            ).toBe(isReleaseFlagOn(definition.key, value, subject))
            expect(
              isReleaseFlagOnForOrg(definition.key, value, subject, null),
            ).toBe(isReleaseFlagOn(definition.key, value, subject))
          }
        }
      }
    })

    it('applies an override even with no subject id', () => {
      // A percentage rollout needs a subject and returns false without one.
      // An override is a decision about a named org, so it must not need the
      // subject to be threaded through as well.
      expect(
        isReleaseFlagOnForOrg('release_edit_bar', off, null, {
          release_edit_bar: true,
        }),
      ).toBe(true)
    })

    it('covers every registered flag — none is excluded by construction', () => {
      // The AGL-549 lesson: the gap was never "someone forgot one flag", it
      // was a surface that could silently omit flags. Assert the whole
      // registry is overridable so a flag added later is covered too.
      for (const definition of RELEASE_FLAGS) {
        expect(
          isReleaseFlagOnForOrg(definition.key, { enabled: false }, 'org_a', {
            [definition.key]: true,
          }),
        ).toBe(true)
        expect(
          isReleaseFlagOnForOrg(definition.key, { enabled: true }, 'org_a', {
            [definition.key]: false,
          }),
        ).toBe(false)
      }
    })
  })
})
