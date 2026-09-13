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
 * "Scroll to element" and "Play a video" in the interaction builder
 * (AGL-2867), from the picker to the stored step.
 *
 * The runtime half — what the visitor's page does with these steps — is
 * proved in the marketing plugin's `site-runtime.spec.tsx` and the Video
 * element's own suite; a console spec may not import a plugin. What is proved
 * here is that the dialog writes the shape those suites consume, on every
 * plan, and that it says so when a "Play a video" step points at something
 * that is not a video.
 */

import * as Aglyn from '@aglyn/aglyn'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useHostResourceApi: () => jest.fn(),
  // Free: both steps are basic, so a Free site is the plan to prove them on.
  useOrgPlan: () => ({ org: { plan: 'free' }, ready: true }),
  writeGuardedBySeed: jest.fn(),
}))

jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: () => ({ data: [] }),
}))

jest.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  limit: () => undefined,
  doc: () => ({}),
  setDoc: jest.fn(),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  HelpTip: () => null,
}))

jest.mock('@aglyn/besigner', () => ({
  pick: {
    isPicking: () => false,
    getHint: () => null,
    startPick: jest.fn(),
    cancelPick: jest.fn(),
    nodeElementLabel: (id: string) => id,
  },
}))

jest.mock('@aglyn/besigner-ui', () => ({
  nodeElementSelector: (id: string) => `[data-aglyn="leaf:${id}"]`,
}))

/** The canvas the dialog reads, swapped per case. */
const canvasNodes: { current: Record<string, unknown> } = { current: {} }

/**
 * The real validator, step predicates and entitlement model; only the canvas
 * store and the component registry are doubled, because both are live editor
 * state with no document mounted here.
 */
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  canvas: { toJSON: () => ({ nodes: canvasNodes.current }) },
  components: {
    getSchema: (componentId: string) =>
      ({ muiButton: { displayName: 'Button' }, video: { displayName: 'Video' } })[
        componentId
      ],
  },
}))

const {
  InteractionBuilderDialog,
} = require('../components/interaction-builder-dialog.component') as {
  InteractionBuilderDialog: (props: Record<string, unknown>) => ReactNode
}

const BUTTON = 'cta-1'
const leaf = (id: string) => `[data-aglyn="leaf:${id}"]`

const node = (componentId: string) => ({ componentId, props: {} })

const renderDialog = (steps: Array<Record<string, unknown>>) => {
  const onSave = jest.fn().mockResolvedValue(true)
  render(
    <InteractionBuilderDialog
      hostId="host-1"
      state={{ id: `node:${BUTTON}:i1`, nodeId: BUTTON, event: 'elementClick' }}
      existing={{
        name: 'Watch the demo',
        trigger: { event: 'elementClick', selector: leaf(BUTTON) },
        steps,
        enabled: true,
      }}
      existingFromCache={false}
      onSave={onSave}
      onClose={jest.fn()}
    />,
  )
  return { onSave }
}

const options = (label: string): HTMLElement[] => {
  fireEvent.mouseDown(screen.getAllByLabelText(label)[0])
  return screen.getAllByRole('option') as HTMLElement[]
}

const choose = (label: string, optionText: string) => {
  const match = options(label).find((entry) =>
    (entry.textContent ?? '').startsWith(optionText),
  )
  fireEvent.click(match as HTMLElement)
}

const saveButton = (): HTMLButtonElement =>
  screen.getByText('Save').closest('button') as HTMLButtonElement

const savedSteps = (onSave: jest.Mock) =>
  (onSave.mock.calls[0][0] as { steps: unknown[] }).steps

beforeEach(() => {
  canvasNodes.current = {
    [BUTTON]: node('muiButton'),
    'film-1': node('video'),
    'section-1': node('muiStack'),
  }
})

describe('Scroll to element (AGL-2867)', () => {
  it('is offered, and selectable on every plan', () => {
    renderDialog([{ type: 'siteAlert', message: 'hi' }])
    const offered = options('Action')
    for (const label of ['Scroll to element', 'Play a video']) {
      const entry = offered.find((option) => option.textContent === label)
      expect(entry).toBeTruthy()
      expect(entry?.getAttribute('aria-disabled')).not.toBe('true')
    }
  })

  it('keeps the picked target and stores how and where to stop', () => {
    const { onSave } = renderDialog([
      { type: 'showElement', selector: leaf('section-1') },
    ])
    choose('Action', 'Scroll to element')
    choose('Scroll', 'Instantly')
    fireEvent.change(screen.getByLabelText('Offset (px)'), {
      target: { value: '72' },
    })
    fireEvent.click(saveButton())

    expect(savedSteps(onSave)).toEqual([
      {
        type: 'scrollTo',
        selector: leaf('section-1'),
        behavior: 'instant',
        offsetPx: 72,
      },
    ])
    expect(Aglyn.validateHostAction(onSave.mock.calls[0][0])).toBeNull()
  })

  it('stores nothing for the defaults: smooth, no offset', () => {
    const { onSave } = renderDialog([
      { type: 'showElement', selector: leaf('section-1') },
    ])
    choose('Action', 'Scroll to element')
    fireEvent.click(saveButton())
    expect(savedSteps(onSave)).toEqual([
      { type: 'scrollTo', selector: leaf('section-1') },
    ])
  })

  it('refuses an offset outside the band before it can be saved', () => {
    renderDialog([{ type: 'scrollTo', selector: leaf('section-1') }])
    fireEvent.change(screen.getByLabelText('Offset (px)'), {
      target: { value: String(Aglyn.SCROLL_TO_MAX_OFFSET_PX + 1) },
    })
    expect(saveButton().disabled).toBe(true)
    expect(screen.getByText(/the offset must be/)).toBeTruthy()
  })
})

describe('Play a video (AGL-2867)', () => {
  it('starts on the one Video on the canvas, and stores it', () => {
    const { onSave } = renderDialog([{ type: 'siteAlert', message: 'hi' }])
    choose('Action', 'Play a video')
    // The chip names the picked element; the double labels it by id.
    expect(screen.getByText('film-1')).toBeTruthy()
    expect(screen.queryByText(/is not a Video/)).toBeNull()
    fireEvent.click(saveButton())
    expect(savedSteps(onSave)).toEqual([
      { type: 'playVideo', selector: leaf('film-1') },
    ])
  })

  it('says so when the target is not a Video, and does not guess between two', () => {
    canvasNodes.current = {
      ...canvasNodes.current,
      'film-2': node('video'),
    }
    renderDialog([{ type: 'siteAlert', message: 'hi' }])
    choose('Action', 'Play a video')
    // Two films: the step keeps this element rather than picking one.
    expect(screen.getByText('This element')).toBeTruthy()
    expect(
      screen.getByText(/Button is not a Video, so this step has nothing to play/),
    ).toBeTruthy()
  })

  it('points at the Media group when the canvas has no Video at all', () => {
    canvasNodes.current = { [BUTTON]: node('muiButton') }
    renderDialog([{ type: 'playVideo', selector: leaf(BUTTON) }])
    expect(screen.getByText(/add one from the Media group/)).toBeTruthy()
  })

  it('does not second-guess a custom selector', () => {
    renderDialog([{ type: 'playVideo', selector: '.hero video' }])
    expect(screen.queryByText(/is not a Video/)).toBeNull()
  })
})
