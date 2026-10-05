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
 * Importing a workspace package from the hub (AGL-3535): the file is
 * planned before anything is written; an item that differs waits for a
 * choice and holds Import; every warning the plan asks for must be
 * acknowledged; Import sends those acknowledgements and shows what happened,
 * with Undo beside it.
 */

import type { TransferPackagePlanResponse, TransferPackagePlanItem } from '@aglyn/aglyn/data-transfer'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import OrgPackageImport from '../components/transfer-hub/org-package-import.component'
import type { TransferHubClient } from '../utils/transfer-hub-client'

const item = (overrides: Partial<TransferPackagePlanItem>): TransferPackagePlanItem => ({
  row: 0,
  key: 'outreach.sequences/s1',
  kind: 'outreach.sequences',
  id: 's1',
  name: 'Founders',
  status: 'new',
  comparison: 'new',
  decision: 'create',
  decisions: ['create', 'skip'],
  needsChoice: false,
  verdict: 'create',
  targetId: 's1',
  problems: [],
  ...overrides,
})

const plan = (overrides: Partial<TransferPackagePlanResponse>): TransferPackagePlanResponse => ({
  ok: true,
  job: { id: 'job-1', fileName: 'p.json' } as TransferPackagePlanResponse['job'],
  items: [item({})],
  references: [],
  unknownKinds: [],
  summary: { create: 1, replace: 0, keepBoth: 0, skip: 0, fail: 0, total: 1 },
  blocking: [],
  acknowledgementsRequired: [],
  resources: {
    'outreach.sequences': {
      label: 'Sequences',
      rules: [{ id: 'draft', label: 'An imported sequence arrives as a draft', reason: 'Nothing sends until activated.' }],
    },
  },
  ...overrides,
})

function client(first: TransferPackagePlanResponse): TransferHubClient & { [key: string]: jest.Mock } {
  return {
    jobs: jest.fn(),
    resultFile: jest.fn(),
    listPackageItems: jest.fn(),
    exportPackage: jest.fn(),
    plan: jest.fn().mockResolvedValue(first),
    apply: jest.fn().mockResolvedValue({
      ok: true,
      job: { id: 'job-1', status: 'applied' },
      done: true,
      results: [{ row: 0, outcome: 'created', recordId: 's1' }],
    }),
    undoPlan: jest.fn(),
    undo: jest.fn(),
  } as never
}

async function choose(api: TransferHubClient) {
  const view = render(<OrgPackageImport client={api} onDone={() => undefined} />)
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File([JSON.stringify({ manifest: {}, items: {} })], 'p.json', { type: 'application/json' })
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } })
  })
  return view
}

describe('importing a workspace package', () => {
  it('plans the file, shows each item and the rules, and holds Import while a choice is open', async () => {
    const api = client(
      plan({
        items: [item({ status: 'differs', comparison: 'differs', decision: 'skip', decisions: ['replace', 'keepBoth', 'skip'], needsChoice: true, verdict: 'skip' })],
        summary: { create: 0, replace: 0, keepBoth: 0, skip: 1, fail: 0, total: 1 },
        blocking: ['Choose what happens to Founders: it differs from the one you have.'],
      }),
    )
    await choose(api)
    await waitFor(() => expect(screen.getByText('Founders')).toBeTruthy())
    expect(api.plan).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'p.json', file: { manifest: {}, items: {} } }))
    expect(screen.getByText('Differs from yours')).toBeTruthy()
    expect(screen.getByText(/arrives as a draft/)).toBeTruthy()
    expect(screen.getByText(/it differs from the one you have/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /^Import/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('needs every warning acknowledged, sends them, and offers Undo after', async () => {
    const api = client(plan({ acknowledgementsRequired: ['replace'], summary: { create: 0, replace: 1, keepBoth: 0, skip: 0, fail: 0, total: 1 } }))
    await choose(api)
    await waitFor(() => expect(screen.getByText('Items you have are replaced')).toBeTruthy())
    const importButton = screen.getByRole('button', { name: /^Import/ }) as HTMLButtonElement
    expect(importButton.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(importButton.disabled).toBe(false)
    await act(async () => {
      fireEvent.click(importButton)
    })
    expect(api.apply).toHaveBeenCalledWith('job-1', ['replace'])
    await waitFor(() => expect(screen.getByText(/1 item created/)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Undo the import' })).toBeTruthy()
  })

  it('says why a file is not a package before anything is sent', async () => {
    const api = client(plan({}))
    const view = render(<OrgPackageImport client={api} onDone={() => undefined} />)
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['not json'], 'p.json')] } })
    })
    await waitFor(() => expect(screen.getByText(/not JSON/)).toBeTruthy())
    expect(api.plan).not.toHaveBeenCalled()
  })
})
