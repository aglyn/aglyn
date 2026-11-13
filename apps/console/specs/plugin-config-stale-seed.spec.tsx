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
 * The per-plugin settings form must go through `writeGuardedBySeed`, and be
 * refused under all THREE of its signals (AGL-1449).
 *
 * This card hand-rolled the guard: two inline early-return `if`s covering
 * `fromCache` and `session-health`, and nothing for `unreadable`. That gap is
 * not cosmetic. `useFirestoreDoc` clears `data` to `undefined` when a listen
 * goes terminal, and this form's seeding effect runs on any status that is not
 * `loading` — so a failed read seeds `mergePluginConfig(schema, null)`, which
 * is EVERY field at its schema default. The save then wrote that whole object
 * with `merge: true`, and `merge` protects nothing when the payload carries
 * every key. One toggle against a refused read reset every other setting the
 * workspace had ever configured for that plugin to its default, and reported
 * "Settings saved".
 *
 * So all three signals are asserted here, not just the one the inline version
 * happened to cover — that selectivity is the whole failure mode a hand-rolled
 * guard has. The stale-session case is driven through the real console wiring
 * (`setStaleSessionCheck` + `reportDeniedRead`) rather than a stub, because the
 * injected third signal is the one a call site can silently lose.
 *
 * The refusal copy is asserted to be the GUARD's, and explicitly not the
 * card's old string. Porting the string is what produced this issue; a call
 * site carrying its own words is a call site that has stopped tracking the
 * guard.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setSeedConfirmWaitMs } from '@aglyn/tenant-feature-instance/hooks/helpers/listen-confirmation'
import type { ReactNode } from 'react'
import {
  __resetSessionHealth,
  getSessionHealth,
  reportDeniedRead,
} from '../utils/session-health'

/** The whole-object payload the guard exists to keep off the wire. */
const SCHEMA = {
  pluginId: 'analytics',
  fields: [
    { key: 'enabled', type: 'boolean', label: 'Enabled', default: false },
    { key: 'trackingId', type: 'string', label: 'Tracking id', default: '' },
    { key: 'sampleRate', type: 'number', label: 'Sample rate', default: 100 },
  ],
}

/** Mutable so each spec picks the settings listener's verdict before render. */
const mockSettingsDoc = {
  data: { enabled: true, trackingId: 'UA-REAL', sampleRate: 25 } as
    | Record<string, unknown>
    | undefined,
  status: 'success' as 'success' | 'error' | 'loading',
  fromCache: false,
}

const mockSetDoc = jest.fn().mockResolvedValue(undefined)
const mockEnqueueSnackbar = jest.fn()

jest.mock('@aglyn/aglyn', () => ({
  FIRST_PARTY_PLUGINS: [{ id: 'analytics', label: 'Analytics' }],
  listPluginConfigSchemas: () => [SCHEMA],
  // Faithful to the real helper in the one respect this spec turns on: the
  // result carries EVERY declared field, seeded value or schema default.
  mergePluginConfig: (
    schema: typeof SCHEMA,
    stored: Record<string, unknown> | null,
  ) =>
    Object.fromEntries(
      schema.fields.map((field) => [
        field.key,
        stored?.[field.key] ?? field.default,
      ]),
    ),
  validatePluginConfigValues: () => ({ ok: true }),
}))

