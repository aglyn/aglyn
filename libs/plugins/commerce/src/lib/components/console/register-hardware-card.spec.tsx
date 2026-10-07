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

const NOW = Date.now()
const collections: Record<string, Array<Record<string, unknown>>> = {
  printers: [],
  printJobs: [],
  registers: [],
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: (build: () => unknown) => ({ data: collections[build() as string] ?? [] }),
  useUser: () => ({ data: { uid: 'manager' } }),
}))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => segments[segments.length - 1],
  query: (name: string) => name,
  where: () => null,
  orderBy: () => null,
  limit: () => null,
}))
const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar }) }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: (props: any) => (
    <section>
      <h2>{props.header}</h2>
      {props.HeaderProps?.action}
      {props.children}
    </section>
  ),
  useConfirmationContext: () => ({ confirm: () => Promise.resolve() }),
}))
jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => null }))
const authorizedFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => authorizedFetch(...args),
}))

import { printerSetupSteps, RegisterHardwareCard, RegisterHardwareCards, seenAgo } from './register-hardware-card.component'

const ok = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
const PRINTERS = '/api/commerce/printers'
const printerCalls = () => authorizedFetch.mock.calls.filter((call) => call[1] === PRINTERS)
const sent = () => printerCalls().map((call) => JSON.parse(call[2].body))

beforeEach(() => {
  authorizedFetch.mockReset()
  enqueueSnackbar.mockReset()
  collections['printers'] = []
  collections['printJobs'] = []
  collections['registers'] = []
})

describe('the register Hardware card (AGL-3619)', () => {
  it('says what pairing a printer gives when there is none', () => {
    render(<RegisterHardwareCard hostId="h1" registerId="r1" registerName="Front" />)
    expect(screen.getByText('Hardware · Front')).toBeTruthy()
    expect(screen.getByText(/Pair a Star CloudPRNT or Epson Server Direct Print printer/)).toBeTruthy()
  })

  it('shows each printer’s live status, and a printer that stopped polling as offline', () => {
    collections['printers'] = [
      {
        $id: 'p1', name: 'Counter', brand: 'star', model: 'mC-Print3', deviceId: 'x', registerId: 'r1',
        autoPrintReceipts: true, kickDrawer: true, secretVersion: 1, createdAtMs: 1,
        status: { state: 'paper_low', atMs: NOW - 5000, detail: '211 Paper low' },
      },
      {
        $id: 'p2', name: 'Kitchen', brand: 'epson', deviceId: 'k', registerId: 'r1',
        autoPrintReceipts: false, kickDrawer: false, secretVersion: 1, createdAtMs: 2,
        status: { state: 'online', atMs: NOW - 60 * 60 * 1000 },
      },
    ]
    render(<RegisterHardwareCard hostId="h1" registerId="r1" registerName="Front" />)
    expect(screen.getByText('Paper low')).toBeTruthy()
    expect(screen.getByText('Offline')).toBeTruthy()
    // Only the printer with a drawer offers to open one.
    expect(screen.getAllByRole('button', { name: 'Open drawer' })).toHaveLength(1)
  })

  it('sends a test print and an open-drawer through the printers API', async () => {
    collections['printers'] = [
      { $id: 'p1', name: 'Counter', brand: 'star', deviceId: 'x', registerId: 'r1', autoPrintReceipts: true, kickDrawer: true, secretVersion: 1, createdAtMs: 1 },
    ]
    authorizedFetch.mockImplementation(() => ok({ jobId: 'j1' }))
    render(<RegisterHardwareCard hostId="h1" registerId="r1" registerName="Front" />)
    fireEvent.click(screen.getByRole('button', { name: 'Test print' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open drawer' }))
    await waitFor(() => expect(printerCalls()).toHaveLength(2))
    expect(sent()).toEqual([
      { hostId: 'h1', action: 'test', printerId: 'p1' },
      { hostId: 'h1', action: 'drawer', printerId: 'p1' },
    ])
  })

  it('adds a printer and then shows the URL to paste into it, with the setup steps', async () => {
    authorizedFetch.mockImplementation(() =>
      ok({ printerId: 'p9', brand: 'star', pollUrl: 'https://console.test/api/commerce/cloudprnt/h1/p9/abc', deviceId: '00:11:62:ab:cd:ef' }),
    )
    render(<RegisterHardwareCard hostId="h1" registerId="r1" registerName="Front" />)
    fireEvent.click(screen.getByRole('button', { name: 'Add printer' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Counter' } })
    fireEvent.change(within(dialog).getByLabelText('MAC address'), { target: { value: '00:11:62:ab:cd:ef' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add printer' }))
    expect(await screen.findByDisplayValue('https://console.test/api/commerce/cloudprnt/h1/p9/abc')).toBeTruthy()
    expect(sent()[0]).toMatchObject({
      action: 'create',
      registerId: 'r1',
      brand: 'star',
      name: 'Counter',
      deviceId: '00:11:62:ab:cd:ef',
      autoPrintReceipts: true,
      kickDrawer: true,
      paperWidthMm: 80,
    })
    expect(screen.getByText(/Settings → CloudPRNT/)).toBeTruthy()
  })

  it('lists recent jobs, and offers Cancel only for one the printer has not taken', () => {
    collections['printers'] = [
      { $id: 'p1', name: 'Counter', brand: 'star', deviceId: 'x', registerId: 'r1', autoPrintReceipts: true, kickDrawer: false, secretVersion: 1, createdAtMs: 1 },
    ]
    collections['printJobs'] = [
      { $id: 'j1', printerId: 'p1', kind: 'receipt', status: 'queued', receipt: { orderNumber: '1042' }, attempts: 0, createdAtMs: NOW, deliverByMs: NOW },
      { $id: 'j2', printerId: 'p1', kind: 'test', status: 'done', attempts: 1, createdAtMs: NOW, deliverByMs: NOW },
    ]
    render(<RegisterHardwareCard hostId="h1" registerId="r1" registerName="Front" />)
    expect(screen.getByText(/Receipt #1042/)).toBeTruthy()
    expect(screen.getByText('Printed')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1)
  })

  it('renders one card per register, and nothing without registers', () => {
    const { container, rerender } = render(<RegisterHardwareCards hostId="h1" />)
    expect(container.textContent).toBe('')
    collections['registers'] = [
      { $id: 'r2', name: 'Patio' },
      { $id: 'r1', name: 'Front' },
    ]
    rerender(<RegisterHardwareCards hostId="h1" />)
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Hardware · Front',
      'Hardware · Patio',
    ])
  })

  it('words the time since a printer last polled', () => {
    expect(seenAgo(undefined, NOW)).toBe('never')
    expect(seenAgo(NOW - 10_000, NOW)).toBe('just now')
    expect(seenAgo(NOW - 5 * 60_000, NOW)).toBe('5 min ago')
    expect(printerSetupSteps('epson').join(' ')).toMatch(/Server Direct Print/)
  })
})
