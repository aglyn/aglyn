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
 * CONVERT IS GATED ON A PENDING ERASURE (AGL-2632).
 *
 * The overflow's items already disable themselves, with the reason as a
 * tooltip, while an erasure request waits on the person; the Convert button
 * beside them did not, and a conversion filed against a pending erasure
 * reaches the capture door only to be refused there. The button has to stay
 * where it is — an absent button and an inapplicable one look alike — say
 * why, and never open the dialog.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { LeadPropertiesCard } from './lead-properties-card'

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  deleteField: () => ({ op: 'delete' }),
  serverTimestamp: () => ({ op: 'serverTimestamp' }),
  updateDoc: async () => undefined,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  writeGuardedBySeed: async () => ({ ok: true }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
}))
/*
 * The header is the record's chrome — the trail, the help affordance, the
 * overflow — with a spec of its own; here it is the slot the actions render
 * into. The send-email button and the owner picker each open reads this
 * spec has no interest in.
 */
jest.mock('./crm-record-header', () => ({
  CrmRecordHeader: ({ actions, children }: { actions?: ReactNode; children?: ReactNode }) => (
    <div>
      {actions}
      {children}
    </div>
  ),
  CrmRecordChip: () => null,
}))
jest.mock('./crm-send-email-button', () => ({ CrmSendEmailButton: () => null }))
jest.mock('./lead-owner-select', () => ({ LeadOwnerSelect: () => null }))

const PENDING_REASON = 'An erasure is pending for this person'

/** A lead as the capture left it: open, unowned, never converted. */
const lead = {
  email: 'jane@example.com',
  name: 'Jane Doe',
  sources: ['form'],
  submissionCount: 1,
  lastSeenAtMs: 1_000,
}

function renderCard(props: Partial<ComponentProps<typeof LeadPropertiesCard>> = {}) {
  const onConvert = jest.fn()
  render(
    <LeadPropertiesCard
      hostId="host-1"
      leadId="lead-1"
      lead={lead}
      leadStatus="success"
      fromCache={false}
      basePath="/acme/hosts/site/crm"
      roster={{
        options: [],
        labelFor: (ref) => String(ref ?? ''),
        emailFor: (ref) => String(ref ?? ''),
        ready: true,
        loading: false,
        error: null,
      }}
      onConvert={onConvert}
      onUnqualify={() => undefined}
      {...props}
    />,
  )
  return { onConvert }
}

const convert = () => screen.getByRole('button', { name: 'Convert' }) as HTMLButtonElement

describe('Convert on the lead page', () => {
  it('opens the dialog on an open lead', () => {
    const { onConvert } = renderCard()
    expect(convert().disabled).toBe(false)
    fireEvent.click(convert())
    expect(onConvert).toHaveBeenCalledTimes(1)
  })

  it('stays, disabled, with the reason, while an erasure is pending — and never opens the dialog', () => {
    const { onConvert } = renderCard({ erasurePending: true })
    expect(convert().disabled).toBe(true)
    // The reason is the tooltip's, hung off the wrapper a disabled button
    // needs to receive a pointer at all.
    expect(screen.getByLabelText(PENDING_REASON)).not.toBeNull()
    fireEvent.click(convert())
    expect(onConvert).not.toHaveBeenCalled()
  })
})
