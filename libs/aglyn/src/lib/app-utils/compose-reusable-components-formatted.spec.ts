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

import {
  composeReusableComponentNodes,
  detachInstanceSubtree,
  getInstanceEffectivePropHtml,
  listPropFedTextNodeIds,
  REUSABLE_INSTANCE_COMPONENT_ID,
  REUSABLE_INSTANCE_PROP_HTML_KEY,
  REUSABLE_INSTANCE_PROP_VALUES_KEY,
} from './compose-reusable-components'

/** A hero whose heading and body are declared props. */
const definition = {
  rootId: 'hero',
  props: [
    { name: 'headline', type: 'text', defaultValue: 'Build your website.' },
    { name: 'body', type: 'text', defaultValue: 'Describe it.' },
  ],
  nodes: {
    hero: { $id: 'hero', componentId: 'muiBox', nodes: ['title', 'lede'] },
    title: {
      $id: 'title',
      componentId: 'muiTypography',
      parentId: 'hero',
      props: { children: '{{prop.headline}}', variant: 'h2' },
    },
    lede: {
      $id: 'lede',
      componentId: 'muiTypography',
      parentId: 'hero',
      props: { children: 'Say {{prop.body}} here' },
    },
  },
} as any

const page = (props: Record<string, unknown>) =>
  ({
    _root_: { $id: '_root_', componentId: 'div', nodes: ['band'] },
    band: {
      $id: 'band',
      componentId: REUSABLE_INSTANCE_COMPONENT_ID,
      parentId: '_root_',
      props: { refId: 'hero', ...props },
    },
  }) as any

describe('an instance prop formatted on the canvas', () => {
  it('draws its markup as the element’s own html, its words as children', () => {
    const composed = composeReusableComponentNodes(
      page({
        [REUSABLE_INSTANCE_PROP_VALUES_KEY]: { headline: 'Build your website.' },
        [REUSABLE_INSTANCE_PROP_HTML_KEY]: {
          headline: 'Build your <i>website.</i>',
        },
      }),
      { hero: definition },
    )
    expect(composed['cmp__band__title'].props).toMatchObject({
      children: 'Build your website.',
      html: 'Build your <i>website.</i>',
      variant: 'h2',
    })
  })

  it('reaches only an element whose text IS the prop, never one that mentions it', () => {
    const composed = composeReusableComponentNodes(
      page({
        [REUSABLE_INSTANCE_PROP_VALUES_KEY]: { body: 'it' },
        [REUSABLE_INSTANCE_PROP_HTML_KEY]: { body: '<b>it</b>' },
      }),
      { hero: definition },
    )
    expect(composed['cmp__band__lede'].props).toEqual({
      children: 'Say it here',
    })
  })

  it('draws nothing formatted from markup with no value under it', () => {
    const composed = composeReusableComponentNodes(
      page({ [REUSABLE_INSTANCE_PROP_HTML_KEY]: { headline: '<i>stale</i>' } }),
      { hero: definition },
    )
    expect(composed['cmp__band__title'].props.html).toBeUndefined()
    expect(composed['cmp__band__title'].props.children).toBe(
      'Build your website.',
    )
  })

  it('ignores markup for a prop the component does not declare', () => {
    const composed = composeReusableComponentNodes(
      page({
        [REUSABLE_INSTANCE_PROP_VALUES_KEY]: { headline: 'Hi', ghost: 'x' },
        [REUSABLE_INSTANCE_PROP_HTML_KEY]: { ghost: '<b>x</b>' },
      }),
      { hero: definition },
    )
    expect(composed['cmp__band__title'].props.html).toBeUndefined()
  })

  it('keeps the formatting when the instance is detached', () => {
    const detached = detachInstanceSubtree(
      page({
        [REUSABLE_INSTANCE_PROP_VALUES_KEY]: { headline: 'Bold move' },
        [REUSABLE_INSTANCE_PROP_HTML_KEY]: { headline: '<b>Bold</b> move' },
      }),
      'band',
      definition,
      (() => {
        let next = 0
        return () => `fresh${next++}`
      })(),
    ) as Record<string, any>
    const title = Object.values(detached).find(
      (node: any) => node?.props?.children === 'Bold move',
    )
    expect(title?.props.html).toBe('<b>Bold</b> move')
  })

  it('answers what the canvas editor opens with', () => {
    const props = {
      [REUSABLE_INSTANCE_PROP_VALUES_KEY]: { headline: 'Bold move' },
      [REUSABLE_INSTANCE_PROP_HTML_KEY]: { headline: '<b>Bold</b> move' },
    }
    expect(
      getInstanceEffectivePropHtml(props, definition.props, 'headline'),
    ).toBe('<b>Bold</b> move')
    expect(getInstanceEffectivePropHtml(props, definition.props, 'body')).toBe(
      '',
    )
  })

  it('lists the elements whose text is exactly one prop', () => {
    expect(listPropFedTextNodeIds(definition.nodes, 'headline')).toEqual([
      'title',
    ])
    // `lede` only MENTIONS the body prop, so formatting never reaches it.
    expect(listPropFedTextNodeIds(definition.nodes, 'body')).toEqual([])
  })
})
