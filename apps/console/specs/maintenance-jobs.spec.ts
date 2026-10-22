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
 * The staff-run refusal rule, and the descriptor invariants that keep it
 * meaningful (AGL-1949).
 *
 * The refusal rule is asserted directly here and driven through all three
 * routes in `maintenance-staff-surface.spec.ts`. What this file adds is the
 * STRUCTURAL guard: the rule can only protect a job whose descriptor says it
 * is destructive and names a phrase, so a future job added without either is
 * not protected by any amount of correct logic. That is the AGL-2084 shape
 * exactly — `audit-archive` was the copy of the dry-run guard nobody wrote —
 * and it is caught here rather than in review.
 */

import {
  MAINTENANCE_JOBS,
  MAINTENANCE_REASON_MIN,
  findMaintenanceJob,
  refuseStaffRun,
  type MaintenanceJobDescriptor,
} from '../utils/maintenance-jobs'

const REASON = 'clearing the backlog by hand'

function job(id: string): MaintenanceJobDescriptor {
  const found = findMaintenanceJob(id)
  if (!found) throw new Error(`no descriptor for ${id}`)
  return found
}

describe('staff maintenance run rules (AGL-1949)', () => {
  describe('descriptor invariants', () => {
    it('gives EVERY destructive job a confirmation phrase', () => {
      // The guard that outlives this issue: a destructive job added later
      // with `confirmPhrase: null` is a one-click irreversible sweep, and no
      // amount of correct refusal logic would catch it.
      for (const entry of MAINTENANCE_JOBS) {
        if (entry.destructive) {
          expect(entry.confirmPhrase).toBeTruthy()
        }
      }
      // Not vacuous — there ARE destructive jobs in the list.
      expect(MAINTENANCE_JOBS.some((entry) => entry.destructive)).toBe(true)
    })

    it('gives every job an audit action and a consequence to read', () => {
      for (const entry of MAINTENANCE_JOBS) {
        expect(entry.auditAction).toMatch(/^maintenance\./)
        expect(entry.consequence.length).toBeGreaterThan(20)
        expect(entry.previewShows.length).toBeGreaterThan(20)
      }
    })

    it('does not duplicate a job that already has its own surface', () => {
      // `backfill-scope` (AGL-2062) and `run-erasures` (AGL-2165) have cards
      // on the health board. A second surface for the same route is how two
      // surfaces come to disagree about what the route does.
      const ids = MAINTENANCE_JOBS.map((entry) => entry.id)
      expect(ids).not.toContain('backfill-scope')
      expect(ids).not.toContain('run-erasures')
    })

    it('uses unique ids and phrases', () => {
      const ids = MAINTENANCE_JOBS.map((entry) => entry.id)
      expect(new Set(ids).size).toBe(ids.length)
      const phrases = MAINTENANCE_JOBS.map(
        (entry) => entry.confirmPhrase,
      ).filter(Boolean)
      // A phrase shared by two jobs would let muscle memory arm the wrong one.
      expect(new Set(phrases).size).toBe(phrases.length)
    })
  })

  describe('the reason requirement', () => {
    it('refuses a missing reason on every job, destructive or not', () => {
      for (const entry of MAINTENANCE_JOBS) {
        const refusal = refuseStaffRun(entry, {
          confirm: entry.confirmPhrase ?? undefined,
        })
        expect(refusal).toContain('reason')
      }
    })

    it('refuses a reason that is only whitespace', () => {
      const entry = job('reverify-plugin-versions')
      expect(refuseStaffRun(entry, { reason: '          ' })).toContain(
        'reason',
      )
    })

    it('refuses a reason one character short of the minimum', () => {
      const entry = job('reverify-plugin-versions')
      const short = 'x'.repeat(MAINTENANCE_REASON_MIN - 1)
      expect(refuseStaffRun(entry, { reason: short })).toContain('reason')
      expect(
        refuseStaffRun(entry, { reason: 'x'.repeat(MAINTENANCE_REASON_MIN) }),
      ).toBeNull()
    })

    it('refuses a non-string reason', () => {
      const entry = job('reverify-plugin-versions')
      expect(refuseStaffRun(entry, { reason: 12345678 })).toContain('reason')
    })
  })

  describe('the typed phrase', () => {
    it('admits the exact phrase with a good reason', () => {
      const entry = job('audit-archive')
      expect(
        refuseStaffRun(entry, {
          reason: REASON,
          confirm: entry.confirmPhrase as string,
        }),
      ).toBeNull()
    })

    it('refuses when the phrase is absent', () => {
      const entry = job('reap-plugin-artifacts')
      const refusal = refuseStaffRun(entry, { reason: REASON })
      expect(refusal).toContain(entry.confirmPhrase as string)
    })

    /*==========================================
     * A confirmation that accepts an approximation of itself is one that can
     * be fired by accident, which is the whole failure being designed out.
     *=========================================*/
    it('refuses every near miss', () => {
      const entry = job('reap-plugin-artifacts')
      const phrase = entry.confirmPhrase as string
      for (const near of [
        phrase.toLowerCase(),
        phrase.toUpperCase() === phrase ? `${phrase} ` : phrase.toUpperCase(),
        ` ${phrase}`,
        phrase.slice(0, -1),
        phrase.replace(/ /g, ''),
        '',
      ]) {
        if (near === phrase) continue
        expect(
          refuseStaffRun(entry, { reason: REASON, confirm: near }),
        ).not.toBeNull()
      }
    })

    it('refuses another job’s phrase', () => {
      const entry = job('audit-archive')
      const other = job('reap-plugin-artifacts').confirmPhrase as string
      expect(
        refuseStaffRun(entry, { reason: REASON, confirm: other }),
      ).not.toBeNull()
    })

    it('needs no phrase for a non-destructive job', () => {
      const entry = job('reverify-plugin-versions')
      expect(entry.confirmPhrase).toBeNull()
      expect(refuseStaffRun(entry, { reason: REASON })).toBeNull()
    })
  })
})
