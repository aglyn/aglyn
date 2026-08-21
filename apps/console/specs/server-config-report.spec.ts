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
 * The resolved-config report tells the truth and never echoes a value
 * (AGL-2069).
 *
 * The claims, and the input that makes each one fail:
 *
 * 1. **`source` separates "someone set it" from "the code default agrees".**
 *    Given `boundary` set explicitly and `boundary` defaulted, a report that
 *    only carries the mode is identical in both cases — which is the reading
 *    error AGL-1875's body actually made.
 * 2. **A trailing space is CAUGHT.** `meteredBackfillMode()` lowercases
 *    without trimming, so `"immediate "` resolves to `boundary` while every
 *    external check stays green. The report must state `boundary` (the truth)
 *    AND warn that the configured text says otherwise.
 * 3. **The resolver is quoted, never re-derived.** Handed a resolver answer
 *    that disagrees with the descriptor's own rule, the report reports the
 *    RESOLVER and raises the drift — it must never "correct" production.
 * 4. **No secret value reaches the output, anywhere.** The strongest claim
 *    here, so it is asserted over the serialized report rather than
 *    field-by-field: a field added later that echoed a value would slip past
 *    any per-field assertion.
 */

import {
  analyzeEnumKnob,
  buildServerConfigReport,
  describePresence,
  describeSecretClass,
  METERED_BACKFILL_MODES,
  readDeploymentIdentity,
  SECRET_CLASSES,
} from '../utils/server-config-report'

/**
 * A secret with no substring in common with any legitimate output word.
 *
 * Chosen so a leak cannot hide behind a coincidence: if any part of this
 * appears in the serialized report, it got there from the value.
 */
const SECRET_TAIL = 'ZZQQXX7391WWVV'
const LIVE_KEY = `sk_live_${SECRET_TAIL}`

function knob(report: ReturnType<typeof buildServerConfigReport>, key: string) {
  const found = report.knobs.find((entry) => entry.key === key)
  if (!found) throw new Error(`no knob reported for ${key}`)
  return found
}

