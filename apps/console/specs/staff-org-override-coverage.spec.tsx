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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PLAN_ENTITLEMENTS, RELEASE_FLAGS } from '@aglyn/aglyn'

/**
 * Coverage of the staff override surface (AGL-1635).
 *
 * Zach reported the admin bar missing from the org override dialog. The
 * cause was not one forgotten flag — it was that the dialog's field lists
 * could silently fall behind their sources:
 *
 *  - `FLAG_FIELDS` was derived (AGL-549) and was complete;
 *  - `QUOTA_FIELDS` was hand-written and had drifted EIGHT keys behind the
 *    plan model, including all three transaction-fee percentages;
 *  - release flags had no per-org override at ALL, which is why
 *    `release_edit_bar` could not be granted to one customer.
 *
 * These are drift guards, not example tests: each compares the rendered
 * surface against its SOURCE OF TRUTH, so a key added later is covered
 * without anyone editing this file.
 */

/**
 * The override writes its org document and its audit row in ONE BATCH since
 * AGL-1784, so both come out of `mockBatchWrites` — and only once `commit()`
 * resolves. `setDoc`/`addDoc` remain as tripwires for a return to two
 * independent writes.
 */
const mockSetDoc = jest.fn(async () => undefined)
const mockAddDoc = jest.fn(async () => undefined)
const mockBatchWrites: Array<
  [{ path: string }, Record<string, any>, unknown]
> = []
let mockAutoId = 0
jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (parent: any, ...segments: string[]) =>
    segments.length > 0
      ? { path: segments.join('/') }
      : { path: `${parent?.path ?? ''}/auto-${++mockAutoId}` },
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  setDoc: (...args: unknown[]) => mockSetDoc(...(args as [])),
  addDoc: (...args: unknown[]) => mockAddDoc(...(args as [])),
  deleteField: () => '__DELETE__',
  writeBatch: () => {
    const staged: Array<[{ path: string }, Record<string, any>, unknown]> = []
    return {
      set: (ref: { path: string }, data: Record<string, any>, options?: unknown) => {
        staged.push([ref, data, options])
      },
      commit: async () => {
        mockBatchWrites.push(...staged)
      },
    }
  },
}))

