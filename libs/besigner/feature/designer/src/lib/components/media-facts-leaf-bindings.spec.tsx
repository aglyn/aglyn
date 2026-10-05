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
 * The layout chrome around a page draws site variables and functions as the
 * published page resolves them (AGL-3480).
 *
 * A page's Besigner draws its layout through `MediaFactsLeaf`, not the
 * editable `NodeLeaf`, and that leaf filled in host tokens but never
 * `{{var:…}}` or `{{fn:…}}`. A header's phone number therefore drew as
 * `{{var:L03fATT870}}` on the page while the layout's own Besigner, and the
 * published page, drew the number.
 *
 * Every expectation is measured against the published page's own composition
 * — `resolveNodesBindings`, then `resolveNodesHostTokens` — over the same
 * stored props, never against a copy of what it is expected to say.
 */

import * as Aglyn from '@aglyn/aglyn'
import { AglynNodeRenderer } from '@aglyn/aglyn-node-renderer'
import {
  deleteBesignerApp,
  getBesignerApp,
  initializeBesignerApp,
  setBesignerFlag,
} from '@aglyn/besigner'
import { act, render } from '@testing-library/react'
import { forwardRef, type ReactNode } from 'react'

import { BesignerAppProvider } from '../contexts/besigner-app-context'
import BindingPickerContext from '../contexts/binding-picker-context'
import { CanvasHostTokensProvider } from '../contexts/canvas-host-tokens-context'
import { useLayoutChromeCanvas } from '../contexts/layout-chrome-context'
import { MediaFactsLeaf } from './node-leaf'

const APP = 'media-facts-leaf-bindings'
const PROBE = 'bindingTokenProbe'

const PHONE_ID = 'L03fATT870'
const TAGLINE_ID = 'tG7line0Ab'
const QUOTE_FN_ID = 'qT9fnAbC12'

/**
 * The site's variables and functions as the console hands them to the binding
 * picker: keyed by name AND by id, each carrying its id as `$id`.
 */
const PHONE = {
  $id: PHONE_ID,
  name: 'phone',
  type: 'text',
  value: '(555) 010-2030',
} as const
const TAGLINE = {
  $id: TAGLINE_ID,
  name: 'tagline',
  type: 'text',
  value: 'Built right, the first time',
} as const
const QUOTE = {
  $id: QUOTE_FN_ID,
  name: 'Quote',
  parameters: [{ name: 'sqft', type: 'number', required: true }],
  variables: [{ name: 'total', type: 'number' }],
  operations: [
    {
      if: { left: 'sqft', comparator: '>=', right: 'sqft' },
      then: [{ set: 'total', expression: 'sqft * 2' }],
      otherwise: [],
    },
  ],
  returnValue: 'total',
}
const VARIABLES = {
  phone: PHONE,
  [PHONE_ID]: PHONE,
  tagline: TAGLINE,
  [TAGLINE_ID]: TAGLINE,
} as unknown as Record<string, Aglyn.HostVariable>
const FUNCTIONS = {
  Quote: QUOTE,
  [QUOTE_FN_ID]: QUOTE,
} as unknown as Record<string, Aglyn.HostFunction>

const SITE: Aglyn.HostTokenSource = {
  displayName: 'edr-construction',
  subdomain: 'edr-construction',
  seo: { entity: { name: 'EDR Construction' } },
}

/** The header as the layout stores it: every token kind a prop can hold. */
const HEADER_PROPS = {
  children: 'Call {{var:L03fATT870}}',
  title: '{{var:tG7line0Ab}}',
  ariaLabel: '{{host.businessName}} — {{var:L03fATT870}}',
  subtitle: 'From ${{fn:qT9fnAbC12(100)}}',
}

/** Props each probe received, by the leaf's `data-aglyn` id. */
const mockReceived = new Map<string, Record<string, unknown>>()

const Probe = forwardRef<HTMLDivElement, Record<string, any>>((props, ref) => {
  const { children, sx: _sx, className, style, ...received } = props
  mockReceived.set(String(received['data-aglyn']), received)
  return (
    <div
      ref={ref}
      className={className}
      style={style}
      data-aglyn={received['data-aglyn']}
    >
      {children}
    </div>
  )
})
Probe.displayName = 'BindingTokenProbe'

const receivedBy = ($id: string) => mockReceived.get(`leaf:${$id}`) ?? {}

const textOf = (root: ParentNode, $id: string) =>
  root.querySelector(`[data-aglyn="leaf:${$id}"] aglyn-text`)?.textContent ??
  root.querySelector(`[data-aglyn="leaf:${$id}"]`)?.textContent

/** What the published page composes these props into, for this site. */
function publishedProps(props: Record<string, unknown>) {
  const bound = Aglyn.resolveNodesBindings(
    { header: { $id: 'header', componentId: PROBE, props } },
    VARIABLES,
    FUNCTIONS,
  )
  return Aglyn.resolveNodesHostTokens(bound, SITE).header.props as Record<
    string,
    unknown
  >
}

