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

import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  PUBLISHER_ATTESTATION,
  requiredAttestationIds,
} from '@aglyn/aglyn/app-utils/publisher-attestation'

/**
 * The publish form (AGL-969 checklist, AGL-1076 subject, AGL-1078 page).
 *
 * The server is the gate — it decides which attestation items are required
 * from whether a listing already exists, and refuses with 428. What this
 * covers is the half the server cannot: that the form actually BLOCKS on
 * the always-required items rather than merely displaying them, that what
 * it sends is the set of ids the publisher ticked, and that the draft it
 * restores does NOT include the bundle. A checklist that renders but
 * submits regardless, and a draft that looks complete but has no bytes,
 * are the two failures this guards against.
 */

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { getIdToken: async () => 'token' } }),
}))

// The README uses the shared MarkdownField, which offers a DAM picker
// (AGL-1080). The picker's own behaviour is not what this spec covers, and
// rendering it would drag the whole media library into a form test.
jest.mock('../components/media/media-picker-dialog.component', () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))

import PublishPluginForm from '../components/marketplace/publish-plugin-form.component'

const ALWAYS_REQUIRED = requiredAttestationIds(false)

/** The publish button, whatever label it is currently wearing. */
function publishButton(): HTMLButtonElement {
  const button = screen
    .getAllByRole('button')
    .find((entry) =>
      /Publish plugin|Publish privately|Confirm \d+ more|Choose a bundle|Add a repository URL/.test(
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

const REPO_URL = 'https://github.com/acme/widget'

/** Fill the repository field — the subject of the `repository` item. */
function fillRepository(value = REPO_URL) {
  fireEvent.change(
    screen.getByPlaceholderText('https://github.com/acme/widget'),
    { target: { value } },
  )
}

describe('PublishPluginForm (AGL-969 / AGL-1076 / AGL-1078)', () => {
  const open = () => render(<PublishPluginForm orgId="org-1" orgSlug="acme" />)
  /**
   * The same form under Strict Mode, which double-invokes effects.
   * Restoring the draft in an effect while a second effect persisted every
   * change lost the draft exactly here — the persist pass wrote the still
   * empty state back over storage before the restore applied, and the
   * re-run then restored that. It passed in plain render() and vanished in
   * a real browser, so the draft assertions run under Strict Mode.
   */
  const openStrict = () =>
    render(
      <StrictMode>
        <PublishPluginForm orgId="org-1" orgSlug="acme" />
      </StrictMode>,
    )

  beforeEach(() => {
    ;(global as { fetch?: unknown }).fetch = jest.fn()
    mockPush.mockClear()
    window.localStorage.clear()
  })

  it('renders every attestation item', () => {
    open()
    for (const item of PUBLISHER_ATTESTATION) {
      expect(screen.getByText(item.label)).toBeTruthy()
    }
  })

  /**
   * The README gets the real editor (AGL-1080).
   *
   * It was a four-row textarea, while the listing detail editor one
   * navigation away used the full markdown editor for the same field — so
   * the FIRST time a publisher wrote the document reviewers read first
   * they got the worst tool we have. Asserting the mode switch rather than
   * copy: it only exists on the shared MarkdownField, so a regression to a
   * plain textarea fails here.
   */
  it('gives the README the markdown editor, not a bare textarea', () => {
    open()
    expect(screen.getByRole('button', { name: 'Visual editor' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Markdown source' })).toBeTruthy()
  })

  it('blocks publishing until the always-required items are confirmed', () => {
    open()
    expect(publishButton().disabled).toBe(true)
    // A bundle alone is not enough — this is the regression that matters,
    // because before AGL-969 a chosen file was the only gate.
    chooseBundle()
    expect(publishButton().disabled).toBe(true)

    for (const id of ALWAYS_REQUIRED) tick(id)
    // Still blocked: the repository item is confirmed but its subject is
    // empty, which is the AGL-1076 failure — a claim about nothing.
    expect(publishButton().disabled).toBe(true)
    fillRepository()
    expect(publishButton().disabled).toBe(false)
  })

  it('does not demand the update-only item from a first submission', () => {
    open()
    const updateOnly = PUBLISHER_ATTESTATION.filter((item) => item.updateOnly)
    expect(updateOnly.length).toBeGreaterThan(0)
    chooseBundle()
    fillRepository()
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
    fillRepository()
    fireEvent.change(screen.getByPlaceholderText(/"id": "acme-widget"/), {
      target: {
        value: JSON.stringify({
          id: 'acme-widget',
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
    expect(body.repositoryUrl).toBe(REPO_URL)
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
    fillRepository()
    fireEvent.change(screen.getByPlaceholderText(/"id": "acme-widget"/), {
      target: {
        value: JSON.stringify({
          id: 'acme-widget',
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

  /**
   * The draft (AGL-1078). A page can survive a reload; a modal could not.
   * The one thing it must NOT survive is the bundle — a File cannot be
   * serialized, and a draft that restores every field except the bytes
   * would let a publisher believe they were republishing what they left
   * with.
   */
  describe('draft', () => {
    it('restores typed fields on remount but never the bundle', () => {
      const first = openStrict()
      fillRepository()
      fireEvent.change(screen.getByLabelText(/Listing name/), {
        target: { value: 'Widget' },
      })
      chooseBundle()
      for (const id of ALWAYS_REQUIRED) tick(id)
      expect(publishButton().disabled).toBe(false)
      first.unmount()

      openStrict()
      expect(
        (screen.getByLabelText(/Listing name/) as HTMLInputElement).value,
      ).toBe('Widget')
      // The ticks came back, and the bundle did not — so the button is
      // blocked on the file rather than pretending the draft is complete.
      expect(publishButton().disabled).toBe(true)
      expect(publishButton().textContent).toMatch(/Choose a bundle/)
      expect(screen.getByText(/not saved — choose them again/)).toBeTruthy()
    })

    it('does not announce a restore on an untouched form', () => {
      // The persist effect runs on mount, so an untouched visit leaves an
      // EMPTY draft behind. Without a content check the next first visit
      // greets a publisher with "picked up where you left off" over a form
      // nobody has typed in — and a notice that cries wolf is one they will
      // ignore on the visit it matters.
      const first = openStrict()
      first.unmount()

      openStrict()
      expect(screen.queryByText(/not saved — choose them again/)).toBeNull()
    })

    it('is cleared by Discard draft', () => {
      const first = open()
      fireEvent.change(screen.getByLabelText(/Listing name/), {
        target: { value: 'Widget' },
      })
      fireEvent.click(screen.getByRole('button', { name: /Discard draft/ }))
      first.unmount()

      open()
      expect(
        (screen.getByLabelText(/Listing name/) as HTMLInputElement).value,
      ).toBe('')
    })
  })
})