jest.mock('@aglyn/shared-util-timestamp', () => ({
  __esModule: true,
  Timestamp: { now: () => ({ seconds: 1_700_000_000 }) },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'staff-1', getIdToken: async () => 'tok' } }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

import StaffOrgActions, {
  FLAG_FIELDS,
  overrideCount,
  QUOTA_FIELDS,
  RELEASE_FLAG_FIELDS,
} from '../components/staff-org-actions.component'

const org = (over: Record<string, unknown> = {}) => ({
  $id: 'org-1',
  plan: 'pro',
  ...over,
})

const setDocPayload = (index = 0) =>
  mockBatchWrites.filter(
    ([ref]) => !ref.path.startsWith('adminAudit'),
  )[index] as unknown as [
    { path: string },
    Record<string, any>,
    { merge: boolean },
  ]

const auditPayload = (index = 0) =>
  mockBatchWrites.filter(([ref]) =>
    ref.path.startsWith('adminAudit'),
  )[index] as unknown as [{ path: string }, any]

describe('staff org override surface coverage (AGL-1635)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockBatchWrites.length = 0
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as unknown as typeof fetch
  })

  describe('field lists track their sources', () => {
    it('offers every NUMERIC entitlement the resolver would accept', () => {
      // `resolveOrgEntitlements` applies ANY numeric key found on
      // `org.entitlements`. Anything it accepts but this dialog omits is an
      // override only a hand-written Firestore document can set — which is
      // what the three fee percentages needed before this.
      const numeric = Object.entries(PLAN_ENTITLEMENTS.free)
        .filter(([, value]) => typeof value === 'number')
        .map(([key]) => key)
      const offered = new Set(QUOTA_FIELDS.map((field) => field.key))
      expect(numeric.filter((key) => !offered.has(key))).toEqual([])
      // and nothing offered that is not a real numeric entitlement
      expect(
        [...offered].filter((key) => !numeric.includes(key)),
      ).toEqual([])
    })

    it('names the eight keys that were missing, so a silent revert is loud', () => {
      const offered = new Set(QUOTA_FIELDS.map((field) => field.key))
      for (const key of [
        'templatesPerHost',
        'apiRequestsPerMonth',
        'productsPerHost',
        'inventoryLocations',
        'posRegisters',
        'transactionFeePhysicalPct',
        'transactionFeeDigitalPct',
        'marketplaceFeePct',
      ]) {
        expect(offered.has(key)).toBe(true)
      }
    })

    it('gives every quota a non-empty label, derived or explicit', () => {
      for (const field of QUOTA_FIELDS) {
        expect(field.label.length).toBeGreaterThan(0)
        expect(field.label).not.toBe(field.key)
      }
    })

    it('offers every plan FEATURE boolean (AGL-549 still holds)', () => {
      expect(new Set(FLAG_FIELDS)).toEqual(
        new Set(Object.keys(PLAN_ENTITLEMENTS.free.features)),
      )
    })

    it('offers every REGISTERED release flag, admin bar included', () => {
      expect(RELEASE_FLAG_FIELDS.map((field) => field.key).sort()).toEqual(
        RELEASE_FLAGS.map((definition) => definition.key).sort(),
      )
      // The reported one, by name.
      expect(
        RELEASE_FLAG_FIELDS.find(
          (field) => field.key === 'release_edit_bar',
        )?.label,
      ).toBe('Site admin bar')
    })
  })

  describe('overrideCount', () => {
    it('counts release-flag overrides alongside quotas and features', () => {
      expect(overrideCount(org())).toBe(0)
      expect(
        overrideCount(
          org({
            entitlements: { hostLimit: 5, features: { pos: true } },
            releaseFlags: { release_edit_bar: true },
          }),
        ),
      ).toBe(3)
    })

    it('counts a release override on an org with no entitlements at all', () => {
      // The row chip must not read "no overrides" for an org that has been
      // granted an unreleased feature — that is precisely the state a
      // support question arrives about.
      expect(overrideCount(org({ releaseFlags: { release_edit_bar: true } }))).toBe(
        1,
      )
    })
  })

  describe('the dialog writes release-flag overrides', () => {
    /**
     * Grant early access to one org — and say WHY (AGL-1652). Forcing an
     * unreleased feature on for a single paying customer is exactly the act
     * the reason field exists for, so the dialog refuses to save without
     * one and every case here has to supply it.
     */
    const chooseReason = async (dialog: HTMLElement) => {
      fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Reason' }))
      fireEvent.click(
        await screen.findByRole('option', {
          name: 'Early access to an unreleased feature',
        }),
      )
    }

    const openAndSetFlag = async (value: string, existing?: unknown) => {
      render(
        <StaffOrgActions
          org={org(existing ? { releaseFlags: existing } : {})}
          onChanged={jest.fn()}
        />,
      )
      fireEvent.click(screen.getByText('Override'))
      const dialog = screen.getByRole('dialog')
      // The release-flag control is labelled with the registry LABEL, which
      // is what a staff member reads — not the raw key.
      const control = within(dialog).getByLabelText('Site admin bar')
      fireEvent.mouseDown(control)
      const option = await screen.findByRole('option', { name: value })
      fireEvent.click(option)
      await chooseReason(dialog)
      fireEvent.click(within(dialog).getByText('Save (audited)'))
      // The batch has to COMMIT — a staged write is not a write.
      await waitFor(() => expect(mockBatchWrites.length).toBe(2))
      expect(mockSetDoc).not.toHaveBeenCalled()
    }

    it('forces a flag ON for one org and audits the resulting state', async () => {
      await openAndSetFlag('Force on')
      const [target, write] = setDocPayload()
      expect(target.path).toBe('orgs/org-1')
      expect(write['releaseFlags'].release_edit_bar).toBe(true)
      // Untouched flags are DELETE sentinels, never omitted: the write is a
      // merge, so an omitted key would keep whatever was stored (AGL-1109).
      expect(write['releaseFlags'].release_contacts).toBe('__DELETE__')

      const [, audit] = auditPayload()
      expect(audit.action).toBe('org.override')
      expect(audit.actorUid).toBe('staff-1')
      // Granting one org an unreleased feature now records WHY (AGL-1652).
      expect(audit.reason).toBe('beta')
      // The audit records STATE, so no sentinel may reach it.
      expect(audit.after.releaseFlags).toEqual({ release_edit_bar: true })
      expect(Object.values(audit.after.releaseFlags)).not.toContain(
        '__DELETE__',
      )
    })

    it('forces a flag OFF — the per-org kill switch', async () => {
      await openAndSetFlag('Force off')
      const [, write] = setDocPayload()
      expect(write['releaseFlags'].release_edit_bar).toBe(false)
      const [, audit] = auditPayload()
      expect(audit.after.releaseFlags).toEqual({ release_edit_bar: false })
    })

    it('reverting the last override to Inherit REMOVES the field', async () => {
      // Not an empty map left behind: `overrideCount` reads key presence, so
      // an empty `releaseFlags` would keep showing a chip forever.
      await openAndSetFlag('Inherit (default off)', { release_edit_bar: true })
      const [, write] = setDocPayload()
      expect(write['releaseFlags']).toBe('__DELETE__')
      const [, audit] = auditPayload()
      expect(audit.after.releaseFlags).toBeNull()
      expect(audit.before.releaseFlags).toEqual({ release_edit_bar: true })
    })

    it('prefills the stored override when the dialog reopens', () => {
      render(
        <StaffOrgActions
          org={org({ releaseFlags: { release_edit_bar: false } })}
          onChanged={jest.fn()}
        />,
      )
      fireEvent.click(screen.getByText('Override'))
      const dialog = screen.getByRole('dialog')
      expect(
        within(dialog).getByLabelText('Site admin bar').textContent,
      ).toContain('Force off')
    })

    it('leaves entitlements untouched when only a release flag changes', async () => {
      // The two families are separate fields and separate questions; editing
      // one must not rewrite the other.
      render(
        <StaffOrgActions
          org={org({ entitlements: { hostLimit: 5 } })}
          onChanged={jest.fn()}
        />,
      )
      fireEvent.click(screen.getByText('Override'))
      const dialog = screen.getByRole('dialog')
      const control = within(dialog).getByLabelText('Site admin bar')
      fireEvent.mouseDown(control)
      fireEvent.click(await screen.findByRole('option', { name: 'Force on' }))
      await chooseReason(dialog)
      fireEvent.click(within(dialog).getByText('Save (audited)'))
      // The batch has to COMMIT — a staged write is not a write.
      await waitFor(() => expect(mockBatchWrites.length).toBe(2))
      expect(mockSetDoc).not.toHaveBeenCalled()
      const [, write] = setDocPayload()
      expect(write['entitlements'].hostLimit).toBe(5)
      expect(write['releaseFlags'].release_edit_bar).toBe(true)
    })
  })
})