describe('resolved server config report (AGL-2069)', () => {
  describe('source separates a set value from an agreeing default', () => {
    it('reports source=default when nothing is configured', () => {
      const report = buildServerConfigReport(
        {},
        { meteredBackfillMode: 'boundary' },
      )
      const entry = knob(report, 'STRIPE_METERED_BACKFILL')
      expect(entry.value).toBe('boundary')
      expect(entry.source).toBe('default')
      expect(entry.warning).toBeNull()
    })

    it('reports source=env for the SAME resolved mode when it was set', () => {
      const report = buildServerConfigReport(
        { STRIPE_METERED_BACKFILL: 'boundary' },
        { meteredBackfillMode: 'boundary' },
      )
      const entry = knob(report, 'STRIPE_METERED_BACKFILL')
      // Identical mode, different provenance. A report carrying only the
      // mode cannot tell these two apart, and that is the whole bug.
      expect(entry.value).toBe('boundary')
      expect(entry.source).toBe('env')
    })

    it('treats an empty string as absent, not as a choice', () => {
      const report = buildServerConfigReport(
        { STRIPE_METERED_BACKFILL: '' },
        { meteredBackfillMode: 'boundary' },
      )
      expect(knob(report, 'STRIPE_METERED_BACKFILL').source).toBe('default')
    })
  })

  describe('the trailing-space hazard', () => {
    it('states the mode production ACTUALLY resolved, not the intent', () => {
      // This is what `meteredBackfillMode()` really does with "immediate ":
      // lowercase, no trim, no match, fall back to boundary.
      const report = buildServerConfigReport(
        { STRIPE_METERED_BACKFILL: 'immediate ' },
        { meteredBackfillMode: 'boundary' },
      )
      const entry = knob(report, 'STRIPE_METERED_BACKFILL')
      expect(entry.value).toBe('boundary')
      expect(entry.source).toBe('env')
    })

    it('warns, naming whitespace as the cause', () => {
      const report = buildServerConfigReport(
        { STRIPE_METERED_BACKFILL: 'immediate ' },
        { meteredBackfillMode: 'boundary' },
      )
      const entry = knob(report, 'STRIPE_METERED_BACKFILL')
      expect(entry.warning).toContain('whitespace')
      expect(entry.warning).toContain('immediate')
      expect(report.warnings).toHaveLength(1)
    })

    it('warns on an unrecognized word and names what is accepted', () => {
      const report = buildServerConfigReport(
        { STRIPE_METERED_BACKFILL: 'instant' },
        { meteredBackfillMode: 'boundary' },
      )
      const entry = knob(report, 'STRIPE_METERED_BACKFILL')
      expect(entry.warning).toContain('does not recognize')
      for (const mode of METERED_BACKFILL_MODES) {
        expect(entry.warning).toContain(mode)
      }
    })

    it('accepts a differently-cased value without warning', () => {
      const report = buildServerConfigReport(
        { STRIPE_METERED_BACKFILL: 'IMMEDIATE' },
        { meteredBackfillMode: 'immediate' },
      )
      const entry = knob(report, 'STRIPE_METERED_BACKFILL')
      expect(entry.value).toBe('immediate')
      expect(entry.warning).toBeNull()
    })
  })

  describe('the resolver is quoted, never re-derived', () => {
    it('reports the resolver even when it contradicts the rule', () => {
      const entry = analyzeEnumKnob({
        key: 'STRIPE_METERED_BACKFILL',
        label: 'Metered backfill',
        drives: 'billing',
        raw: 'immediate',
        allowed: METERED_BACKFILL_MODES,
        fallback: 'boundary',
        // The rule predicts `immediate`; production says otherwise.
        resolved: 'off',
      })
      expect(entry.value).toBe('off')
      expect(entry.warning).toContain('drifted')
    })
  })

  describe('deployment identity', () => {
    it('carries the ids that make a reading attributable', () => {
      const identity = readDeploymentIdentity({
        VERCEL_DEPLOYMENT_ID: 'dpl_123',
        VERCEL_GIT_COMMIT_SHA: 'abc123',
        VERCEL_ENV: 'production',
      })
      expect(identity).toEqual({
        id: 'dpl_123',
        commit: 'abc123',
        env: 'production',
        region: null,
      })
    })
  })

  describe('NO VALUE IS EVER ECHOED', () => {
    it('classifies a live key without reproducing any of it', () => {
      expect(describeSecretClass(LIVE_KEY)).toBe('live')
      expect(describeSecretClass(`sk_test_${SECRET_TAIL}`)).toBe('test')
      expect(describeSecretClass(`rk_live_${SECRET_TAIL}`)).toBe(
        'restricted-live',
      )
      expect(describeSecretClass(undefined)).toBe('absent')
      // An unknown shape is NOT described. "It starts with pk_" is still a
      // fact about the value.
      expect(describeSecretClass(`pk_live_${SECRET_TAIL}`)).toBe(
        'unrecognized',
      )
    })

    it('only ever returns one of the closed class vocabulary', () => {
      for (const raw of [
        LIVE_KEY,
        `sk_test_${SECRET_TAIL}`,
        `whatever_${SECRET_TAIL}`,
        '',
        undefined,
      ]) {
        expect(SECRET_CLASSES).toContain(describeSecretClass(raw))
      }
    })

    it('reduces a non-enum value to presence alone', () => {
      expect(describePresence(`bucket-${SECRET_TAIL}`)).toBe('set')
      expect(describePresence('')).toBe('not set')
    })

    /*==========================================
     * THE LOAD-BEARING ONE.
     *
     * Asserted over the SERIALIZED report, not per field: the risk is a knob
     * added later whose reporter hands back the raw string, and a
     * field-by-field assertion would not be looking at it. Every secret-shaped
     * variable is given a value carrying the same tell.
     *=========================================*/
    it('serializes with no trace of any configured value', () => {
      const report = buildServerConfigReport(
        {
          STRIPE_METERED_BACKFILL: 'immediate',
          STRIPE_SECRET_KEY: LIVE_KEY,
          CRON_SECRET: `cron-${SECRET_TAIL}`,
          PLUGIN_ARTIFACTS_BUCKET: `bucket-${SECRET_TAIL}`,
          STAFF_ALERT_EMAIL: `alerts-${SECRET_TAIL}@aglyn.com`,
        },
        { meteredBackfillMode: 'immediate' },
      )
      const serialized = JSON.stringify(report)
      expect(serialized).not.toContain(SECRET_TAIL)
      expect(serialized).not.toContain('sk_live')
      // And it is not vacuous — the report did report those knobs.
      expect(knob(report, 'STRIPE_SECRET_KEY').value).toBe('live')
      expect(knob(report, 'CRON_SECRET').value).toBe('set')
      expect(knob(report, 'STAFF_ALERT_EMAIL').value).toBe('set')
    })

    it('never lets an env var it was not asked about into the report', () => {
      const report = buildServerConfigReport(
        { TOTALLY_UNRELATED_SECRET: SECRET_TAIL },
        { meteredBackfillMode: 'boundary' },
      )
      const serialized = JSON.stringify(report)
      expect(serialized).not.toContain(SECRET_TAIL)
      expect(serialized).not.toContain('TOTALLY_UNRELATED_SECRET')
    })
  })
})
