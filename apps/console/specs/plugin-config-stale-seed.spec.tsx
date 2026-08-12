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

describe('PluginConfigCard seed guard (AGL-1449)', () => {
  it('REFUSES a save seeded from an unconfirmed read', async () => {
    mockSettingsDoc.fromCache = true
    render(<PluginConfigCards orgId="org-1" pluginId="analytics" />)

    editAndSave()

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockSetDoc).not.toHaveBeenCalled()
    const [message] = mockEnqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('plugin settings'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // AGL-1446's remedy reaches this call site now, which it could not while
    // the card carried its own copy.
    expect(message).toEqual(expect.stringMatching(/new browser tab/i))
    // And it is the guard's words, not the card's old ones.
    expect(message).not.toEqual(
      expect.stringContaining('These settings have not been confirmed'),
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
