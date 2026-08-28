/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
 * A site follows its workspace until it says otherwise — and can say so back.
 *
 * The two failures this guards are both silent, and they are opposites:
 *
 *  1. A site stops inheriting. It happens the moment the form saves the WHOLE
 *     resolved config instead of the keys the site answered: every field
 *     becomes an override pinned to whatever the workspace held that day, and
 *     a later workspace change reaches every site except the ones an operator
 *     has opened.
 *  2. A site's clear is discarded. `setDoc(…, {merge: true})` leaves a field
 *     the payload omits exactly as it is, so a form that stops sending a key
 *     cannot clear anything by saving. The chip flips to "Inherited", the
 *     snackbar says "Settings saved", and the stored override is still there
 *     — the site goes on ignoring a workspace value that has since moved.
 *
 * Neither raises anything, and neither is visible from the page it affects.
 * So these tests drive the real form and read the PAYLOAD, not the render: it
 * is the write that is wrong in both cases.
 */

import { registerPluginConfigSchema } from '@aglyn/aglyn'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

/** The `deleteField()` sentinel, identifiable in a captured payload. */
const mockDeleteSentinel = { __sentinel: 'deleteField' }

const mockSetDocCalls: Array<{
  path: string
  data: Record<string, unknown>
  options: unknown
}> = []

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  deleteField: () => mockDeleteSentinel,
  setDoc: async (
    ref: { path: string },
    data: Record<string, unknown>,
    options: unknown,
  ) => {
    mockSetDocCalls.push({ path: ref.path, data, options })
  },
}))

/** The mockDocuments the fake listener serves, keyed by path. */
const mockDocuments = new Map<string, Record<string, unknown>>()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1' } }),
  useFirestoreDoc: (buildRef: () => { path: string } | null) => {
    const ref = buildRef()
    // A null ref is the AGL-1440 "scope not known yet" state, and the hook's
    // contract there is `'loading'` with no data — which is what the form
    // must not seed from.
    if (!ref) return { data: undefined, status: 'loading', fromCache: false }
    return {
      data: mockDocuments.get(ref.path),
      status: 'success',
      fromCache: false,
    }
  },
  // The real guard, minus its session heuristic: every seed here is served
  // server-confirmed, so it would pass through anyway, and stubbing it keeps
  // the assertions about inheritance rather than about staleness.
  writeGuardedBySeed: async (
    _options: unknown,
    write: () => Promise<void>,
  ) => {
    await write()
    return { ok: true }
  },
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({
    header,
    children,
  }: {
    header: ReactNode
    children: ReactNode
  }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
}))

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

jest.mock('../constants/docs-links', () => ({
  __esModule: true,
  docsHelp: () => undefined,
}))

const PluginConfigCards =
  require('../components/plugin-config-card.component').default

const PLUGIN = 'bookings-inheritance-spec'
const ORG_PATH = `orgs/org-1/pluginSettings/${PLUGIN}`
const HOST_PATH = `hosts/host-1/pluginSettings/${PLUGIN}`

registerPluginConfigSchema({
  pluginId: PLUGIN,
  fields: [
    {
      key: 'horizonDays',
      label: 'Booking horizon',
      type: 'number',
      min: 1,
      max: 365,
    },
    { key: 'timeZone', label: 'Time zone', type: 'string' },
  ],
  defaults: { horizonDays: 60, timeZone: 'UTC' },
})

const renderSiteForm = () =>
  render(
    <PluginConfigCards orgId="org-1" hostId="host-1" pluginId={PLUGIN} />,
  )

const horizonInput = () =>
  screen.getByLabelText('Booking horizon') as HTMLInputElement

/** The one `setDoc` this suite's saves produce. */
const savedPayload = () => {
  expect(mockSetDocCalls).toHaveLength(1)
  expect(mockSetDocCalls[0].path).toBe(HOST_PATH)
  return mockSetDocCalls[0].data
}

const save = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Save site settings' }))
  await waitFor(() => expect(mockSetDocCalls.length).toBeGreaterThan(0))
}

beforeEach(() => {
  mockSetDocCalls.length = 0
  mockEnqueueSnackbar.mockClear()
  mockDocuments.clear()
})

describe('what the site form shows', () => {
  it('THE CONTROL: the workspace value, marked inherited, with no site document', () => {
    /*
     * Every assertion below is worth something only because this proves the
     * form reaches the workspace layer at all. A form that rendered schema
     * defaults here would satisfy several of the tests that follow.
     */
    mockDocuments.set(ORG_PATH, { horizonDays: 90 })
    renderSiteForm()
    expect(horizonInput().value).toBe('90')
    expect(screen.getAllByText('Inherited').length).toBeGreaterThan(0)
    expect(screen.queryByText('Set for this site')).toBeNull()
  })

  it('names the workspace value even where the site has overridden it', () => {
    // "Inherited or not" is half the answer. An operator deciding whether to
    // keep an override needs to see what they would be going back to, and
    // finding out by clearing it is not an affordance.
    mockDocuments.set(ORG_PATH, { horizonDays: 90 })
    mockDocuments.set(HOST_PATH, { horizonDays: 365 })
    renderSiteForm()
    expect(horizonInput().value).toBe('365')
    expect(screen.getByText('Set for this site')).toBeTruthy()
    expect(screen.getByText('Workspace: 90')).toBeTruthy()
  })
})

