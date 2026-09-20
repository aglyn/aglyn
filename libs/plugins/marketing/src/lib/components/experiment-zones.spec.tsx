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
 * The two zones the A/B testing card hosts (AGL-2914), and the thing that
 * matters most about them: a workspace with no widget for either must get the
 * card it had before they existed.
 *
 * That is not a nicety. The widget that fills them is behind a release flag
 * that is OFF, so every workspace in production is the empty case, and a zone
 * that drew a heading, a divider or an empty `<div>` would ship a visible
 * change to a feature nobody turned on. So the empty case is asserted as
 * MARKUP EQUALITY against the same card with the zones rendering nothing,
 * rather than by looking for text that is not there.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

const experimentDocs = [
  {
    $id: 'exp-1',
    name: 'Subject line',
    status: 'running',
    target: 'email',
    variants: [
      { id: 'a', name: 'A (control)', weight: 1, subject: 'Your quote', body: 'As it stands.' },
      { id: 'b', name: 'B', weight: 1 },
    ],
    goal: { event: 'formSubmission' },
  },
]

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({ data: [], status: 'success', fromCache: false }),
  usePagedCollection: () => ({
    rows: experimentDocs,
    hasMore: false,
    page: 0,
    setPage: jest.fn(),
    pageSize: 10,
    setPageSize: jest.fn(),
    status: 'success',
    fromCache: false,
  }),
  useHostActivityLogger: () => jest.fn(),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance').writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, _hosts: string, _id: string, name: string) => name,
  query: (name: string) => name,
  limit: () => undefined,
  orderBy: () => undefined,
  doc: () => ({}),
  deleteDoc: jest.fn(),
  getDocs: jest.fn().mockResolvedValue({ forEach: () => undefined }),
  setDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn().mockResolvedValue(undefined) }),
}))

import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import {
  EXPERIMENT_RESULT_ZONE,
  EXPERIMENT_VARIANTS_ZONE,
  ExperimentResultZone,
  ExperimentVariantsZone,
  marketingExperimentVariantDrafts,
  type MarketingExperimentVariantsZoneProps,
} from './experiment-zones'
import HostExperimentsCard from './host-experiments-card.component'

const ORG = { plan: 'business' } as never

/** A shell whose renderer draws nothing, which is a workspace with no widget for the zone. */
const Silent = () => null

/** A shell whose renderer reports the zone it was asked for and what it was handed. */
const zoneProps: Record<string, Record<string, unknown>> = {}
function Loud({ slot, ...rest }: { slot: string } & Record<string, unknown>) {
  zoneProps[slot] = rest
  return <div data-testid={`widget:${slot}`}>{`widget for ${slot}`}</div>
}

function withShell(
  renderer: typeof Silent | typeof Loud | null,
  children: ReactNode,
): ReactNode {
  return renderer ? (
    <ConsoleWidgetSlotContext.Provider value={renderer}>{children}</ConsoleWidgetSlotContext.Provider>
  ) : (
    children
  )
}

/**
 * The card with one of its dialogs open, as the markup a workspace actually
 * gets. The whole document body, because a dialog renders into a portal and
 * a zone inside one is therefore not in the card's own container.
 *
 * One at a time: the two dialogs are modals, and a click on the button that
 * opens the second never reaches it through the first.
 */
async function cardWith(
  dialog: 'results' | 'editor',
  renderer: typeof Silent | typeof Loud | null,
) {
  // Through the library's own cleanup, so the dialog's portal and the
  // aria-hidden it puts on everything behind it go with the card.
  cleanup()
  render(withShell(renderer, <HostExperimentsCard hostId="host-1" org={ORG} />))
  if (dialog === 'results') {
    const grid = screen.getByRole('grid', { name: 'Experiments' })
    const row = within(grid).getByText('Subject line').closest('[role="row"]') as HTMLElement
    fireEvent.click(within(row).getByText('Subject line'))
  } else {
    fireEvent.click(screen.getByRole('button', { name: 'New experiment' }))
  }
  await screen.findByRole('dialog')
  // React allocates `useId` values in render order across the whole file, so
  // two renders of the same tree differ in them and in nothing else. They are
  // not markup either side controls, and normalizing them is what makes the
  // comparison below about the zone.
  return document.body.innerHTML.replace(/_r_[0-9a-z]+_/g, '_id_')
}

beforeEach(() => {
  jest.clearAllMocks()
  for (const key of Object.keys(zoneProps)) delete zoneProps[key]
})

