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
 * The canvas draws host variables as the published page resolves them
 * (AGL-2881).
 *
 * The published page fills `{{host.*}}` in when it is composed, through
 * `resolveNodesHostTokens`. The canvas draws the same nodes, so every value
 * below is measured against that function run over the same site and the
 * same stored props — never against a copy of what it is expected to say.
 *
 * What is observed is what a component RECEIVES: a probe element registered
 * for these nodes records the props `Leaf` hands it, and the text it renders.
 * A DOM read alone would miss `ariaLabel`, which a plain `div` never forwards.
 *
 * The flag is the real one, in a real besigner app, so the raw-token view is
 * driven through the provider that decides it rather than by handing a leaf
 * `undefined` directly.
 */

import * as Aglyn from '@aglyn/aglyn'
import {
  deleteBesignerApp,
  getBesignerApp,
  initializeBesignerApp,
  setBesignerFlag,
} from '@aglyn/besigner'
import { act, render } from '@testing-library/react'
import { forwardRef, type ReactNode, useContext } from 'react'

import { BesignerAppProvider } from '../contexts/besigner-app-context'
import BindingPickerContext from '../contexts/binding-picker-context'
import CanvasHostTokensContext, {
  CanvasHostTokensProvider,
} from '../contexts/canvas-host-tokens-context'
import ComponentPromotionContext from '../contexts/component-promotion-context'
import BindingPreviewControlsComponent from './binding-preview-controls.component'
import ElementLeafComponent, { MediaFactsLeaf } from './node-leaf'

const APP = 'node-leaf-host-tokens'
const PROBE = 'hostTokenProbe'

/**
 * The aglyn.com site document, reduced to the fields a token reads. It sets no
 * postal address, which is the missing field.
 */
const SITE: Aglyn.HostTokenSource = {
  displayName: 'aglyn-marketing',
  subdomain: 'aglyn-marketing',
  cname: 'aglyn.com',
  seo: { entity: { name: 'Aglyn' } },
  business: { supportEmail: 'hello@aglyn.com' },
}

/**
 * The Statement section's accessible label, as stored on the home screen,
 * beside one prop of every other kind a token can sit in.
 */
const STORED_PROPS = {
  children: 'What {{host.businessName}} is',
  ariaLabel: 'What {{host.businessName}} is',
  alt: '{{host.businessName}} logo',
  href: '{{host.url}}/pricing',
  title: 'Write to {{host.supportEmail}}',
  subtitle: 'Visit us at {{host.address}}',
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
Probe.displayName = 'HostTokenProbe'

/** What the published page composes these props into, for this site. */
function publishedProps(
  props: Record<string, unknown>,
  site: Aglyn.HostTokenSource | null | undefined = SITE,
) {
  return Aglyn.resolveNodesHostTokens(
    { statement: { $id: 'statement', componentId: PROBE, props } },
    site,
  ).statement.props as Record<string, unknown>
}

/** The text a leaf renders, which travels as a child rather than a prop. */
const textOf = (root: ParentNode, $id: string) =>
  root.querySelector(`[data-aglyn="leaf:${$id}"] aglyn-text`)?.textContent ??
  root.querySelector(`[data-aglyn="leaf:${$id}"]`)?.textContent

const receivedBy = ($id: string) => mockReceived.get(`leaf:${$id}`) ?? {}

/** The props a token can sit in, minus `children`, which renders as text. */
const ATTRIBUTE_KEYS = ['ariaLabel', 'alt', 'href', 'title', 'subtitle']

function Canvas(props: {
  host?: Aglyn.HostTokenSource | null
  children?: ReactNode
  definitions?: Record<string, unknown>
}) {
  const { host, children, definitions } = props
  return (
    <BesignerAppProvider appName={APP}>
      <BindingPickerContext.Provider value={{ host }}>
        <ComponentPromotionContext.Provider
          value={{ definitions: definitions as never }}
        >
          <CanvasHostTokensProvider>{children}</CanvasHostTokensProvider>
        </ComponentPromotionContext.Provider>
      </BindingPickerContext.Provider>
    </BesignerAppProvider>
  )
}

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
    displayName: 'Host token probe',
  } as never)
})

afterAll(() => {
  Aglyn.components.unregisterComponent(PROBE as never)
})

