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
 *
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  PUBLISHER_ATTESTATION,
  requiredAttestationIds,
} from '@aglyn/aglyn/app-utils/publisher-attestation'

/**
 * The publisher pre-submission checklist, in the dialog (AGL-969).
 *
 * The server is the gate — it decides which items are required from whether
 * a listing already exists, and refuses with 428. What this covers is the
 * half the server cannot: that the dialog actually BLOCKS on the always-
 * required items rather than merely displaying them, and that what it sends
 * is the set of ids the publisher ticked. A checklist that renders but
 * submits regardless is the failure this guards against.
 */

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { getIdToken: async () => 'token' } }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

import UploadPluginDialog from '../components/marketplace/upload-plugin-dialog.component'

const ALWAYS_REQUIRED = requiredAttestationIds(false)

/** The publish button, whatever label it is currently wearing. */
function publishButton(): HTMLButtonElement {
  const button = screen
    .getAllByRole('button')
    .find((entry) =>
      /Publish plugin|Publish privately|Confirm \d+ more/.test(
        entry.textContent ?? '',
      ),
    )
  if (!button) throw new Error('publish button not found')
  return button as HTMLButtonElement
}

/**
 * A bundle file jsdom can actually read. jsdom's File has no
 * `arrayBuffer()`, and the dialog base64-encodes the bytes before it ever
 * reaches fetch — without this the submit path dies in its catch and the
 * assertion below would be measuring the polyfill, not the checklist.
 */
function bundleFile(): File {
  const file = new File(['export function register() {}'], 'p.js')
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode('export function register() {}').buffer,
  })
  return file
}

function chooseBundle() {
  fireEvent.change(
    document.querySelector(
      'input[type="file"][accept*="javascript"]',
    ) as HTMLInputElement,
    { target: { files: [bundleFile()] } },
  )
}

function tick(id: string) {
  const item = PUBLISHER_ATTESTATION.find((entry) => entry.id === id)
  if (!item) throw new Error(`unknown attestation ${id}`)
  fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(item.label.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }))
}

describe('UploadPluginDialog attestation (AGL-969)', () => {
  const open = () =>
    render(
      <UploadPluginDialog orgId="org-1" open onClose={() => undefined} />,
    )

  beforeEach(() => {
    ;(global as { fetch?: unknown }).fetch = jest.fn()
  })

  it('renders every attestation item', () => {
    open()
    for (const item of PUBLISHER_ATTESTATION) {
      expect(screen.getByText(item.label)).toBeTruthy()
    }
  })

  it('blocks publishing until the always-required items are confirmed', () => {
    open()
    expect(publishButton().disabled).toBe(true)
    // A bundle alone is not enough — this is the regression that matters,
    // because before AGL-969 a chosen file was the only gate.
    chooseBundle()
    expect(publishButton().disabled).toBe(true)

    for (const id of ALWAYS_REQUIRED) tick(id)
    expect(publishButton().disabled).toBe(false)
  })

  it('does not demand the update-only item from a first submission', () => {
    open()
    const updateOnly = PUBLISHER_ATTESTATION.filter((item) => item.updateOnly)
    expect(updateOnly.length).toBeGreaterThan(0)
    chooseBundle()
    for (const id of ALWAYS_REQUIRED) tick(id)
    // Enabled with the update-only box untouched: the server decides that
    // one, because only it knows whether a listing already exists.
    expect(publishButton().disabled).toBe(false)
  })

  it('sends the ticked ids to the publish API', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ version: '1.0.0' }),
    })
    ;(global as { fetch?: unknown }).fetch = fetchMock
    open()
    chooseBundle()
    fireEvent.change(screen.getByPlaceholderText(/"id": "acme.widget"/), {
      target: {
        value: JSON.stringify({
          id: 'acme.widget',
          name: 'Widget',
          version: '1.0.0',
          entry: 'index.js',
        }),
      },
    })
    for (const id of ALWAYS_REQUIRED) tick(id)
    fireEvent.click(publishButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect([...body.attestation].sort()).toEqual([...ALWAYS_REQUIRED].sort())
  })

  it('surfaces the item the server says is missing', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 428,
      json: async () => ({
        error: 'Confirm the pre-submission checklist before publishing: …',
        missingAttestations: ['changelog'],
      }),
    })
    ;(global as { fetch?: unknown }).fetch = fetchMock
    open()
    chooseBundle()
    fireEvent.change(screen.getByPlaceholderText(/"id": "acme.widget"/), {
      target: {
        value: JSON.stringify({
          id: 'acme.widget',
          name: 'Widget',
          version: '1.0.1',
          entry: 'index.js',
        }),
      },
    })
    for (const id of ALWAYS_REQUIRED) tick(id)
    fireEvent.click(publishButton())

    await waitFor(() =>
      expect(
        screen.getByText(/already has a published version/),
      ).toBeTruthy(),
    )
  })
})
