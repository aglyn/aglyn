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
 * The legacy `hosts/{host}/actions` and `experiments` listeners, held at a
 * STABLE empty result on purpose. A listener that emits again rebuilds the
 * context memo as a side effect and hides the defect — which is exactly how
 * this survived in production, where the panel did eventually populate
 * whenever an unrelated snapshot happened to land after the canvas.
 */
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: () => ({ data: undefined, fromCache: false }),
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
