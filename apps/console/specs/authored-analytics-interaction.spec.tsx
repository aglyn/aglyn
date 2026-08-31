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
 * Besigner-authored analytics events, from the picker to the stored document
 * (AGL-1587).
 *
 * Two defects, one feature, and the second is why the first was invisible.
 *
 * 1. `trackGaEvent` is an ADVANCED client step, so
 *    `compileClientAutomations` trims it out of the published payload for a
 *    site without the `actions` entitlement. The picker offered it to every
 *    site regardless: an author on Free picked "Track an analytics event",
 *    typed a name, saved, published — and nothing ever fired, with nothing
 *    anywhere saying it would not.
 * 2. The step could only ever carry a NAME. `site-runtime.tsx` reads
 *    `step.params`, and the editor had no way to write one, which is most of
 *    what a custom event exists for.
 *
 * The compile-side trim and the runtime delivery are proved in the marketing
 * plugin's own suites (`compile-client-automations.spec.ts`,
 * `site-runtime.spec.tsx`); a console spec may not import a plugin. What is
 * proved here is the console half of the same chain — that the step reaches
 * storage in the shape those suites consume, and that the picker tells the
 * truth about whether it will run.
 */

import * as Aglyn from '@aglyn/aglyn'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { buildInteractionCandidate } from '../components/interaction-builder-doc'

/** Swapped per case: the plan the owning org resolves to, and its readiness. */
const orgPlan: { org: unknown; ready: boolean } = {
  org: { plan: 'free' },
  ready: true,
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useHostResourceApi: () => jest.fn(),
  useOrgPlan: () => orgPlan,
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

/**
 * The REAL entitlement model, the REAL validator, the REAL step predicates —
 * only the canvas is doubled, and only because it is a live editor store with
 * no document mounted here.
 *
 * Everything the assertions turn on is a pure function over a plan document
 * or a step: `checkEntitlement`, `isClientStepEntitled`,
 * `planLabelGrantingFeature`, `validateHostAction`. A double answering a
 * constant for any of them would make this suite agree with itself and with
 * nothing that ships — which is the exact failure mode the feature had.
 */
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  canvas: { toJSON: () => ({ nodes: {} }) },
}))

/**
 * Required rather than imported at the top: the doubles above are hoisted
 * over the import list, and reading the dialog through `require` keeps the
 * order the mocks depend on visible instead of implied.
 */
const {
  InteractionBuilderDialog,
} = require('../components/interaction-builder-dialog.component') as {
  InteractionBuilderDialog: (props: Record<string, unknown>) => ReactNode
}

const NODE_ID = 'node-1'
const SELECTOR = `[data-aglyn="leaf:${NODE_ID}"]`

/** An existing interaction whose only step is the authored analytics one. */
const analyticsAction = (params?: Record<string, string>) => ({
  name: 'Track the CTA',
  trigger: { event: 'elementClick', selector: SELECTOR },
  steps: [
    {
      type: 'trackGaEvent',
      eventName: 'cta_click',
      ...(params ? { params } : {}),
    },
  ],
  enabled: true,
})

const renderDialog = (
  overrides: Record<string, unknown> = {},
): { onSave: jest.Mock } => {
  const onSave = jest.fn().mockResolvedValue(true)
  render(
    <InteractionBuilderDialog
      hostId="host-1"
      state={{ id: 'node:node-1:i1', nodeId: NODE_ID, event: 'elementClick' }}
      existing={analyticsAction()}
      existingFromCache={false}
      onSave={onSave}
      onClose={jest.fn()}
      {...overrides}
    />,
  )
  return { onSave }
}

/** The step-type picker's options, as the author sees them when it is open. */
const openActionPicker = (): HTMLElement[] => {
  fireEvent.mouseDown(screen.getAllByLabelText('Action')[0])
  return screen.getAllByRole('option') as HTMLElement[]
}

const option = (label: string): HTMLElement =>
  openActionPicker().find((entry) =>
    (entry.textContent ?? '').startsWith(label),
  ) as HTMLElement