beforeEach(() => {
  mockReceived.clear()
  initializeBesignerApp({ appName: APP })
  Aglyn.canvas.reset()
  Aglyn.canvas.setNodes({
    [Aglyn.NODE_ROOT_ID]: {
      $id: Aglyn.NODE_ROOT_ID,
      componentId: 'div',
      nodes: ['statement'],
    },
    statement: {
      $id: 'statement',
      componentId: PROBE,
      parentId: Aglyn.NODE_ROOT_ID,
      props: { ...STORED_PROPS },
      nodes: [],
    },
  } as never)
})

afterEach(() => {
  deleteBesignerApp(APP)
})

const statementNode = () => Aglyn.canvas.getNode('statement') as never

describe('the canvas draws host variables as the published page resolves them (AGL-2881)', () => {
  it('CONTROL — the published resolution fills every token in, and the stored props hold them', () => {
    const published = publishedProps(STORED_PROPS)
    // Proves the comparison below is against real substitutions, not two
    // copies of the same raw string.
    expect(published).toEqual({
      children: 'What Aglyn is',
      ariaLabel: 'What Aglyn is',
      alt: 'Aglyn logo',
      href: 'https://aglyn.com/pricing',
      title: 'Write to hello@aglyn.com',
      subtitle: 'Visit us at ',
    })
    for (const value of Object.values(STORED_PROPS)) {
      expect(value).toContain('{{host.')
    }
  })

  it('fills in every prop that holds one, exactly as the published page does', () => {
    const { container } = render(
      <Canvas host={SITE}>
        <ElementLeafComponent node={statementNode()} />
      </Canvas>,
    )
    const published = publishedProps(STORED_PROPS)
    for (const key of ATTRIBUTE_KEYS) {
      expect(receivedBy('statement')[key]).toBe(published[key])
    }
    expect(textOf(container, 'statement')).toBe(published['children'])
  })

  it('draws a field the site has not set as nothing, as the published page does', () => {
    render(
      <Canvas host={SITE}>
        <ElementLeafComponent node={statementNode()} />
      </Canvas>,
    )
    // No postal address on this site: not the token, and not a placeholder.
    expect(receivedBy('statement')['subtitle']).toBe('Visit us at ')
    expect(receivedBy('statement')['subtitle']).toBe(
      publishedProps(STORED_PROPS)['subtitle'],
    )
  })

  it('keeps the tokens in the node the panels edit and the save writes', () => {
    render(
      <Canvas host={SITE}>
        <ElementLeafComponent node={statementNode()} />
      </Canvas>,
    )
    expect(
      (Aglyn.canvas.getNode('statement') as { props?: unknown }).props,
    ).toEqual(STORED_PROPS)
    // Still marked as bound content, so the canvas shows the value is live.
    expect(receivedBy('statement')['data-aglyn-bound']).toBe('')
  })

  it('draws the tokens as written in the raw-token view', () => {
    const { container } = render(
      <Canvas host={SITE}>
        <ElementLeafComponent node={statementNode()} />
      </Canvas>,
    )
    expect(receivedBy('statement')['ariaLabel']).toBe('What Aglyn is')

    setResolveBindings(false)

    for (const key of ATTRIBUTE_KEYS) {
      expect(receivedBy('statement')[key]).toBe(
        STORED_PROPS[key as keyof typeof STORED_PROPS],
      )
    }
    expect(textOf(container, 'statement')).toBe(STORED_PROPS.children)

    // And back again, from the same toggle.
    setResolveBindings(true)
    expect(receivedBy('statement')['ariaLabel']).toBe('What Aglyn is')
  })

  it('draws the tokens as written while there is no site to read', () => {
    render(
      <Canvas host={undefined}>
        <ElementLeafComponent node={statementNode()} />
      </Canvas>,
    )
    expect(receivedBy('statement')['ariaLabel']).toBe(STORED_PROPS.ariaLabel)
  })

  it('follows an edit to the stored prop', () => {
    render(
      <Canvas host={SITE}>
        <ElementLeafComponent node={statementNode()} />
      </Canvas>,
    )
    // Canvas props change in place; the copy must not keep the old value.
    act(() => {
      ;(Aglyn.canvas.getNode('statement') as any).props.ariaLabel =
        'About {{host.businessName}}'
    })
    expect(receivedBy('statement')['ariaLabel']).toBe('About Aglyn')
  })

  it("fills them in inside a component instance's definition, after its props", () => {
    // A definition naming the host itself, and a prop whose value on this
    // placement names it too: the page grafts, then resolves.
    const definitions = {
      card: {
        rootId: 'root',
        nodes: {
          root: { $id: 'root', componentId: PROBE, nodes: ['line'] },
          line: {
            $id: 'line',
            componentId: PROBE,
            parentId: 'root',
            props: {
              ariaLabel: 'Made by {{host.businessName}}',
              href: '{{prop.link}}',
            },
            nodes: [],
          },
        },
        props: [{ name: 'link', type: 'text', defaultValue: '' }],
      },
    }
    const instance = {
      $id: 'inst1',
      type: 'node',
      componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
      props: { refId: 'card', propValues: { link: '{{host.url}}/about' } },
      sx: {},
      nodes: [],
    }
    render(
      <Canvas host={SITE} definitions={definitions}>
        <ElementLeafComponent node={instance as never} />
      </Canvas>,
    )
    const published = Aglyn.resolveNodesHostTokens(
      Aglyn.composeReusableComponentNodes(
        { inst1: { ...instance, nodes: [] } } as never,
        definitions as never,
      ),
      SITE,
    ) as Record<string, { props?: Record<string, unknown> }>
    const grafted = 'cmp__inst1__line'
    expect(published[grafted]?.props).toMatchObject({
      ariaLabel: 'Made by Aglyn',
      href: 'https://aglyn.com/about',
    })
    expect(receivedBy(grafted)['ariaLabel']).toBe(
      published[grafted]?.props?.['ariaLabel'],
    )
    expect(receivedBy(grafted)['href']).toBe(published[grafted]?.props?.['href'])
  })

  it('fills them in on a node drawn outside the document, as the layout chrome is', () => {
    const footer = {
      $id: 'footer',
      componentId: PROBE,
      props: { children: '© {{host.businessName}}', title: '{{host.url}}' },
      nodes: [],
    }
    const { container } = render(
      <Canvas host={SITE}>
        <MediaFactsLeaf node={footer as never} />
      </Canvas>,
    )
    const published = publishedProps(footer.props)
    expect(textOf(container, 'footer')).toBe(published['children'])
    expect(receivedBy('footer')['title']).toBe(published['title'])
    expect(receivedBy('footer')['title']).toBe('https://aglyn.com')
  })

  it('draws a node outside the document raw in the raw-token view too', () => {
    const footer = {
      $id: 'footer',
      componentId: PROBE,
      props: { title: '{{host.url}}' },
      nodes: [],
    }
    render(
      <Canvas host={SITE}>
        <MediaFactsLeaf node={footer as never} />
      </Canvas>,
    )
    setResolveBindings(false)
    expect(receivedBy('footer')['title']).toBe('{{host.url}}')
  })
})