function Canvas(props: {
  children?: ReactNode
  variables?: Record<string, Aglyn.HostVariable>
  functions?: Record<string, Aglyn.HostFunction>
}) {
  const { children, variables = VARIABLES, functions = FUNCTIONS } = props
  return (
    <BesignerAppProvider appName={APP}>
      <BindingPickerContext.Provider
        value={{ variables, functions, host: SITE }}
      >
        <CanvasHostTokensProvider>{children}</CanvasHostTokensProvider>
      </BindingPickerContext.Provider>
    </BesignerAppProvider>
  )
}

/** The layout chrome exactly as a page's Besigner builds and draws it. */
function Chrome(props: { layoutNodes: Aglyn.ProcessableNodes }) {
  const chrome = useLayoutChromeCanvas(props.layoutNodes)
  const root = chrome?.getNode(Aglyn.NODE_ROOT_ID)
  return root ? (
    <AglynNodeRenderer node={root} LeafComponent={MediaFactsLeaf} />
  ) : null
}

const layoutNodes = () =>
  ({
    [Aglyn.NODE_ROOT_ID]: {
      $id: Aglyn.NODE_ROOT_ID,
      componentId: 'div',
      nodes: ['header'],
    },
    header: {
      $id: 'header',
      parentId: Aglyn.NODE_ROOT_ID,
      componentId: PROBE,
      props: { ...HEADER_PROPS },
      nodes: [],
    },
  }) as unknown as Aglyn.ProcessableNodes

const setResolveBindings = (value: boolean) =>
  act(() => {
    setBesignerFlag(getBesignerApp(APP), {
      flag: 'resolveBindings',
      value: () => value,
    } as never)
  })

beforeAll(() => {
  Aglyn.components.registerComponent(Probe as never, {
    $id: PROBE,
    displayName: 'Binding token probe',
  } as never)
})

afterAll(() => {
  Aglyn.components.unregisterComponent(PROBE as never)
})

beforeEach(() => {
  mockReceived.clear()
  initializeBesignerApp({ appName: APP })
})

afterEach(() => {
  deleteBesignerApp(APP)
})

describe('the layout chrome draws site variables as the published page resolves them (AGL-3480)', () => {
  it('CONTROL — the published composition fills every token in', () => {
    // Proves the comparisons below are against real substitutions, not two
    // copies of the same raw string.
    expect(publishedProps(HEADER_PROPS)).toEqual({
      children: 'Call (555) 010-2030',
      title: 'Built right, the first time',
      ariaLabel: 'EDR Construction — (555) 010-2030',
      subtitle: 'From $200',
    })
  })

  it("fills in a page's layout header, as the published page does", () => {
    const { container } = render(
      <Canvas>
        <Chrome layoutNodes={layoutNodes()} />
      </Canvas>,
    )
    const published = publishedProps(HEADER_PROPS)
    expect(textOf(container, 'header')).toBe(published['children'])
    expect(receivedBy('header')['title']).toBe(published['title'])
    expect(receivedBy('header')['ariaLabel']).toBe(published['ariaLabel'])
    expect(receivedBy('header')['subtitle']).toBe(published['subtitle'])
    expect(container.textContent).not.toContain('{{')
  })

  it('fills them in on any node drawn outside the document', () => {
    const header = {
      $id: 'header',
      componentId: PROBE,
      props: { ...HEADER_PROPS },
      nodes: [],
    }
    const { container } = render(
      <Canvas>
        <MediaFactsLeaf node={header as never} />
      </Canvas>,
    )
    const published = publishedProps(HEADER_PROPS)
    expect(textOf(container, 'header')).toBe(published['children'])
    expect(receivedBy('header')['subtitle']).toBe(published['subtitle'])
  })

  it('keeps the tokens on the node itself', () => {
    const header = {
      $id: 'header',
      componentId: PROBE,
      props: { ...HEADER_PROPS },
      nodes: [],
    }
    render(
      <Canvas>
        <MediaFactsLeaf node={header as never} />
      </Canvas>,
    )
    expect(header.props).toEqual(HEADER_PROPS)
  })

  it("draws a variable by its name in the raw-token view, as the page's own elements do", () => {
    render(
      <Canvas>
        <Chrome layoutNodes={layoutNodes()} />
      </Canvas>,
    )
    setResolveBindings(false)
    expect(receivedBy('header')['title']).toBe('{{tagline}}')
    // The editable leaf's raw view, word for word: the same helper.
    expect(receivedBy('header')['title']).toBe(
      Aglyn.displayBindingTokens(
        HEADER_PROPS.title,
        VARIABLES as never,
        FUNCTIONS as never,
      ),
    )
    // Host tokens stay as written there too (AGL-2881).
    expect(receivedBy('header')['ariaLabel']).toBe(
      '{{host.businessName}} — {{phone}}',
    )
  })

  it('draws the tokens as written while the site has no variables to read', () => {
    render(
      <Canvas variables={{}} functions={{}}>
        <Chrome layoutNodes={layoutNodes()} />
      </Canvas>,
    )
    expect(receivedBy('header')['title']).toBe(HEADER_PROPS.title)
  })
})
