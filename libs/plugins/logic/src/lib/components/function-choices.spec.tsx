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
 * A parameter's choices, built as rows instead of `value: Label` text
 * (AGL-3768), saved in the shape a Function Widget has always read.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import { choiceRowsFromOptions, optionsFromChoiceRows } from '../model/parameter-options'
import HostFunctionsCard from './host-functions-card.component'

const functionDocs = [
  {
    $id: 'fn-1',
    name: 'planPrice',
    parameters: [
      { name: 'plan', type: 'text', required: true },
      { name: 'yearly', type: 'boolean', required: false },
    ],
    variables: [],
    operations: [],
    returnValue: 'plan',
  },
]
const collections: Record<string, Array<Record<string, unknown>>> = {
  functions: functionDocs,
  variables: [],
  workflows: [],
}
const FIRESTORE = {}

jest.mock('@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change', () =>
  jest
    .requireActual('@aglyn/tenant-feature-instance/testing/site-wide-change-double')
    .siteWideChangeThroughSdk(() => jest.requireMock('firebase/firestore')),
)
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  useHostResourceApi: () => jest.fn().mockResolvedValue({ id: 'new-1' }),
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  doc: () => ({}),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
  getCountFromServer: async (name: string) => ({
    data: () => ({ count: (collections[name] ?? []).length }),
  }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn().mockResolvedValue(undefined) }),
}))
jest.mock('./where-used-dialog.component', () => ({ __esModule: true, default: () => null }))
jest.mock('@aglyn/aglyn/app-utils/where-used', () => ({
  fetchWhereUsed: jest.fn().mockResolvedValue({}),
  summarizeDependents: () => '',
}))

const ORG = { plan: 'business' } as never

function choose(label: string, option: string, index = 0) {
  fireEvent.mouseDown(screen.getAllByRole('combobox', { name: label })[index])
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }))
}

describe('a parameter’s choices as rows (AGL-3768)', () => {
  it('stores the choices and a start picked from them', async () => {
    render(<HostFunctionsCard hostId="host-1" org={ORG} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.queryByLabelText('Choices')).toBeNull()

    // A true/false is asked as a switch: no choices, and it starts On or Off.
    expect(screen.getAllByRole('button', { name: 'Add choice' })).toHaveLength(1)
    choose('Starts as', 'On', 0)

    fireEvent.click(screen.getByRole('button', { name: 'Add choice' }))
    fireEvent.change(screen.getByLabelText('Function gets'), { target: { value: 'cms' } })
    fireEvent.change(screen.getByLabelText('Visitors see'), {
      target: { value: 'A CMS and room to grow' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add choice' }))
    fireEvent.change(screen.getAllByLabelText('Function gets')[1], {
      target: { value: 'entry' },
    })
    choose('Starts as', 'A CMS and room to grow', 0)

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    expect(payload.parameters).toEqual([
      {
        name: 'plan',
        type: 'text',
        required: true,
        options: [{ value: 'cms', label: 'A CMS and room to grow' }, { value: 'entry' }],
        defaultValue: 'cms',
      },
      { name: 'yearly', type: 'boolean', required: false, defaultValue: 'true' },
    ])
  })
})

describe('choice rows and the stored list', () => {
  it('drops blank and repeated values, and a label that is only the value', () => {
    expect(
      optionsFromChoiceRows([
        { value: ' a ', label: 'Alpha' },
        { value: '', label: 'orphan' },
        { value: 'a', label: 'Again' },
        { value: 'b', label: 'b' },
      ]),
    ).toEqual([{ value: 'a', label: 'Alpha' }, { value: 'b' }])
  })

  it('opens a stored list as rows and writes it back unchanged', () => {
    const stored = [{ value: 'cms', label: 'A CMS' }, { value: 'none' }]
    expect(optionsFromChoiceRows(choiceRowsFromOptions(stored))).toEqual(stored)
  })
})