describe('a workspace with no widget for either zone', () => {
  it('renders nothing where there is no console shell at all', () => {
    const variants = render(
      <ExperimentVariantsZone
        hostId="host-1"
        experimentId="exp-1"
        name="Subject line"
        target="email"
        goal="formSubmission"
        variants={[]}
        proposeVariants={jest.fn()}
      />,
    )
    expect(variants.container.innerHTML).toBe('')
    const result = render(
      <ExperimentResultZone hostId="host-1" experimentId="exp-1" test="Subject line" />,
    )
    expect(result.container.innerHTML).toBe('')
  })

  it.each(['results', 'editor'] as const)(
    'gives the A/B testing card’s %s dialog the same markup, byte for byte, as one whose zone draws nothing',
    async (dialog) => {
      const outsideTheShell = await cardWith(dialog, null)
      const noWidget = await cardWith(dialog, Silent)
      // The zone contributes no wrapper, no heading and no whitespace of its
      // own: a workspace without the widget cannot tell it is there.
      expect(outsideTheShell).toBe(noWidget)
    },
  )
})

describe('a workspace that has a widget', () => {
  it('draws it below one test’s figures, and names that test as the results reader does', async () => {
    const withWidget = await cardWith('results', Loud)
    expect(withWidget).toContain('widget for experimentResult')
    expect(zoneProps[EXPERIMENT_RESULT_ZONE.id]).toEqual({
      hostId: 'host-1',
      experimentId: 'exp-1',
      test: 'Subject line',
    })
  })

  it('draws it beneath the variants it writes for, and says when the test is new', async () => {
    const withWidget = await cardWith('editor', Loud)
    expect(withWidget).toContain('widget for experimentVariants')
    // A new experiment has no id yet, and the zone says so rather than
    // handing a widget an id that names nothing.
    expect(zoneProps[EXPERIMENT_VARIANTS_ZONE.id]).toEqual({
      hostId: 'host-1',
      experimentId: '',
      name: '',
      target: 'screen',
      goal: 'formSubmission',
      variants: [
        { id: 'a', name: 'A (control)', subject: '', body: '' },
        { id: 'b', name: 'B', subject: '', body: '' },
      ],
      proposeVariants: expect.any(Function),
    })
  })

  it('fills the editor’s own variants from a proposal, and adds, drops and reorders none', async () => {
    render(withShell(Loud, <HostExperimentsCard hostId="host-1" org={ORG} />))
    const grid = screen.getByRole('grid', { name: 'Experiments' })
    const row = within(grid).getByText('Subject line').closest('[role="row"]') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'More actions for Subject line' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    await screen.findByRole('dialog')

    const zone = zoneProps[EXPERIMENT_VARIANTS_ZONE.id] as unknown as MarketingExperimentVariantsZoneProps
    expect(zone.variants).toEqual([
      { id: 'a', name: 'A (control)', subject: 'Your quote', body: 'As it stands.' },
      { id: 'b', name: 'B', subject: '', body: '' },
    ])

    zone.proposeVariants(
      [
        // The control's copy proposed back EMPTY, which is what a page test's
        // proposal looks like: it must leave the editor's own fields alone
        // rather than blank what the person typed.
        { id: 'a', name: 'A (control)', subject: '', body: '' },
        { id: 'b', name: 'B — the date', subject: 'Your quote is ready', body: 'Shorter.' },
        // A third the editor does not have: the test's shape is the person's.
        { id: 'c', name: 'C', subject: 'Never', body: 'Never' },
      ],
      'job-1',
    )

    await waitFor(() =>
      expect((screen.getByLabelText('Variant B') as HTMLInputElement).value).toBe('B — the date'),
    )
    const subjects = () => screen.getAllByLabelText('Subject override') as HTMLInputElement[]
    const bodies = () => screen.getAllByLabelText('Body override') as HTMLInputElement[]
    expect((screen.getByLabelText('Variant A') as HTMLInputElement).value).toBe('A (control)')
    expect(subjects()[1].value).toBe('Your quote is ready')
    expect(bodies()[1].value).toBe('Shorter.')
    // The control keeps the copy it had, which the proposal did not rewrite.
    expect(subjects()[0].value).toBe('Your quote')
    expect(bodies()[0].value).toBe('As it stands.')
    // And the arm the editor never had is nowhere: two variants, still two.
    expect(subjects()).toHaveLength(2)
    expect(screen.queryByDisplayValue('Never')).toBeNull()
  })
})

describe('the pieces', () => {
  it('hands over each variant’s copy, and an empty string where it has none', () => {
    expect(
      marketingExperimentVariantDrafts([
        { id: 'a', name: 'A', weight: 2, subject: 'Hi', body: 'There', versionId: 'v-1' },
        { id: 'b' },
      ]),
    ).toEqual([
      // The weight and the pinned version are the test's shape, not copy, so
      // they are not in a widget's hands at all.
      { id: 'a', name: 'A', subject: 'Hi', body: 'There' },
      { id: 'b', name: '', subject: '', body: '' },
    ])
    expect(marketingExperimentVariantDrafts(undefined)).toEqual([])
  })
})
