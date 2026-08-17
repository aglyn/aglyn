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
 * The override is `POST /api/admin/org-override` since AGL-1786, so what
 * this suite reads is the REQUEST BODY: the console sends the operator's
 * intent — plan, and only the quotas/features/release flags explicitly
 * forced — and the route mints the `FieldValue.delete()` sentinels
 * "inherit" needs. `setDoc`/`addDoc`/`writeBatch` remain as tripwires for a
 * return to a client write of either document.
 *
 * Which side of the wire holds the sentinel is not cosmetic. `deleteField()`
 * has no JSON form, so a body carrying one would arrive as `{}` and the
 * merge would keep the stored value — the AGL-1109 bug, reintroduced
 * silently by the migration. The route's own expansion is pinned in
 * org-override-route.spec.ts; what these cases pin is that the console sends
 * ABSENCE and not a payload.
 */
const mockSetDoc = jest.fn(async () => undefined)
const mockAddDoc = jest.fn(async () => undefined)
const mockBatchWrites: Array<
  [{ path: string }, Record<string, any>, unknown]
> = []
/** Bodies of the override POSTs, parsed. */
const mockOverrideBodies: any[] = []
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

/** What the console asked the route to apply. */
const overridePayload = (index = 0) => mockOverrideBodies[index]

describe('staff org override surface coverage (AGL-1635)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockBatchWrites.length = 0
    mockOverrideBodies.length = 0
    global.fetch = jest.fn(async (url: string, init: any) => {
      if (String(url) === '/api/admin/org-override') {
        mockOverrideBodies.push(JSON.parse(init.body))
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, written: true }),
      }
    }) as unknown as typeof fetch
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
      await waitFor(() => expect(mockOverrideBodies.length).toBe(1))
      // Nothing written from the client — the route owns both documents.
      expect(mockSetDoc).not.toHaveBeenCalled()
      expect(mockAddDoc).not.toHaveBeenCalled()
      expect(mockBatchWrites).toEqual([])
    }

    it('forces a flag ON for one org, and says WHY', async () => {
      await openAndSetFlag('Force on')
      const body = overridePayload()
      expect(body.orgId).toBe('org-1')
      expect(body.releaseFlags.release_edit_bar).toBe(true)
      // Untouched flags are ABSENT from the wire, never a sentinel: the
      // route expands absence into `FieldValue.delete()` against the
      // registry, because a serialised sentinel is `{}` and a merge ignores
      // it — which is the AGL-1109 no-op (org-override-route.spec.ts pins
      // the expansion).
      expect(body.releaseFlags).not.toHaveProperty('release_contacts')
      expect(JSON.stringify(body)).not.toContain('__DELETE__')
      // Granting one org an unreleased feature records WHY (AGL-1652).
      expect(body.reason).toBe('beta')
    })

    it('forces a flag OFF — the per-org kill switch', async () => {
      await openAndSetFlag('Force off')
      expect(overridePayload().releaseFlags.release_edit_bar).toBe(false)
    })

    it('reverting the last override to Inherit sends NO forced flags', async () => {
      // Not an empty map left behind on the org: `overrideCount` reads key
      // presence, so an empty `releaseFlags` would keep showing a chip
      // forever. From here that is expressed as an empty request map, which
      // the route turns into a delete of the whole field.
      await openAndSetFlag('Inherit (default off)', { release_edit_bar: true })
      expect(overridePayload().releaseFlags).toEqual({})
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
      await waitFor(() => expect(mockOverrideBodies.length).toBe(1))
      expect(mockSetDoc).not.toHaveBeenCalled()
      const body = overridePayload()
      // The stored quota is re-sent from the prefilled field, so the merge
      // keeps it; the release flag rides beside it as a separate family.
      expect(body.quotas.hostLimit).toBe(5)
      expect(body.releaseFlags.release_edit_bar).toBe(true)
    })
  })
})