jest.mock('firebase/firestore', () => ({
  doc: () => ({}),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-admin' } }),
  useFirestoreDoc: () => ({
    data: mockSettingsDoc.data,
    status: mockSettingsDoc.status,
    fromCache: mockSettingsDoc.fromCache,
  }),
  // The REAL guard. A stub would let the write through whatever the card
  // passed it, which is the one thing this spec disproves.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('../constants/docs-links', () => ({ docsHelp: () => ({}) }))

// The holder's answer; the gate itself is `plugin-config-org-settings-gate.spec.tsx`.
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({ loaded: true, can: () => true }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PluginConfigCards =
  require('../components/plugin-config-card.component').default

/**
 * The console's own wiring, not a stub: `firebase-app.layout` registers
 * exactly this at module scope, and it is the only way the third signal can
 * reach the guard.
 */
const instance = jest.requireActual('@aglyn/tenant-feature-instance')

beforeAll(() => {
  instance.setStaleSessionCheck(() => getSessionHealth().staleSession)
})
afterAll(() => {
  instance.setStaleSessionCheck(null)
})

beforeEach(() => {
  jest.clearAllMocks()
  __resetSessionHealth()
  mockSettingsDoc.data = { enabled: true, trackingId: 'UA-REAL', sampleRate: 25 }
  mockSettingsDoc.status = 'success'
  mockSettingsDoc.fromCache = false
})

/** A keystroke is what makes the form dirty; Save is dead until then. */
const editAndSave = () => {
  fireEvent.change(screen.getByLabelText('Tracking id'), {
    target: { value: 'UA-EDITED' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
}

/** Two DISTINCT collections denied inside the window — the real threshold. */
const killTheSession = () => {
  reportDeniedRead('orgs/org-1/pluginSettings')
  reportDeniedRead('hosts/host-1/screens')
}

// This spec pins the refusal, not the wait before it (AGL-4120).
beforeAll(() => setSeedConfirmWaitMs(0))
afterAll(() => setSeedConfirmWaitMs())

describe('PluginConfigCard seed guard (AGL-1449)', () => {
  /**
   * The first press is never refused for a late server (AGL-4047). Save is
   * HELD while the read is the cache's, with the reason beside it, rather
   * than pressed into a wait that ends refused; the guard below still wraps
   * the write for a read that falls back to the cache after this rendered.
   */
  it('KEEPS a Save pressed, with the reason beside it, while the read is unconfirmed', async () => {
    mockSettingsDoc.fromCache = true
    render(<PluginConfigCards orgId="org-1" pluginId="analytics" />)

    fireEvent.change(screen.getByLabelText('Tracking id'), {
      target: { value: 'UA-EDITED' },
    })
    // Held, yet pressable: the reason shows and Save takes the press.
    expect(screen.getByRole('status').textContent).toBe(
      'Checking your plugin settings with the server…',
    )
    const save = screen.getByRole('button', {
      name: 'Save settings',
    }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(mockSetDoc).not.toHaveBeenCalled()
    // Kept, not dropped (AGL-4047): no confirmation came within the
    // guard's wait (0 in this spec), so the press ends in the guard's refusal.
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        expect.stringMatching(/could not confirm your .+ with the server yet, so nothing was saved/),
        expect.anything(),
      ),
    )
    // What was typed stays.
    expect((screen.getByLabelText('Tracking id') as HTMLInputElement).value).toBe(
      'UA-EDITED',
    )
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    )
  })

  /**
   * The half that keeps the guard's protection while Save is held. The edit
   * is replayed onto what the server confirms: a field the reader never
   * touched is saved as the server has it, never as the cache had it.
   */
  it('saves the edit onto the values the server confirmed, on the first press', async () => {
    mockSettingsDoc.fromCache = true
    const { rerender } = render(
      <PluginConfigCards orgId="org-1" pluginId="analytics" />,
    )
    editAndSave()

    // Since the cached snapshot, another admin changed the sample rate.
    mockSettingsDoc.data = { enabled: true, trackingId: 'UA-REAL', sampleRate: 75 }
    mockSettingsDoc.fromCache = false
    rerender(<PluginConfigCards orgId="org-1" pluginId="analytics" />)

    expect(screen.queryByRole('status')).toBeNull()
    expect((screen.getByLabelText('Tracking id') as HTMLInputElement).value).toBe(
      'UA-EDITED',
    )
    // The press made during the hold was kept (AGL-4047): it saves now, on
    // its own, with the edit replayed onto the confirmed values.
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    const [, payload] = mockSetDoc.mock.calls[0]
    expect(payload.trackingId).toBe('UA-EDITED')
    expect(payload.sampleRate).toBe(75)
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith('Settings saved', {
        variant: 'success',
      }),
    )
  })

  /**
   * The signal the inline version never had. Before AGL-1449 this wrote every
   * field at its schema default over the stored document and said "Settings
   * saved".
   */
  it('REFUSES when the settings read FAILED, and says so differently', async () => {
    mockSettingsDoc.status = 'error'
    mockSettingsDoc.data = undefined
    render(<PluginConfigCards orgId="org-1" pluginId="analytics" />)

    editAndSave()

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockSetDoc).not.toHaveBeenCalled()
    expect(mockEnqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/could not be loaded/i),
    )
  })

  it('REFUSES when the SESSION is stale, through the injected check', async () => {
    killTheSession()
    expect(getSessionHealth().staleSession).toBe(true)
    render(<PluginConfigCards orgId="org-1" pluginId="analytics" />)

    editAndSave()

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockSetDoc).not.toHaveBeenCalled()
    const [message] = mockEnqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringMatching(/session went stale/i))
    // Number-neutral, per AGL-1446 — the subject here is plural.
    expect(message).toEqual(
      expect.stringContaining('so your plugin settings may be out of date'),
    )
  })

  it('SAVES once the server has confirmed the seed', async () => {
    render(<PluginConfigCards orgId="org-1" pluginId="analytics" />)

    editAndSave()

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    const [, payload, options] = mockSetDoc.mock.calls[0]
    expect(payload.trackingId).toBe('UA-EDITED')
    // The untouched fields ride along off the seed — which is why `merge`
    // protects nothing here, and why the guard has to stand in front.
    expect(payload.enabled).toBe(true)
    expect(payload.sampleRate).toBe(25)
    expect(options).toEqual({ merge: true })
  })
})