/** jest-dom is not set up in this project — read the attribute directly. */
const isDisabled = (element: HTMLElement): boolean =>
  element.getAttribute('aria-disabled') === 'true'

/** The dialog's confirm button, whichever label it is wearing. */
const saveButton = (): HTMLButtonElement =>
  screen.getByText('Save').closest('button') as HTMLButtonElement

describe('the analytics step reaches storage with its parameters (AGL-1587)', () => {
  it('serializes name AND params into the node interaction the runtime consumes', () => {
    const candidate = buildInteractionCandidate({
      name: 'Track the CTA',
      event: 'elementClick',
      selector: SELECTOR,
      frequency: 'every',
      cooldownMinutes: 60,
      steps: [
        {
          type: 'trackGaEvent',
          eventName: 'cta_click',
          params: { plan: 'starter', placement: 'hero' },
          // The action-type reset's fan of undefined siblings, which a single
          // one of would reject the whole write.
          className: undefined,
          message: undefined,
          menuNodeId: undefined,
        },
      ],
    })

    expect(candidate.steps).toEqual([
      {
        type: 'trackGaEvent',
        eventName: 'cta_click',
        params: { plan: 'starter', placement: 'hero' },
      },
    ])
    expect(Aglyn.validateHostAction(candidate)).toBeNull()

    /**
     * The provider's node-scoped save (AGL-1478) drops the selector and adds
     * the id; `collectNodeInteractions` derives the selector back at compose
     * time. Written out rather than asserted on the candidate alone, because
     * the params travel through BOTH hops and a spread that lost them at
     * either one would still leave the candidate above correct.
     */
    const { trigger, ...rest } = candidate as unknown as Record<string, any>
    const { selector: _dropped, ...triggerWithoutSelector } = trigger
    const [collected] = Aglyn.collectNodeInteractions([
      {
        $id: NODE_ID,
        interactions: [
          { ...rest, id: 'i1', trigger: triggerWithoutSelector } as never,
        ],
      },
    ])

    expect(collected.action.trigger.selector).toBe(SELECTOR)
    expect(collected.action.steps).toEqual([
      {
        type: 'trackGaEvent',
        eventName: 'cta_click',
        params: { plan: 'starter', placement: 'hero' },
      },
    ])
    // The shape the marketing compiler and runtime suites consume, asserted
    // at this seam so the two halves of the chain cannot drift apart.
    expect(Aglyn.isClientActionStep(collected.action.steps[0])).toBe(true)
    expect(
      Aglyn.isClientStepEntitled(collected.action.steps[0], {
        actionsEntitled: true,
        allowJs: false,
      }),
    ).toBe(true)
  })

  it('refuses a parameter the runtime would strip, naming it', () => {
    // The author-facing half of the sanitizer: the runtime drops this
    // parameter and says nothing, because it is running for a visitor.
    const problem = Aglyn.validateHostAction(
      buildInteractionCandidate({
        name: 'Track the CTA',
        event: 'elementClick',
        selector: SELECTOR,
        frequency: 'every',
        cooldownMinutes: 60,
        steps: [
          {
            type: 'trackGaEvent',
            eventName: 'quote_requested',
            params: { plan: 'pro', contact: 'buyer@example.com' },
          },
        ],
      }) as never,
    )

    expect(problem).toMatch(/"contact"/)
    expect(problem).toMatch(/never sent/)
  })

  it('accepts the same step once the address-shaped value is gone', () => {
    // The CONTROL. Without it, a validator that refused EVERY analytics step
    // — a typo in the branch, a `params` read that always found something to
    // strip — would pass the case above for entirely the wrong reason.
    expect(
      Aglyn.validateHostAction(
        buildInteractionCandidate({
          name: 'Track the CTA',
          event: 'elementClick',
          selector: SELECTOR,
          frequency: 'every',
          cooldownMinutes: 60,
          steps: [
            {
              type: 'trackGaEvent',
              eventName: 'quote_requested',
              params: { plan: 'pro', contact: 'sales team' },
            },
          ],
        }) as never,
      ),
    ).toBeNull()
  })
})