describe('a site that answers for itself', () => {
  it('writes ONLY the key it answered, so the rest keep following', async () => {
    /*
     * The whole inheritance model lives on this assertion. Writing the
     * resolved config would store `timeZone` too — pinned to today's
     * workspace value — and the next workspace change would reach every site
     * except this one, with nothing on either page saying so.
     */
    mockDocuments.set(ORG_PATH, { horizonDays: 90, timeZone: 'America/Chicago' })
    renderSiteForm()
    fireEvent.change(horizonInput(), { target: { value: '365' } })
    await save()
    const payload = savedPayload()
    expect(payload.horizonDays).toBe(365)
    expect('timeZone' in payload).toBe(false)
  })
})

describe('a site that goes back to following the workspace', () => {
  it('DELETES the field rather than writing an empty value', async () => {
    /*
     * The trap, stated as an assertion. `merge: true` treats an omitted key
     * as "unchanged" and an empty string as a value, so neither omitting the
     * key nor blanking it clears anything — the override survives and the
     * page reports success. Only a field delete returns a key to inherited.
     */
    mockDocuments.set(ORG_PATH, { horizonDays: 90 })
    mockDocuments.set(HOST_PATH, { horizonDays: 365 })
    renderSiteForm()
    fireEvent.click(
      screen.getByRole('button', { name: 'Use workspace value' }),
    )
    await save()
    const payload = savedPayload()
    expect(payload.horizonDays).toBe(mockDeleteSentinel)
    // Spelled out, because each of these is a way the fix could be written
    // and still not clear anything.
    expect(payload.horizonDays).not.toBe('')
    expect(payload.horizonDays).not.toBeUndefined()
    expect('horizonDays' in payload).toBe(true)
  })

  it('writes the delete under the LITERAL key the readers address', async () => {
    /*
     * `setDoc` with `merge` treats a dotted key as a literal field name —
     * only `updateDoc` reads it as a path — so a nested store would need the
     * delete buried in a nested object (the AGL-1608 fix). This store is
     * flat: `mergePluginConfig` and `pluginConfigOverrides` both address it
     * as `stored[field.key]`, so the delete has to address it the same way,
     * and a "helpful" nesting pass would delete nothing while reporting
     * success.
     */
    mockDocuments.set(ORG_PATH, { horizonDays: 90 })
    mockDocuments.set(HOST_PATH, { horizonDays: 365 })
    renderSiteForm()
    fireEvent.click(
      screen.getByRole('button', { name: 'Use workspace value' }),
    )
    await save()
    expect(Object.keys(savedPayload())).toContain('horizonDays')
  })

  it('THE CONTROL: never deletes a key the site had not overridden', async () => {
    /*
     * The other half of the same write. If a save emitted `deleteField()` for
     * every non-overridden key it would pass the test above while writing a
     * delete for fields the site never touched — and, on a document another
     * admin had just written, that is destruction rather than a no-op.
     */
    mockDocuments.set(ORG_PATH, { horizonDays: 90, timeZone: 'America/Chicago' })
    mockDocuments.set(HOST_PATH, { horizonDays: 365 })
    renderSiteForm()
    fireEvent.click(
      screen.getByRole('button', { name: 'Use workspace value' }),
    )
    await save()
    expect('timeZone' in savedPayload()).toBe(false)
  })
})

describe('the workspace form is unchanged by all of this', () => {
  it('writes the whole config to the ORG document, with no host read', async () => {
    /*
     * One component now serves both scopes, and the workspace form is the one
     * with users today. It stores an ANSWER for every field — there is no
     * level above it to inherit from — which is exactly the behavior the site
     * form must not have.
     */
    mockDocuments.set(ORG_PATH, { horizonDays: 90, timeZone: 'America/Chicago' })
    render(<PluginConfigCards orgId="org-1" pluginId={PLUGIN} />)
    fireEvent.change(horizonInput(), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(mockSetDocCalls.length).toBeGreaterThan(0))
    expect(mockSetDocCalls[0].path).toBe(ORG_PATH)
    expect(mockSetDocCalls[0].data).toMatchObject({
      horizonDays: 120,
      timeZone: 'America/Chicago',
    })
    expect(screen.queryByText('Inherited')).toBeNull()
  })
})