describe('the site the canvas resolves from (AGL-2881)', () => {
  /** Records each value the canvas context held, in order. */
  function renderValues(host: Aglyn.HostTokenSource) {
    const values: Array<Aglyn.HostTokenSource | undefined> = []
    function Reader() {
      values.push(useContext(CanvasHostTokensContext))
      return null
    }
    const view = render(
      <Canvas host={host}>
        <Reader />
      </Canvas>,
    )
    return { values, view, Reader }
  }

  it('keeps one value while every token resolves to the same thing', () => {
    const { values, view, Reader } = renderValues(SITE)
    // A new snapshot of the same site, with a field no token reads changed.
    view.rerender(
      <Canvas host={{ ...SITE, theme: { mode: 'dark' } } as never}>
        <Reader />
      </Canvas>,
    )
    expect(values.at(-1)).toBe(values[0])
  })

  it('takes the new site once a token would resolve differently', () => {
    const { values, view, Reader } = renderValues(SITE)
    const renamed = { ...SITE, seo: { entity: { name: 'Aglyn, Inc.' } } }
    view.rerender(
      <Canvas host={renamed}>
        <Reader />
      </Canvas>,
    )
    expect(values.at(-1)).toBe(renamed)
  })
})

describe('the raw-token toggle is offered wherever host variables resolve (AGL-2881)', () => {
  const toggle = () =>
    document.querySelector('[aria-label="toggle binding resolution"]')

  it('shows for a site with no variables or functions', () => {
    render(
      <Canvas host={SITE}>
        <BindingPreviewControlsComponent />
      </Canvas>,
    )
    expect(toggle()).not.toBeNull()
  })

  it('CONTROL — stays hidden with nothing at all to resolve', () => {
    render(
      <Canvas host={undefined}>
        <BindingPreviewControlsComponent />
      </Canvas>,
    )
    expect(toggle()).toBeNull()
  })
})