describe('the builder is honest about the plan that will run the step (AGL-577)', () => {
  afterEach(() => {
    orgPlan.org = { plan: 'free' }
    orgPlan.ready = true
  })

  it('disables the analytics option and names the plan that carries it', () => {
    renderDialog()

    const analytics = option('Track an analytics event')
    expect(isDisabled(analytics)).toBe(true)
    // The plan is named where the choice is made, not in a document nobody
    // opens. `planLabelGrantingFeature` is derived from PLAN_ENTITLEMENTS on
    // every call, so this cannot name a tier that stopped carrying it.
    expect(analytics.textContent).toContain(
      Aglyn.planLabelGrantingFeature('actions'),
    )
  })

  it('leaves the basic steps selectable in the same open picker', () => {
    // The CONTROL for the case above. A picker that disabled every option —
    // a gate that answered false for anything, an `orgReady` read inverted —
    // would satisfy the assertion above completely.
    renderDialog()

    expect(isDisabled(option('Open/close a menu'))).toBe(false)
  })

  it('offers the analytics option to a site whose plan carries it', () => {
    orgPlan.org = { plan: Aglyn.planGrantingFeature('actions') }
    renderDialog()

    expect(isDisabled(option('Track an analytics event'))).toBe(false)
  })

  it('claims nothing while the plan document is still in flight', () => {
    // AGL-1380's trap, in the one place it would be least visible.
    // `checkEntitlement(undefined)` resolves the FREE tier rather than
    // "unknown", so a gate that read it before the org doc settled would tell
    // a paying site its plan cannot run a step it pays for — for a render or
    // two on every open of this dialog.
    orgPlan.org = undefined
    orgPlan.ready = false
    renderDialog()

    expect(isDisabled(option('Track an analytics event'))).toBe(false)
    expect(screen.queryByText(/the published page skips it/)).toBeNull()
  })

  it('explains an already-authored step the plan will not run', () => {
    // The option is disabled, not removed, so a step authored before a
    // downgrade — or before this gate existed — still renders as the field's
    // value. This notice is the only place it can say what will happen to it.
    renderDialog()

    const notice = screen.getByText(/the published page skips it/)
    expect(notice.textContent).toContain(
      Aglyn.planLabelGrantingFeature('actions'),
    )
    // Saved, never lost: it starts running the moment the plan carries it.
    expect(notice.textContent).toMatch(/saves the step/)
  })
})

describe('the analytics parameters editor (AGL-1587)', () => {
  afterEach(() => {
    orgPlan.org = { plan: 'free' }
    orgPlan.ready = true
  })

  const typeParam = (key: string, value: string) => {
    fireEvent.click(screen.getByText('Add parameter'))
    fireEvent.change(screen.getByLabelText('Parameter'), {
      target: { value: key },
    })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value } })
  }

  it('writes an authored pair into the saved step', async () => {
    const { onSave } = renderDialog()

    typeParam('plan', 'starter')
    fireEvent.click(saveButton())

    expect(onSave).toHaveBeenCalled()
    expect((onSave.mock.calls[0][0] as any).steps[0]).toEqual({
      type: 'trackGaEvent',
      eventName: 'cta_click',
      params: { plan: 'starter' },
    })
  })

  it('blocks the save on a parameter the runtime would strip', () => {
    renderDialog()

    typeParam('email', 'buyer@example.com')

    expect(saveButton().disabled).toBe(true)
    expect(screen.getByText(/"email"/)).toBeTruthy()
  })

  it('leaves the save available for a benign pair', () => {
    // The CONTROL. The dialog disables Save for any validation problem at
    // all, including the ones the seeded step already had, so "disabled"
    // proves nothing until "enabled" is shown for the same shape.
    renderDialog()

    typeParam('plan', 'starter')

    expect(saveButton().disabled).toBe(false)
  })
})
