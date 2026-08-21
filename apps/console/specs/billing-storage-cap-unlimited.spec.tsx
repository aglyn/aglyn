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
 * The Storage cap card told Enterprise customers their uploads stop at 0 MB
 * (AGL-2404).
 *
 * The chain, because no single step looks wrong on its own:
 *
 *  1. Enterprise entitlements set `storagePerHostMb: UNLIMITED`, which is
 *     `Number.POSITIVE_INFINITY`.
 *  2. `JSON.stringify(Infinity)` is `null`. The route sent that.
 *  3. The card read `Number(null)` — which is `0`, and `Number.isFinite(0)` is
 *     TRUE, so the payload sailed through the load guard that exists precisely
 *     to reject a payload that cannot state the terms.
 *  4. Enterprise shares `metered: false` with Free, so it took Free's branch
 *     and rendered "a fixed 0 MB of storage. Uploads stop at that limit."
 *
 * The two plans are non-metered for OPPOSITE reasons — Free is walled at a
 * small allowance, Enterprise is unlimited under a custom contract — and the
 * copy that suits one is alarming and false for the other.
 *
 * Every existing storage spec passed throughout, because they cover the
 * BACKEND enforcement and nothing rendered this card.
 */

import { render, waitFor } from '@testing-library/react'

/** The card's rendered text, with markup boundaries flattened. */
const copy = () => (document.body.textContent ?? '').replace(/\s+/g, ' ')

// The card reads the signed-in user to authenticate its route call. Mocked so
// the spec needs no <FirebaseServicesProvider>; the token is never asserted,
// only that a call happens at all.
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { getIdToken: async () => 'test-token' } }),
}))

// The card's chrome: a snackbar, a loading queue and a confirm dialog. None of
// them are what this spec is about — it renders the card only to read the copy
// it chooses — so they are stubbed rather than stood up.
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  useLoading: () => ({ queueLoading: jest.fn() }),
  useConfirmationContext: () => ({ confirm: jest.fn(async () => true) }),
}))

import BillingStorageOverageCard from '../components/billing/billing-storage-overage-card.component'


/** The `action=get` payload, as the route serialises it. */
function serve(payload: Record<string, unknown>) {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  })) as unknown as typeof fetch
}

const BASE = {
  capSet: false,
  monthlyCapUsd: null,
  maxCapUsd: 500,
  defaultCapUsd: 50,
  pricePerGbUsd: 0.0338,
}

describe('Storage cap · a plan with UNLIMITED storage (AGL-2404)', () => {
  it('does not tell an Enterprise customer their uploads stop at 0 MB', async () => {
    serve({ ...BASE, metered: false, includedStoragePerSiteMb: 0, includedStorageUnlimited: true })
    render(<BillingStorageOverageCard orgId="org-1" canManage />)
    await waitFor(() => expect(copy()).toMatch(/unlimited/i))
    // The exact sentence customers were shown. Asserted as ABSENT rather than
    // just checking the new copy is present, because both branches rendering
    // would also be a failure.
    expect(copy()).not.toMatch(/uploads stop at that limit/i)
    expect(copy()).not.toMatch(/fixed 0 MB/i)
  })

  it('still shows the walled copy for a plan that really is walled', async () => {
    // Free: non-metered for the OTHER reason. The fix must not have converted
    // every non-metered plan into "unlimited", which would be the same defect
    // pointed the other way.
    serve({ ...BASE, metered: false, includedStoragePerSiteMb: 250, includedStorageUnlimited: false })
    render(<BillingStorageOverageCard orgId="org-1" canManage />)
    await waitFor(() => expect(copy()).toMatch(/uploads stop at/i))
    expect(copy()).not.toMatch(/includes unlimited storage/i)
  })

  it('does not claim storage bills on a plan that never bills for it', async () => {
    // The chip said "No cap — extra storage bills" on both non-metered plans,
    // contradicting the alert directly underneath it.
    serve({ ...BASE, metered: false, includedStoragePerSiteMb: 0, includedStorageUnlimited: true })
    render(<BillingStorageOverageCard orgId="org-1" canManage />)
    await waitFor(() => expect(copy()).toMatch(/unlimited/i))
    expect(copy()).not.toMatch(/extra storage bills/i)
  })

  it('keeps the metered copy for a plan that DOES bill', async () => {
    serve({ ...BASE, metered: true, includedStoragePerSiteMb: 10240, includedStorageUnlimited: false })
    render(<BillingStorageOverageCard orgId="org-1" canManage />)
    await waitFor(() => expect(copy()).toMatch(/keep working/i))
    expect(copy()).not.toMatch(/no overage to cap/i)
  })
})
