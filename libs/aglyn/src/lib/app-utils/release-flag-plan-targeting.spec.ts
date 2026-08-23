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

import { PLAN_LABELS, SELF_SERVE_PLANS } from './plan-entitlements'
import {
  isReleaseFlagOn,
  isReleaseFlagOnForOrg,
  parseReleaseFlagPlans,
  parseReleaseFlagValue,
  releaseFlagBucket,
  releaseFlagPlansAtOrAbove,
  releaseFlagTargetsPlan,
  RELEASE_FLAGS,
  RELEASE_FLAG_PLAN_LADDER,
  type ReleaseFlagKey,
  type ReleaseFlagValue,
} from './release-flags'
import type { OrgPlan } from '../foundation'

/**
 * Plan/tier targeting for release flags (AGL-2486).
 *
 * A percentage was the only lever, so a rollout could not be aimed at the
 * customers a feature was actually built for. These cover the new axis and,
 * at least as importantly, that adding it changed NOTHING for the flags
 * already published without it.
 */

const KEY: ReleaseFlagKey = 'release_contacts'

/** Enough org ids to have subjects on both sides of any percentage. */
const subjects = Array.from({ length: 400 }, (_, index) => `org_${index}`)

const inBucketUnder = (percent: number): string[] =>
  subjects.filter((subject) => releaseFlagBucket(KEY, subject) < percent)

