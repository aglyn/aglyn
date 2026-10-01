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
 * The Interactions panel lists what the selected ELEMENT actually carries.
 *
 * A besigner document is not in the canvas when its providers mount — the
 * version document is a Firestore read, so the canvas fills a second or more
 * later. Every interaction in this list therefore arrives AFTER the first
 * render, which makes "does the list survive the canvas being filled" the
 * only question worth asking about it.
 *
 * Measured on the production editor before this was fixed: the canvas held
 * its 223 nodes six seconds after load and the context this provider
 * publishes still carried an empty list twenty-one seconds later — long
 * enough that an author selecting the element that owns a mega menu is simply
 * told it has none. Being an `observer` is not enough on its own, which is
 * the trap: MobX tracks what a render READS, and a `useMemo` whose
 * dependencies have not changed is not re-run, so a list built inside one
 * keeps serving the empty canvas it was built over.
 *
 * The REAL canvas singleton drives this, deliberately. A stub would have to
 * model MobX's tracking to be worth anything here, and modelling the thing
 * under test is how a defect gets reported green.
 */

import { canvas, nodeInteractionSelector } from '@aglyn/aglyn'
import { InteractionsContext } from '@aglyn/besigner-ui'
import { act, render, screen } from '@testing-library/react'
import { useContext } from 'react'
import InteractionsProvider from '../components/interactions-provider.component'

/**
 * Every value these hand back is a SINGLETON, and that is load-bearing rather
 * than tidiness: each one is a dependency of the context memo, so a double
 * that mints a fresh object per call rebuilds that memo on every render and
 * reports the defect under test green.
 */
jest.mock('@aglyn/tenant-feature-instance', () => {
  const firestore = {}
  const createResource = jest.fn()
  return {
    useFirestore: () => firestore,
    useHostResourceApi: () => createResource,
  }
})

jest.mock('@aglyn/shared-ui-snackstack', () => {
  const snackbar = { enqueueSnackbar: jest.fn() }
  return { useSnackbar: () => snackbar }
})

/**
 * The context and the selector helper are REAL — they are what the panel
 * filters on, and a stubbed selector would let the list be published under
 * an element that does not exist. The rest of the besigner-ui barrel is a
 * canvas editor this spec never renders.
 */
jest.mock('@aglyn/besigner-ui', () => {
  const contexts = jest.requireActual(
    '../../../libs/besigner/feature/designer/src/lib/contexts/interactions-context',
  )
  return {
    InteractionsContext: contexts.InteractionsContext,
    nodeElementSelector: contexts.nodeElementSelector,
  }
})

/**
 * The legacy `hosts/{host}/actions` listener, held at a STABLE empty result
 * on purpose. A listener that emits again rebuilds the context memo as a side
 * effect and hides the defect — which is exactly how this survived in
 * production, where the panel did eventually populate whenever an unrelated
 * snapshot happened to land after the canvas.
 */
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: () => ({ data: undefined, fromCache: false }),
}))

/**
 * The `besignerInteractions` zone, as the plugin in it sees it: the props the
 * provider hands over, kept so a case can report through them. Its gates are
 * `PluginWidgetSlot`'s, held by `plugin-widget-slot-zones.spec.tsx`.
 */
let mockZoneProps: Record<string, any> | null = null
jest.mock('../components/plugin-widget-slot.component', () => ({
  __esModule: true,
  default: (props: Record<string, any>) => {
    mockZoneProps = props
    return null
  },
}))

/** The builder dialog only ever renders on a click; nothing here clicks. */
jest.mock('../components/interaction-builder-dialog.component', () => ({
  __esModule: true,
  default: () => null,
  PickModeBanner: () => null,
}))

const NODE_ID = 'stack-with-menu'

/** The mega-menu shape the marketing site's Site nav component carries. */
const NODES = {
  '_@_': {
    $id: '_@_',
    componentId: 'div',
    parentId: null,
    nodes: [NODE_ID],
  },
  [NODE_ID]: {
    $id: NODE_ID,
    componentId: 'muiStack',
    parentId: '_@_',
    nodes: [],
    interactions: [
      {
        id: 'open',
        name: 'Dropdown panel — open on hover',
        enabled: true,
        trigger: { event: 'elementHoverEnter' },
        steps: [],
      },
    ],
  },
} as never

function Consumer() {
  const interactions = useContext(InteractionsContext)
  return (
    <ul data-testid="automations">
      {(interactions.automations ?? []).map((automation) => (
        <li key={automation.id}>{automation.selector}</li>
      ))}
    </ul>
  )
}

/** What the section lists of section experiments, and whether it offers one. */
function ExperimentsConsumer() {
  const interactions = useContext(InteractionsContext)
  return (
    <div>
      <ul data-testid="experiments">
        {(interactions.sectionExperiments ?? []).map((experiment) => (
          <li key={experiment.id}>{`${experiment.id}@${experiment.nodeId}`}</li>
        ))}
      </ul>
      {interactions.onCreateSectionExperiment ? (
        <button
          type="button"
          onClick={() =>
            interactions.onCreateSectionExperiment?.({ nodeId: NODE_ID })
          }
        >
          start
        </button>
      ) : null}
    </div>
  )
}

function listed() {
  return [...screen.getByTestId('automations').children].map(
    (item) => item.textContent,
  )
}

describe('InteractionsProvider over a canvas that fills after mount', () => {
  beforeEach(() => {
    act(() => {
      canvas.reset()
    })
  })

  afterEach(() => {
    act(() => {
      canvas.reset()
    })
  })

  it('publishes an interaction that arrives with the document', () => {
    render(
      <InteractionsProvider hostId="host-1">
        <Consumer />
      </InteractionsProvider>,
    )

    // The document has not loaded. Nothing to list, and nothing wrong yet.
    expect(listed()).toEqual([])

    // …and now it lands, which is the ordinary case rather than an edge one.
    act(() => {
      canvas.setNodes(NODES)
    })

    // The selector is what the per-element panel filters on, so listing the
    // interaction under the wrong one would be no better than dropping it.
    expect(listed()).toEqual([nodeInteractionSelector(NODE_ID)])
  })

  it('drops one the author removes from a node', () => {
    render(
      <InteractionsProvider hostId="host-1">
        <Consumer />
      </InteractionsProvider>,
    )
    act(() => {
      canvas.setNodes(NODES)
    })
    expect(listed()).toHaveLength(1)

    act(() => {
      const node = canvas.getNode(NODE_ID)
      canvas.updateNodeFields(node as never, { interactions: [] } as never)
    })

    expect(listed()).toEqual([])
  })
})

describe('InteractionsProvider and the plugin that runs section experiments', () => {
  beforeEach(() => {
    mockZoneProps = null
  })

  const experiments = () =>
    [...screen.getByTestId('experiments').children].map((item) => item.textContent)

  it('hosts the zone with the site and the page, and lists what a plugin reports', () => {
    render(
      <InteractionsProvider hostId="host-1" screenId="screen-1">
        <ExperimentsConsumer />
      </InteractionsProvider>,
    )
    expect(mockZoneProps).toMatchObject({
      slot: 'besignerInteractions',
      hostId: 'host-1',
      screenId: 'screen-1',
    })
    // Nothing reported yet: no experiment, and nothing offered to start one.
    expect(experiments()).toEqual([])
    expect(screen.queryByRole('button', { name: 'start' })).toBeNull()

    const create = jest.fn()
    act(() => {
      mockZoneProps?.['reportSectionExperiments']('runner', {
        experiments: [{ id: 'exp-1', nodeId: NODE_ID, status: 'draft' }],
        create,
      })
    })
    expect(experiments()).toEqual([`exp-1@${NODE_ID}`])

    act(() => {
      screen.getByRole('button', { name: 'start' }).click()
    })
    expect(create).toHaveBeenCalledWith({ nodeId: NODE_ID })

    // A withdrawn report takes its experiments and its offer with it.
    act(() => {
      mockZoneProps?.['reportSectionExperiments']('runner', null)
    })
    expect(experiments()).toEqual([])
    expect(screen.queryByRole('button', { name: 'start' })).toBeNull()
  })

  it('offers no experiment to start where the document is not a page', () => {
    render(
      <InteractionsProvider hostId="host-1">
        <ExperimentsConsumer />
      </InteractionsProvider>,
    )
    expect(mockZoneProps).toMatchObject({ screenId: null })
    act(() => {
      mockZoneProps?.['reportSectionExperiments']('runner', {
        experiments: [{ id: 'exp-1', nodeId: NODE_ID }],
        create: jest.fn(),
      })
    })
    // The badge still shows — the element is the same node on every page —
    // but a layout is no page for an experiment to run on.
    expect(experiments()).toEqual([`exp-1@${NODE_ID}`])
    expect(screen.queryByRole('button', { name: 'start' })).toBeNull()
  })

  it('hosts no zone on a document that runs no client code', () => {
    render(
      <InteractionsProvider hostId="host-1" screenId="screen-1" disabled>
        <ExperimentsConsumer />
      </InteractionsProvider>,
    )
    expect(mockZoneProps).toBeNull()
  })
})