describe('release flag plan targeting (AGL-2486)', () => {
  describe('parseReleaseFlagPlans', () => {
    it('returns undefined for a flag that declares no targeting', () => {
      // The whole backward-compatibility story rests on this being
      // `undefined` and not `[]`: the evaluator reads absence as EVERY tier,
      // and a parser that manufactured an empty list would still evaluate
      // the same only because the evaluator also special-cases empty. Two
      // spellings of "unset" is how one of them eventually gets read as
      // "none".
      expect(parseReleaseFlagPlans(undefined)).toBeUndefined()
      expect(parseReleaseFlagPlans(null)).toBeUndefined()
      expect(parseReleaseFlagPlans('pro')).toBeUndefined()
      expect(parseReleaseFlagPlans({ pro: true })).toBeUndefined()
    })

    it('keeps known tiers, in ladder order, regardless of stored order', () => {
      expect(parseReleaseFlagPlans(['enterprise', 'pro', 'agency'])).toEqual([
        'pro',
        'agency',
        'enterprise',
      ])
    })

    it('de-duplicates', () => {
      expect(parseReleaseFlagPlans(['pro', 'pro', 'pro'])).toEqual(['pro'])
    })

    it('drops tier names the plan model does not declare', () => {
      // Same discipline as `parseOrgReleaseFlagOverrides`: a renamed or
      // retired tier must not gate anything.
      expect(parseReleaseFlagPlans(['pro', 'platinum', 42, null])).toEqual([
        'pro',
      ])
    })

    it('collapses an all-unknown list to undefined, not to an empty list', () => {
      // A typo has to INHERIT (every tier), the conservative direction for a
      // staff mistake, rather than resolve to a list that means something
      // else. Both spellings happen to evaluate the same today; this pins
      // which one is produced so they cannot drift apart.
      expect(parseReleaseFlagPlans(['platinum', 'gold'])).toBeUndefined()
    })
  })

  describe('releaseFlagPlansAtOrAbove', () => {
    it('expands to the tier and everything above it on the ladder', () => {
      expect(releaseFlagPlansAtOrAbove('pro')).toEqual([
        'pro',
        'business',
        'scale',
        'advanced',
        'agency',
        'enterprise',
      ])
    })

    it('tops out at enterprise and bottoms out at the whole ladder', () => {
      expect(releaseFlagPlansAtOrAbove('enterprise')).toEqual(['enterprise'])
      expect(releaseFlagPlansAtOrAbove('free')).toEqual([
        ...RELEASE_FLAG_PLAN_LADDER,
      ])
    })
  })

  describe('the tier ladder is derived, not re-typed', () => {
    it('covers every plan the pricing model declares', () => {
      // The failure this guards is the one `PLAN_OPTIONS` already hit: a
      // hand-written tier list stuck at Business while Scale, Advanced and
      // Agency shipped. Compared against `PLAN_LABELS`, which is the record
      // the `OrgPlan` union makes exhaustive.
      expect([...RELEASE_FLAG_PLAN_LADDER].sort()).toEqual(
        (Object.keys(PLAN_LABELS) as OrgPlan[]).sort(),
      )
    })

    it('runs cheapest-first: self-serve tiers, then enterprise', () => {
      expect(RELEASE_FLAG_PLAN_LADDER).toEqual([
        ...SELF_SERVE_PLANS,
        'enterprise',
      ])
    })
  })

  describe('releaseFlagTargetsPlan', () => {
    it('admits every tier when no list is declared', () => {
      const value: ReleaseFlagValue = { enabled: true }
      for (const plan of RELEASE_FLAG_PLAN_LADDER) {
        expect(releaseFlagTargetsPlan(value, plan)).toBe(true)
      }
      expect(releaseFlagTargetsPlan(value, null)).toBe(true)
    })

    it('admits every tier for an EMPTY list', () => {
      // The inverted reading — empty means nobody — dark-launches nothing
      // while the console still reports the flag as on. Named explicitly
      // because `plans.length` is exactly where that inversion would live.
      const value: ReleaseFlagValue = { enabled: true, plans: [] }
      expect(releaseFlagTargetsPlan(value, 'free')).toBe(true)
      expect(releaseFlagTargetsPlan(value, 'enterprise')).toBe(true)
      expect(releaseFlagTargetsPlan(value, null)).toBe(true)
    })

    it('admits only the named tiers', () => {
      const value: ReleaseFlagValue = {
        enabled: true,
        plans: ['agency', 'enterprise'],
      }
      expect(releaseFlagTargetsPlan(value, 'agency')).toBe(true)
      expect(releaseFlagTargetsPlan(value, 'enterprise')).toBe(true)
      expect(releaseFlagTargetsPlan(value, 'pro')).toBe(false)
      expect(releaseFlagTargetsPlan(value, 'free')).toBe(false)
    })

    it('refuses an unknown plan against a declared list', () => {
      // Same conservatism as a subject-less percentage rollout: a caller
      // that cannot say which workspace it is asking about gets the safe
      // answer. `strictNullChecks` is off, so both spellings of absent are
      // pinned rather than assumed equivalent.
      const value: ReleaseFlagValue = { enabled: true, plans: ['pro'] }
      expect(releaseFlagTargetsPlan(value, null)).toBe(false)
      expect(releaseFlagTargetsPlan(value, undefined)).toBe(false)
    })
  })

  describe('the tier filter gates the fully-enabled path too', () => {
    it('keeps an ON flag away from tiers it does not target', () => {
      const value: ReleaseFlagValue = {
        enabled: true,
        plans: ['agency', 'enterprise'],
      }
      expect(isReleaseFlagOn(KEY, value, 'org_a', 'enterprise')).toBe(true)
      expect(isReleaseFlagOn(KEY, value, 'org_a', 'pro')).toBe(false)
    })

    it('still means everyone when no tiers are declared', () => {
      const value: ReleaseFlagValue = { enabled: true }
      expect(isReleaseFlagOn(KEY, value, 'org_a', 'free')).toBe(true)
      expect(isReleaseFlagOn(KEY, value, 'org_a', null)).toBe(true)
    })
  })

  describe('percentage and tiers compose', () => {
    const value: ReleaseFlagValue = {
      enabled: false,
      rolloutPercent: 50,
      plans: ['pro', 'business', 'scale', 'advanced', 'agency', 'enterprise'],
    }

    it('is the intersection: the global cohort, restricted to the tiers', () => {
      // The documented semantics. "Pro and above at 50%" has to be
      // predictable, and it is predictable precisely because the two obvious
      // readings — half of the Pro+ orgs, and the global half restricted to
      // Pro+ — name the SAME set. That only holds while the bucket ignores
      // the plan, which the next test pins.
      const cohort = new Set(inBucketUnder(50))
      for (const subject of subjects) {
        expect(isReleaseFlagOn(KEY, value, subject, 'pro')).toBe(
          cohort.has(subject),
        )
        // Below the tier floor, the percentage never gets a say.
        expect(isReleaseFlagOn(KEY, value, subject, 'starter')).toBe(false)
      }
    })

    it('lands roughly half of the targeted tier, not half of everyone', () => {
      const targeted = subjects.filter((subject) =>
        isReleaseFlagOn(KEY, value, subject, 'business'),
      )
      // Not an assertion about the hash quality — `releaseFlagBucket` owns
      // that — only that the percentage is applied WITHIN the tier rather
      // than diluted by the orgs the filter already removed.
      expect(targeted.length).toBe(inBucketUnder(50).length)
      expect(targeted.length).toBeGreaterThan(subjects.length * 0.3)
      expect(targeted.length).toBeLessThan(subjects.length * 0.7)
    })
  })

  describe('the bucket is stable across tier edits', () => {
    it('does not reshuffle when an unrelated tier joins the list', () => {
      // The regression that would be invisible in production and infuriating
      // to customers: an org that had the feature yesterday losing it because
      // staff widened the rollout to another tier. If the plan were mixed
      // into the hash — the obvious implementation — this fails.
      const before: ReleaseFlagValue = {
        enabled: false,
        rolloutPercent: 40,
        plans: ['business'],
      }
      const after: ReleaseFlagValue = {
        enabled: false,
        rolloutPercent: 40,
        plans: ['business', 'enterprise'],
      }
      for (const subject of subjects) {
        expect(isReleaseFlagOn(KEY, after, subject, 'business')).toBe(
          isReleaseFlagOn(KEY, before, subject, 'business'),
        )
      }
    })

    it('does not reshuffle when targeting is added to a live rollout', () => {
      const untargeted: ReleaseFlagValue = {
        enabled: false,
        rolloutPercent: 40,
      }
      const targeted: ReleaseFlagValue = {
        enabled: false,
        rolloutPercent: 40,
        plans: ['pro'],
      }
      for (const subject of subjects) {
        // Every Pro org keeps exactly the verdict it had before the tier list
        // existed; only orgs on other tiers are subtracted.
        expect(isReleaseFlagOn(KEY, targeted, subject, 'pro')).toBe(
          isReleaseFlagOn(KEY, untargeted, subject, 'pro'),
        )
      }
    })

    it('hashes the org id alone, never the plan', () => {
      for (const subject of subjects.slice(0, 20)) {
        const verdicts = RELEASE_FLAG_PLAN_LADDER.map((plan) =>
          isReleaseFlagOn(
            KEY,
            { enabled: false, rolloutPercent: 40 },
            subject,
            plan,
          ),
        )
        expect(new Set(verdicts).size).toBe(1)
      }
    })
  })

  describe('a per-org override still outranks the tier filter', () => {
    it('grants a targeted flag to an org below the floor', () => {
      // Half the point of the override layer (AGL-1635) is early access for
      // one named customer. A tier filter that could veto it would make a
      // Free-tier design partner unreachable without widening the flag for
      // every Free org.
      const value: ReleaseFlagValue = { enabled: false, plans: ['enterprise'] }
      expect(
        isReleaseFlagOnForOrg(KEY, value, 'org_a', { [KEY]: true }, 'free'),
      ).toBe(true)
    })

    it('still kills a targeted flag for one org inside the tiers', () => {
      const value: ReleaseFlagValue = { enabled: true, plans: ['enterprise'] }
      expect(
        isReleaseFlagOnForOrg(
          KEY,
          value,
          'org_a',
          { [KEY]: false },
          'enterprise',
        ),
      ).toBe(false)
    })
  })

  /**
   * The compatibility contract. Everything published before this issue is a
   * Remote Config parameter with no `plans` key, read by call sites that
   * pass no plan — and both halves have to keep answering exactly as they
   * did.
   */
  describe('flags stored in their pre-AGL-2486 shape', () => {
    /** Verbatim shapes seen in the published Remote Config template. */
    const stored = [
      '{"enabled":true}',
      '{"enabled":false}',
      '{"enabled":false,"rolloutPercent":25}',
      '{"enabled":false,"rolloutPercent":100,"note":"waiting on AGL-199"}',
      'true',
      'false',
      '',
    ]

    it('parses with no plans key at all', () => {
      for (const raw of stored) {
        const value = parseReleaseFlagValue(raw, false)
        expect(value.plans).toBeUndefined()
        // Not merely undefined — ABSENT. `'plans' in value` is what the
        // staff PUT uses to tell "the operator cleared the targeting" apart
        // from "this caller never mentioned it", so an explicit
        // `plans: undefined` here would make every legacy publish look like
        // a deliberate clear.
        expect(Object.prototype.hasOwnProperty.call(value, 'plans')).toBe(false)
      }
    })

    it('evaluates identically with and without a plan argument', () => {
      // The call sites that were not updated pass three arguments. If the
      // new parameter had defaulted to anything that reads as a restriction,
      // every one of them would have started answering differently.
      for (const raw of stored) {
        const value = parseReleaseFlagValue(raw, false)
        for (const subject of subjects.slice(0, 50)) {
          const legacy = isReleaseFlagOn(KEY, value, subject)
          expect(isReleaseFlagOn(KEY, value, subject, null)).toBe(legacy)
          for (const plan of RELEASE_FLAG_PLAN_LADDER) {
            expect(isReleaseFlagOn(KEY, value, subject, plan)).toBe(legacy)
          }
        }
      }
    })

    it('round-trips through the parser without acquiring targeting', () => {
      // The partial-write shape (`withConverter` on a `merge`, and its
      // Remote Config equivalent): re-serialising a value that never had
      // targeting must not write a `plans` field onto it.
      for (const raw of stored) {
        const reserialized = JSON.stringify(parseReleaseFlagValue(raw, false))
        expect(reserialized).not.toContain('plans')
        expect(parseReleaseFlagValue(reserialized, false).plans).toBeUndefined()
      }
    })

    it('leaves every registered flag untargeted at its registry default', () => {
      for (const definition of RELEASE_FLAGS) {
        const value = parseReleaseFlagValue(undefined, definition.defaultEnabled)
        expect(value.plans).toBeUndefined()
        expect(value.enabled).toBe(definition.defaultEnabled)
        // A registry default is consulted before Remote Config activates and
        // on every environment without a published template. If tier
        // targeting leaked into that path, local dev and the emulator would
        // gate differently from production.
        expect(
          isReleaseFlagOnForOrg(definition.key, value, 'org_a', {}, null),
        ).toBe(definition.defaultEnabled)
      }
    })
  })
})
