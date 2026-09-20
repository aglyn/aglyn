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
  AI_SURFACE_NAMES,
  AI_TEXT_LIMITS,
  type AiSurface,
} from './ai-palette'
import {
  AI_PALETTE,
  AI_SURFACES,
} from './ai-palette.generated'
import { NODE_MAP_MAX_BYTES } from '@aglyn/aglyn/app-utils/measure-node-map'
import { encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'

import { validateAiNodeTree, type AiNodeTreeResult } from './ai-node-tree'

type Node = {
  $id: string
  componentId: string
  parentId: string | null
  props?: Record<string, unknown>
  sx?: Record<string, unknown>
  nodes?: string[]
  [key: string]: unknown
}
type Tree = { rootId: string; nodes: Record<string, Node> }

/** A flat map from a nested literal, with parent ids and child lists filled. */
function tree(root: NestedNode, rootId = CANVAS_ROOT_ELEMENT_ID): Tree {
  const nodes: Record<string, Node> = {}
  let counter = 0
  const visit = (nested: NestedNode, parentId: string | null): string => {
    const id = parentId === null ? rootId : `n${++counter}`
    const { children = [], ...rest } = nested
    nodes[id] = { ...rest, $id: id, parentId, nodes: [] }
    for (const child of children) nodes[id].nodes!.push(visit(child, id))
    return id
  }
  visit(root, null)
  return { rootId, nodes }
}
type NestedNode = {
  componentId: string
  props?: Record<string, unknown>
  sx?: Record<string, unknown>
  children?: NestedNode[]
}

const HEADLINE = 'Plans for teams that ship'
const BODY =
  'One workspace for every site, every campaign and every customer record, ' +
  'with the people who run them.'

const GOLDEN: Record<AiSurface, () => Tree> = {
  screen: () =>
    tree({
      componentId: 'div',
      children: [
        {
          componentId: 'section',
          props: { element: 'section' },
          children: [
            {
              componentId: 'muiContainer',
              props: { maxWidth: 'md' },
              children: [
                {
                  componentId: 'muiStack',
                  props: { direction: 'column', spacing: '3' },
                  sx: { py: 8, textAlign: 'center' },
                  children: [
                    {
                      componentId: 'muiTypography',
                      props: { variant: 'h1', children: HEADLINE },
                      sx: { color: 'primary.main' },
                    },
                    {
                      componentId: 'muiTypography',
                      props: { variant: 'body1', children: BODY },
                    },
                    {
                      componentId: 'muiButton',
                      props: {
                        variant: 'contained',
                        children: 'Start free',
                        href: 'https://example.com/signup',
                      },
                    },
                    {
                      componentId: 'image',
                      props: {
                        src: 'https://example.com/hero.jpg',
                        alt: 'A team at a whiteboard',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  email: () =>
    tree({
      componentId: 'div',
      children: [
        {
          componentId: 'emailSection',
          props: { align: 'center' },
          children: [
            {
              componentId: 'emailText',
              props: { variant: 'heading', children: HEADLINE },
            },
            { componentId: 'emailText', props: { children: BODY } },
            {
              componentId: 'emailImage',
              props: {
                src: 'https://example.com/hero.jpg',
                alt: 'A team at a whiteboard',
              },
            },
            {
              componentId: 'emailButton',
              props: {
                children: 'Read more',
                href: 'https://example.com/plans',
              },
            },
            { componentId: 'emailDivider' },
            { componentId: 'emailSpacer', props: { height: '24' } },
          ],
        },
      ],
    }),
  form: () =>
    tree(
      {
        componentId: 'form',
        props: {
          formName: 'Contact',
          submitLabel: 'Send',
          successMessage: 'Thanks, we will be in touch.',
        },
        children: [
          {
            componentId: 'formField',
            props: { fieldName: 'name', label: 'Name', fieldType: 'text' },
          },
          {
            componentId: 'formField',
            props: {
              fieldName: 'email',
              label: 'Email',
              fieldType: 'email',
              required: true,
            },
          },
          {
            componentId: 'formField',
            props: {
              fieldName: 'message',
              label: 'Message',
              fieldType: 'textarea',
            },
          },
        ],
      },
      'f1',
    ),
  layout: () =>
    tree({
      componentId: 'div',
      children: [
        {
          componentId: 'muiAppBar',
          props: { position: 'static' },
          children: [
            {
              componentId: 'muiToolbar',
              children: [
                {
                  componentId: 'muiTypography',
                  props: { variant: 'h6', children: 'Acme' },
                },
                {
                  componentId: 'muiScreenLink',
                  props: { children: 'Pricing', href: '/pricing' },
                },
              ],
            },
          ],
        },
        { componentId: 'layoutSlot' },
        {
          componentId: 'section',
          props: { element: 'footer' },
          children: [
            {
              componentId: 'muiTypography',
              props: { variant: 'caption', children: 'Made with care.' },
            },
          ],
        },
      ],
    }),
  component: () =>
    tree({
      componentId: 'div',
      children: [
        {
          componentId: 'muiCard',
          children: [
            {
              componentId: 'muiCardHeader',
              props: { title: 'Starter', subheader: 'For one site' },
            },
            {
              componentId: 'muiCardContent',
              children: [
                {
                  componentId: 'muiTypography',
                  props: { variant: 'body2', children: BODY },
                },
              ],
            },
            {
              componentId: 'muiCardActions',
              children: [
                {
                  componentId: 'muiButton',
                  props: { variant: 'outlined', children: 'Choose' },
                },
              ],
            },
          ],
        },
      ],
    }),
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

/** The first node of a component in a tree, by the model's ids. */
function firstOf(input: Tree, componentId: string): Node {
  const node = Object.values(input.nodes).find(
    (candidate) => candidate.componentId === componentId,
  )
  if (!node) throw new Error(`golden tree has no ${componentId}`)
  return node
}

/** Any node under the root, for a mutation that needs some element. */
function anyLeaf(input: Tree): Node {
  const node = Object.values(input.nodes).find(
    (candidate) =>
      candidate.$id !== input.rootId && !(candidate.nodes ?? []).length,
  )
  if (!node) throw new Error('golden tree has no leaf')
  return node
}

/** Any node under the root that holds children. */
function anyContainer(input: Tree): Node {
  const node = Object.values(input.nodes).find(
    (candidate) =>
      candidate.$id !== input.rootId && (candidate.nodes ?? []).length,
  )
  return node ?? input.nodes[input.rootId]
}

/** A node whose `children` is copy under a `variant` — a heading or paragraph. */
function anyTypography(input: Tree): Node | undefined {
  return Object.values(input.nodes).find((node) => {
    const entry = AI_PALETTE[node.componentId]
    return (
      entry?.propRoles.children === 'text' &&
      entry.propsSchema.properties.variant?.enum
    )
  })
}

/** A node with a prop held to the button-label ceiling. */
function anyButtonLabel(input: Tree): { node: Node; name: string } | undefined {
  for (const node of Object.values(input.nodes)) {
    const limits = AI_PALETTE[node.componentId]?.textLimits ?? {}
    const name = Object.keys(limits).find(
      (key) => limits[key] === AI_TEXT_LIMITS.button,
    )
    if (name) return { node, name }
  }
  return undefined
}

/** A node with a prop matching the schema test, and that prop's name. */
function anyPropOfType(
  input: Tree,
  matches: (schema: { type?: string; enum?: readonly string[] }) => boolean,
): { node: Node; name: string } | undefined {
  for (const node of Object.values(input.nodes)) {
    const properties =
      AI_PALETTE[node.componentId]?.propsSchema.properties ?? {}
    const name = Object.keys(properties).find((key) => matches(properties[key]))
    if (name) return { node, name }
  }
  return undefined
}

/** A text prop on some node, so a copy mutation lands where copy is. */
function anyTextProp(input: Tree): { node: Node; name: string } {
  for (const node of Object.values(input.nodes)) {
    const roles = AI_PALETTE[node.componentId]?.propRoles ?? {}
    const name = Object.keys(roles).find((key) => roles[key] === 'text')
    if (name) return { node, name }
  }
  throw new Error('golden tree has no text prop')
}

function addChild(
  input: Tree,
  parent: Node,
  child: {
    $id: string
    componentId: string
    props?: Record<string, unknown>
    nodes?: string[]
  },
) {
  input.nodes[child.$id] = { ...child, parentId: parent.$id }
  parent.nodes = [...(parent.nodes ?? []), child.$id]
}

function ok(
  result: AiNodeTreeResult,
): asserts result is Extract<AiNodeTreeResult, { ok: true }> {
  if (result.ok === false) throw new Error(`${result.code}: ${result.error}`)
}

describe('validateAiNodeTree golden trees (AGL-2905)', () => {
  it.each(AI_SURFACE_NAMES)('accepts the %s tree unchanged', (surface) => {
    const input = GOLDEN[surface]()
    const result = validateAiNodeTree(input, surface)
    ok(result)
    expect(result.repairs).toEqual([])
    expect(Object.keys(result.nodes)).toHaveLength(
      Object.keys(input.nodes).length,
    )
    // Every id is minted fresh; only the canvas wrapper keeps its name.
    for (const [id, node] of Object.entries(result.nodes)) {
      expect(node.$id).toBe(id)
      expect(node.type).toBe('node')
      expect(node.pluginId).toBe(AI_PALETTE[node.componentId].pluginId)
      if (id === CANVAS_ROOT_ELEMENT_ID) continue
      expect(input.nodes[id]).toBeUndefined()
      expect(id).toMatch(/^[A-Za-z0-9_-]{10}$/)
    }
    // Parents and children agree in both directions.
    for (const node of Object.values(result.nodes)) {
      for (const childId of node.nodes ?? []) {
        expect(result.nodes[childId].parentId).toBe(node.$id)
      }
      if (node.parentId) {
        expect(result.nodes[node.parentId].nodes).toContain(node.$id)
      }
    }
    expect(result.nodes[result.rootId].parentId).toBeNull()
    expect(encodeStoredNodes(result.nodes)).toBeInstanceOf(Uint8Array)
  })

  it('keeps the canvas wrapper id for a document surface and mints the form root', () => {
    const screen = validateAiNodeTree(GOLDEN.screen(), 'screen')
    ok(screen)
    expect(screen.rootId).toBe(CANVAS_ROOT_ELEMENT_ID)
    expect(screen.nodes[screen.rootId].componentId).toBe('div')
    const form = validateAiNodeTree(GOLDEN.form(), 'form')
    ok(form)
    expect(form.rootId).not.toBe('f1')
    expect(form.nodes[form.rootId].componentId).toBe('form')
  })

  it('carries a checked sx through, from the node or from props', () => {
    const input = GOLDEN.screen()
    const button = firstOf(input, 'muiButton')
    button.props = { ...button.props, sx: { mt: 2, bgcolor: 'secondary.main' } }
    const result = validateAiNodeTree(input, 'screen')
    ok(result)
    const stack = Object.values(result.nodes).find(
      (node) => node.componentId === 'muiStack',
    )
    expect(stack?.sx).toEqual({ py: 8, textAlign: 'center' })
    const out = Object.values(result.nodes).find(
      (node) => node.componentId === 'muiButton',
    )
    expect(out?.sx).toEqual({ mt: 2, bgcolor: 'secondary.main' })
    expect(out?.props).not.toHaveProperty('sx')
  })

  it('accepts a screen id the host has and a media reference it holds', () => {
    const input = GOLDEN.screen()
    const button = firstOf(input, 'muiButton')
    button.props = { ...button.props, screenId: 'scr_pricing' }
    const image = firstOf(input, 'image')
    image.props = { ...image.props, src: 'media:host1/asset42' }
    const result = validateAiNodeTree(input, 'screen', {
      screenIds: ['scr_pricing'],
      assetIds: ['asset42'],
    })
    ok(result)
    expect(result.repairs).toEqual([])
  })

  it('never throws on garbage', () => {
    for (const garbage of [
      null,
      undefined,
      42,
      'nodes',
      [],
      {},
      { rootId: 1, nodes: {} },
      { rootId: 'x', nodes: [] },
      { rootId: 'x', nodes: { x: null } },
      { rootId: 'x', nodes: { x: { componentId: 'div', nodes: [{}] } } },
    ]) {
      const result = validateAiNodeTree(garbage, 'screen')
      expect(result.ok).toBe(false)
    }
    expect(validateAiNodeTree(GOLDEN.screen(), 'poster' as AiSurface).ok).toBe(
      false,
    )
  })
})

interface Mutation {
  name: string
  /** A substring that must not survive into the output when the tree passes. */
  marker?: string
  /** Surfaces the mutation cannot be expressed on. */
  skip?: AiSurface[]
  apply: (
    input: Tree,
    surface: AiSurface,
  ) => Tree | { input: Tree; context: object }
}

const SCRIPT = '<script>alert("aglyn")</script>'
const LONG = (n: number) => 'x'.repeat(n)

const MUTATIONS: Mutation[] = [
  {
    name: 'an unknown component id',
    marker: 'muiRocket',
    apply: (input) => {
      anyLeaf(input).componentId = 'muiRocket'
      return input
    },
  },
  {
    name: "a component from another surface's vocabulary",
    marker: 'emailRichtext',
    apply: (input) => {
      anyLeaf(input).componentId = 'emailRichtext'
      return input
    },
  },
  {
    name: 'a raw-HTML element',
    marker: 'custom-html',
    apply: (input) => {
      addChild(input, anyContainer(input), {
        $id: 'evil',
        componentId: 'custom-html',
        props: { html: SCRIPT },
      })
      return input
    },
  },
  {
    name: 'a nested document root',
    marker: 'nested-root',
    apply: (input) => {
      addChild(input, anyContainer(input), {
        $id: 'nested-root',
        componentId: 'div',
      })
      return input
    },
  },
  {
    name: 'a toolbar outside an app bar (restrictParent)',
    marker: 'orphan-toolbar',
    apply: (input) => {
      addChild(input, input.nodes[input.rootId], {
        $id: 'orphan-toolbar',
        componentId: 'muiToolbar',
      })
      return input
    },
  },
  {
    name: 'a paragraph inside a list (restrictChildren)',
    marker: 'list-text',
    apply: (input) => {
      addChild(input, anyContainer(input), {
        $id: 'list-1',
        componentId: 'muiList',
        nodes: ['list-text'],
      })
      input.nodes['list-text'] = {
        $id: 'list-text',
        componentId: 'muiTypography',
        parentId: 'list-1',
        props: { children: 'not a list item' },
      }
      return input
    },
  },
  {
    name: 'a child under a leaf element',
    marker: 'leaf-child',
    apply: (input) => {
      addChild(input, anyLeaf(input), {
        $id: 'leaf-child',
        componentId: 'muiTypography',
        props: { children: 'inside a leaf' },
      })
      return input
    },
  },
  {
    name: 'a script in a text prop',
    marker: SCRIPT,
    apply: (input) => {
      const { node, name } = anyTextProp(input)
      node.props = { ...node.props, [name]: `Welcome ${SCRIPT}` }
      return input
    },
  },
  {
    name: 'an inline handler prop',
    marker: 'alert(1)',
    apply: (input) => {
      anyLeaf(input).props = { ...anyLeaf(input).props, onClick: 'alert(1)' }
      return input
    },
  },
  {
    name: 'dangerouslySetInnerHTML',
    marker: '__html',
    apply: (input) => {
      const leaf = anyLeaf(input)
      leaf.props = {
        ...leaf.props,
        dangerouslySetInnerHTML: { __html: SCRIPT },
      }
      return input
    },
  },
  {
    name: 'an html prop on a text element',
    marker: '<b onmouseover',
    apply: (input) => {
      const { node } = anyTextProp(input)
      node.props = { ...node.props, html: '<b onmouseover=alert(1)>hi</b>' }
      return input
    },
  },
  {
    name: 'a javascript: link',
    marker: 'javascript:',
    apply: (input) => {
      const leaf = anyLeaf(input)
      leaf.props = { ...leaf.props, href: 'javascript:alert(1)' }
      return input
    },
  },
  {
    name: 'an http: image',
    marker: 'http://insecure',
    apply: (input) => {
      const leaf = anyLeaf(input)
      leaf.props = { ...leaf.props, src: 'http://insecure.example/a.png' }
      return input
    },
  },
  {
    name: 'a data: image',
    marker: 'data:text/html',
    apply: (input) => {
      const leaf = anyLeaf(input)
      leaf.props = { ...leaf.props, src: 'data:text/html,<script>1</script>' }
      return input
    },
  },
  {
    name: 'a scheme-relative link',
    marker: '//evil.example',
    apply: (input) => {
      const leaf = anyLeaf(input)
      leaf.props = { ...leaf.props, href: '//evil.example/x' }
      return input
    },
  },
  {
    name: 'sx with url(',
    marker: 'url(',
    apply: (input) => {
      anyLeaf(input).sx = { backgroundImage: 'url(https://evil.example/x.png)' }
      return input
    },
  },
  {
    name: 'sx with url( under an allowed key',
    marker: 'url(',
    apply: (input) => {
      anyLeaf(input).sx = { border: '1px url(https://evil.example/x)' }
      return input
    },
  },
  {
    name: 'sx with expression(',
    marker: 'expression(',
    apply: (input) => {
      anyLeaf(input).sx = { width: 'expression(alert(1))' }
      return input
    },
  },
  {
    name: 'sx with !important',
    marker: '!important',
    apply: (input) => {
      anyLeaf(input).sx = { color: 'red !important' }
      return input
    },
  },
  {
    name: 'sx with @import',
    marker: '@import',
    apply: (input) => {
      anyLeaf(input).sx = { fontFamily: '@import url(x)' }
      return input
    },
  },
  {
    name: 'sx with a second declaration',
    marker: 'background',
    apply: (input) => {
      anyLeaf(input).sx = { color: 'red; background: red' }
      return input
    },
  },
  {
    name: 'sx with a pseudo-selector',
    marker: '&:hover',
    apply: (input) => {
      anyLeaf(input).sx = { '&:hover': { color: 'red' } }
      return input
    },
  },
  {
    name: 'sx with a nested selector',
    marker: '& .child',
    apply: (input) => {
      anyLeaf(input).sx = { '& .child': { display: 'none' } }
      return input
    },
  },
  {
    name: 'sx with a non-breakpoint responsive key',
    marker: 'hover',
    apply: (input) => {
      anyLeaf(input).sx = { color: { hover: 'red' } }
      return input
    },
  },
  {
    name: 'sx with an unknown key',
    marker: 'content',
    apply: (input) => {
      anyLeaf(input).sx = { content: 'x' }
      return input
    },
  },
  {
    name: 'sx that is a string',
    marker: 'color:red',
    apply: (input) => {
      ;(anyLeaf(input) as Record<string, unknown>).sx = 'color:red'
      return input
    },
  },
  {
    name: 'an oversized headline',
    marker: LONG(AI_TEXT_LIMITS.headline + 1),
    skip: ['form'],
    apply: (input) => {
      const node = anyTypography(input)
      if (!node) throw new Error('golden tree has no heading')
      const headline = AI_PALETTE[
        node.componentId
      ].propsSchema.properties.variant.enum!.find((variant) =>
        /^(h1|heading)$/.test(variant),
      )
      node.props = {
        ...node.props,
        variant: headline,
        children: LONG(AI_TEXT_LIMITS.headline + 50),
      }
      return input
    },
  },
  {
    name: 'an oversized body',
    marker: LONG(AI_TEXT_LIMITS.body + 1),
    apply: (input) => {
      const { node, name } = anyTextProp(input)
      node.props = { ...node.props, [name]: LONG(AI_TEXT_LIMITS.body + 500) }
      return input
    },
  },
  {
    name: 'an oversized button label',
    marker: LONG(AI_TEXT_LIMITS.button + 1),
    apply: (input) => {
      const label = anyButtonLabel(input)
      if (!label) throw new Error('golden tree has no button label')
      label.node.props = {
        ...label.node.props,
        [label.name]: LONG(AI_TEXT_LIMITS.button + 20),
      }
      return input
    },
  },
  {
    name: 'a one-megabyte text',
    marker: LONG(10_000),
    apply: (input) => {
      const { node, name } = anyTextProp(input)
      node.props = { ...node.props, [name]: LONG(1024 * 1024) }
      return input
    },
  },
  {
    name: 'a foreign screen id',
    marker: 'scr_foreign',
    apply: (input) => {
      const leaf = anyLeaf(input)
      leaf.props = { ...leaf.props, screenId: 'scr_foreign' }
      return { input, context: { screenIds: ['scr_home'] } }
    },
  },
  {
    name: 'a media reference the site does not hold',
    marker: 'media:host1/stolen',
    apply: (input) => {
      const leaf = anyLeaf(input)
      leaf.props = { ...leaf.props, src: 'media:host1/stolen' }
      return { input, context: { assetIds: ['mine'] } }
    },
  },
  {
    name: 'an unknown prop',
    marker: 'nonsenseProp',
    apply: (input) => {
      const leaf = anyLeaf(input)
      leaf.props = { ...leaf.props, nonsenseProp: 'x' }
      return input
    },
  },
  {
    name: 'an enum value outside its options',
    marker: 'gigantic',
    apply: (input) => {
      const found = anyPropOfType(input, (schema) => Boolean(schema.enum))
      if (!found) throw new Error('golden tree has no enum prop')
      found.node.props = { ...found.node.props, [found.name]: 'gigantic' }
      return input
    },
  },
  {
    name: 'an enum value in the wrong case',
    apply: (input) => {
      const found = anyPropOfType(input, (schema) => Boolean(schema.enum))
      if (!found) throw new Error('golden tree has no enum prop')
      const option =
        AI_PALETTE[found.node.componentId].propsSchema.properties[found.name]
          .enum![0]
      found.node.props = {
        ...found.node.props,
        [found.name]: option.toUpperCase(),
      }
      return input
    },
  },
  {
    name: 'a boolean given as prose',
    marker: 'yes please',
    apply: (input) => {
      const found = anyPropOfType(input, (schema) => schema.type === 'boolean')
      const target = found ?? { node: anyLeaf(input), name: 'disabled' }
      target.node.props = { ...target.node.props, [target.name]: 'yes please' }
      return input
    },
  },
  {
    name: 'a text prop given as an object',
    marker: 'nested-object-text',
    apply: (input) => {
      const { node, name } = anyTextProp(input)
      node.props = { ...node.props, [name]: { text: 'nested-object-text' } }
      return input
    },
  },
  {
    name: 'a node listing itself as a child',
    apply: (input) => {
      const container = anyContainer(input)
      container.nodes = [...(container.nodes ?? []), container.$id]
      return input
    },
  },
  {
    name: 'a node listed under two parents',
    apply: (input) => {
      const leaf = anyLeaf(input)
      input.nodes[input.rootId].nodes = [
        ...(input.nodes[input.rootId].nodes ?? []),
        leaf.$id,
      ]
      return input
    },
  },
  {
    name: 'a child list that is not a list',
    apply: (input) => {
      ;(anyContainer(input) as Record<string, unknown>).nodes = 'n1'
      return input
    },
  },
  {
    name: 'a parentId pointing elsewhere',
    apply: (input) => {
      anyLeaf(input).parentId = input.rootId === 'f1' ? 'nowhere' : 'nowhere'
      return input
    },
  },
  {
    name: 'a child id that names no node',
    marker: 'ghost',
    apply: (input) => {
      const container = anyContainer(input)
      container.nodes = [...(container.nodes ?? []), 'ghost']
      return input
    },
  },
  {
    name: 'a className on a node',
    marker: 'evil-class',
    apply: (input) => {
      anyLeaf(input).className = 'evil-class'
      return input
    },
  },
  {
    name: 'interactions on a node',
    marker: 'elementClick',
    apply: (input) => {
      anyLeaf(input).interactions = [{ event: 'elementClick' }]
      return input
    },
  },
  {
    name: 'a hidden flag that is not a boolean',
    marker: 'sometimes',
    apply: (input) => {
      anyLeaf(input).hidden = 'sometimes'
      return input
    },
  },
  {
    name: 'a root swapped for a plain element',
    marker: 'swapped-root',
    apply: (input) => {
      input.nodes[input.rootId].componentId =
        input.rootId === 'f1' ? 'muiStack' : 'muiStack'
      input.nodes[input.rootId].props = { ariaLabel: 'swapped-root' }
      return input
    },
  },
  {
    name: 'a tree past the byte ceiling',
    apply: (input) => {
      const container = anyContainer(input)
      const filler = AI_SURFACES.email.allow.includes(container.componentId)
        ? 'emailText'
        : container.componentId === 'form'
          ? 'formField'
          : 'muiTypography'
      const count = Math.ceil(NODE_MAP_MAX_BYTES / 60)
      for (let index = 0; index < count; index += 1) {
        const id = `bulk${index}`
        input.nodes[id] = {
          $id: id,
          componentId: filler,
          parentId: container.$id,
          props: { children: `Line ${index} of far too many lines` },
        }
        container.nodes = [...(container.nodes ?? []), id]
      }
      return input
    },
  },
]

describe('validateAiNodeTree fuzz (AGL-2905)', () => {
  const cases = AI_SURFACE_NAMES.flatMap((surface) =>
    MUTATIONS.filter((mutation) => !mutation.skip?.includes(surface)).map(
      (mutation) => [surface, mutation.name, mutation] as const,
    ),
  )

  it('runs at least thirty mutations against every surface', () => {
    expect(MUTATIONS.length).toBeGreaterThanOrEqual(30)
  })

  it.each(cases)(
    '%s: %s is repaired or refused, never passed through',
    (surface, _name, mutation) => {
      const applied = mutation.apply(clone(GOLDEN[surface]()), surface)
      const input = 'context' in applied ? applied.input : applied
      const context = 'context' in applied ? applied.context : undefined
      const result = validateAiNodeTree(input, surface, context)
      if (result.ok === false) {
        expect(result.error).toBeTruthy()
        expect(result.code).toBeTruthy()
        return
      }
      expect(result.repairs.length).toBeGreaterThan(0)
      if (mutation.marker) {
        expect(JSON.stringify(result.nodes)).not.toContain(mutation.marker)
      }
    },
  )

  it('lists what it dropped by node and prop', () => {
    const input = GOLDEN.screen()
    const button = firstOf(input, 'muiButton')
    button.props = {
      ...button.props,
      variant: 'Contained',
      onClick: 'alert(1)',
      href: 'javascript:alert(1)',
    }
    const result = validateAiNodeTree(input, 'screen')
    ok(result)
    expect(result.repairs).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          `${button.$id}.variant was spelled "Contained"`,
        ),
        expect.stringContaining(`${button.$id}.onClick`),
        expect.stringContaining(`${button.$id}.href`),
      ]),
    )
    const out = Object.values(result.nodes).find(
      (node) => node.componentId === 'muiButton',
    )
    expect(out?.props).toEqual({ variant: 'contained', children: 'Start free' })
  })

  it('names the refusal for each structural failure', () => {
    const disallowed = GOLDEN.screen()
    anyLeaf(disallowed).componentId = 'custom-html'
    expect(validateAiNodeTree(disallowed, 'screen')).toMatchObject({
      ok: false,
      code: 'component',
    })

    const lineage = GOLDEN.screen()
    addChild(lineage, anyContainer(lineage), {
      $id: 'tb',
      componentId: 'muiToolbar',
    })
    expect(validateAiNodeTree(lineage, 'screen')).toMatchObject({
      ok: false,
      code: 'lineage',
    })

    const wrongRoot = GOLDEN.form()
    wrongRoot.nodes[wrongRoot.rootId].componentId = 'formField'
    expect(validateAiNodeTree(wrongRoot, 'form')).toMatchObject({
      ok: false,
      code: 'root',
    })

    const empty = { rootId: '_@_', nodes: { '_@_': { componentId: 'div' } } }
    expect(validateAiNodeTree(empty, 'screen')).toMatchObject({
      ok: false,
      code: 'structure',
    })
  })
})

describe('validateAiNodeTree required props (AGL-2905)', () => {
  it('refuses a tree whose node omits a prop the palette requires', () => {
    jest.isolateModules(() => {
      const generated = jest.requireActual(
        './ai-palette.generated',
      )
      const palette = clone(generated.AI_PALETTE)
      palette.muiButton.propsSchema.required = ['children']
      jest.doMock('./ai-palette.generated', () => ({
        ...generated,
        AI_PALETTE: palette,
      }))
      const { validateAiNodeTree: validate } = jest.requireActual(
        './ai-node-tree',
      ) as typeof import('./ai-node-tree')
      const input = GOLDEN.screen()
      const button = firstOf(input, 'muiButton')
      delete button.props!.children
      expect(validate(input, 'screen')).toMatchObject({
        ok: false,
        code: 'required-prop',
      })
      button.props!.children = 'Start free'
      expect(validate(input, 'screen').ok).toBe(true)
    })
  })
})

describe('validateAiNodeTree site references (AGL-2935)', () => {
  const withInstance = () =>
    tree({
      componentId: 'div',
      children: [
        {
          componentId: 'section',
          props: { element: 'section' },
          children: [
            {
              componentId: 'reusableInstance',
              props: {
                refId: 'cmp-card',
                propValues: {
                  title: 'Roofs',
                  photo: 'https://example.com/roof.jpg',
                  count: '3',
                  stray: 'x',
                  'bad.name': 'y',
                },
              },
            },
          ],
        },
      ],
    })

  const formPlaced = (props: Record<string, unknown>) =>
    tree({
      componentId: 'div',
      children: [
        {
          componentId: 'section',
          props: { element: 'section' },
          children: [{ componentId: 'form', props }],
        },
      ],
    })

  it('refuses an instance nobody grounded, and one naming a component the site does not have', () => {
    expect(validateAiNodeTree(withInstance(), 'screen')).toMatchObject({
      ok: false,
      code: 'component',
    })
    expect(
      validateAiNodeTree(withInstance(), 'screen', { componentIds: ['cmp-other'] }),
    ).toMatchObject({ ok: false, code: 'reference' })
  })

  it('admits an instance of a listed component, holding its values to the declared props', () => {
    const result = validateAiNodeTree(withInstance(), 'screen', {
      componentIds: ['cmp-card'],
      componentProps: { 'cmp-card': { title: 'text', photo: 'image', count: 'number' } },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const instance = Object.values(result.nodes).find(
      (node) => node.componentId === 'reusableInstance',
    )
    expect(instance?.props).toEqual({
      refId: 'cmp-card',
      propValues: { title: 'Roofs', photo: 'https://example.com/roof.jpg', count: 3 },
    })
    expect(result.repairs).toEqual(
      expect.arrayContaining([
        expect.stringContaining('propValues.stray is not a prop of that component'),
        expect.stringContaining('propValues.bad.name is not a prop name'),
      ]),
    )
  })

  it('leaves an icon a page fills with a word for the site owner to pick (AGL-3054)', () => {
    const placed = tree({
      componentId: 'div',
      children: [
        {
          componentId: 'section',
          props: { element: 'section' },
          children: [
            { componentId: 'reusableInstance', props: { refId: 'cmp-area', propValues: { title: 'Family law', icon: 'family' } } },
          ],
        },
      ],
    })
    const result = validateAiNodeTree(placed, 'screen', {
      componentIds: ['cmp-area'],
      componentProps: { 'cmp-area': { title: 'text', icon: 'icon' } },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.values(result.nodes).find((node) => node.componentId === 'reusableInstance')?.props).toEqual({
      refId: 'cmp-area',
      propValues: { title: 'Family law' },
    })
    expect(result.repairs).toEqual([
      expect.stringContaining('propValues.icon is an icon, which the site owner picks from the library; dropped'),
    ])
  })

  it('lets a draft bound a repeat on any element, and offers the scope only where children exist (AGL-3156)', () => {
    // Repeat is a node capability, not a Stack's feature (AGL-3111). The
    // palette declares it once and every element carries it, so these props
    // survive on a Stack and on a leaf alike — before this they were props of
    // no component, and the sanitizer dropped every one of them.
    const placed = tree({
      componentId: 'div',
      children: [
        {
          componentId: 'section',
          props: { element: 'section' },
          children: [
            {
              componentId: 'muiStack',
              props: {
                repeatLimit: '6',
                repeatSort: 'price desc',
                repeatFilter: 'tier == plus',
                repeatSelf: 'true',
              },
              children: [
                {
                  componentId: 'muiTypography',
                  props: {
                    children: '{{item.name}}',
                    repeatLimit: '3',
                    // A leaf can only repeat itself, so the scope is not
                    // offered on one and a draft that writes it is repaired.
                    repeatSelf: 'true',
                  },
                },
              ],
            },
          ],
        },
      ],
    })
    const result = validateAiNodeTree(placed, 'screen')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const stack = Object.values(result.nodes).find(
      (node) => node.componentId === 'muiStack',
    )
    expect(stack?.props).toEqual({
      repeatLimit: '6',
      repeatSort: 'price desc',
      repeatFilter: 'tier == plus',
      repeatSelf: 'true',
    })
    const leaf = Object.values(result.nodes).find(
      (node) => node.componentId === 'muiTypography',
    )
    expect(leaf?.props).toEqual({ children: '{{item.name}}', repeatLimit: '3' })
    expect(result.repairs).toEqual([
      expect.stringContaining('repeatSelf is not a prop of'),
    ])
  })

  it('keeps a form bound to a form and a dataset the site has, and drops a binding it does not', () => {
    const kept = validateAiNodeTree(
      formPlaced({ formId: 'frm-contact', datasetId: 'ds-leads' }),
      'screen',
      { formIds: ['frm-contact'], datasetIds: ['ds-leads'] },
    )
    expect(kept.ok).toBe(true)
    if (!kept.ok) return
    expect(
      Object.values(kept.nodes).find((node) => node.componentId === 'form')?.props,
    ).toMatchObject({ formId: 'frm-contact', datasetId: 'ds-leads' })

    const dropped = validateAiNodeTree(formPlaced({ formId: 'frm-unknown' }), 'screen', {
      formIds: ['frm-contact'],
    })
    expect(dropped.ok).toBe(true)
    if (!dropped.ok) return
    expect(
      Object.values(dropped.nodes).find((node) => node.componentId === 'form')?.props,
    ).not.toHaveProperty('formId')
    expect(dropped.repairs).toEqual(
      expect.arrayContaining([
        expect.stringContaining('formId names a form this site does not have'),
      ]),
    )
  })

  it('maps every minted id back to the id the model wrote for that node', () => {
    const input = GOLDEN.screen()
    const result = validateAiNodeTree(input, 'screen')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.values(result.sourceIds).sort()).toEqual(Object.keys(input.nodes).sort())
    for (const [minted, source] of Object.entries(result.sourceIds)) {
      expect(result.nodes[minted].componentId).toBe(input.nodes[source].componentId)
    }
  })
})

describe('validateAiNodeTree binding tokens (AGL-2909)', () => {
  const bound = (image: Record<string, unknown>) =>
    tree({
      componentId: 'div',
      children: [
        {
          componentId: 'section',
          props: { element: 'section' },
          children: [
            { componentId: 'image', props: image },
            { componentId: 'muiTypography', props: { children: '{{entry.title}}' } },
          ],
        },
      ],
    })
  const propsOf = (result: AiNodeTreeResult, componentId: string) =>
    result.ok
      ? Object.values(result.nodes).find((node) => node.componentId === componentId)?.props
      : undefined
  const TOKENS = ['{{entry.coverImage}}', '{{entry.url}}']

  it('drops a token from a link or media prop when the caller named none', () => {
    const result = validateAiNodeTree(
      bound({ src: '{{entry.coverImage}}', href: '{{entry.url}}', alt: 'The cover' }),
      'screen',
    )
    expect(result.ok).toBe(true)
    expect(propsOf(result, 'image')).not.toHaveProperty('src')
    expect(propsOf(result, 'image')).not.toHaveProperty('href')
    // Copy keeps its tokens either way: a text prop is no address.
    expect(propsOf(result, 'muiTypography')).toMatchObject({ children: '{{entry.title}}' })
  })

  it('keeps a token the caller named, whole, in a link or media prop', () => {
    const result = validateAiNodeTree(
      bound({ src: ' {{entry.coverImage}} ', href: '{{entry.url}}', alt: 'Cover for {{entry.title}}' }),
      'screen',
      { bindingTokens: TOKENS },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(propsOf(result, 'image')).toMatchObject({
      src: '{{entry.coverImage}}',
      href: '{{entry.url}}',
      alt: 'Cover for {{entry.title}}',
    })
    expect(result.repairs.filter((repair) => /\.(src|href) /.test(repair))).toEqual([])
  })

  it('admits no named token inside a longer value, none that is not named, and none in a screen prop', () => {
    const result = validateAiNodeTree(
      bound({
        src: 'javascript:{{entry.coverImage}}',
        href: '{{entry.authorUrl}}',
        screenId: '{{entry.url}}',
        alt: 'The cover',
      }),
      'screen',
      { bindingTokens: TOKENS },
    )
    expect(result.ok).toBe(true)
    const image = propsOf(result, 'image')
    expect(image).not.toHaveProperty('src')
    expect(image).not.toHaveProperty('href')
    expect(image).not.toHaveProperty('screenId')
  })
})

describe('validateAiNodeTree component definitions (AGL-2908)', () => {
  const card = () =>
    tree({
      componentId: 'div',
      children: [
        {
          componentId: 'muiCard',
          props: { variant: 'outlined' },
          children: [
            {
              componentId: 'image',
              props: { src: '{{prop.photo}}', alt: 'Portrait of {{prop.name}}', hideIf: '{{prop.hidePhoto}}' },
            },
            {
              componentId: 'muiButton',
              props: {
                children: '{{prop.label}}',
                variant: '{{prop.style}}',
                fullWidth: '{{prop.wide}}',
                screenId: '{{prop.link}}',
                href: '{{prop.url}}',
              },
            },
          ],
        },
      ],
    })
  const propsOf = (result: AiNodeTreeResult, componentId: string) =>
    result.ok
      ? Object.values(result.nodes).find((node) => node.componentId === componentId)?.props
      : undefined

  it('keeps a component’s own tokens whole in fields that are not copy and in the visibility directives, when the tree defines a component', () => {
    const result = validateAiNodeTree(card(), 'component', { definesComponent: true })
    expect(result.ok).toBe(true)
    expect(propsOf(result, 'image')).toEqual({
      src: '{{prop.photo}}',
      alt: 'Portrait of {{prop.name}}',
      hideIf: '{{prop.hidePhoto}}',
    })
    expect(propsOf(result, 'muiButton')).toEqual({
      children: '{{prop.label}}',
      variant: '{{prop.style}}',
      fullWidth: '{{prop.wide}}',
      screenId: '{{prop.link}}',
      href: '{{prop.url}}',
    })
    if (result.ok) expect(result.repairs).toEqual([])
  })

  it('drops them like any value the field cannot hold when the tree defines no component, and keeps copy either way', () => {
    const result = validateAiNodeTree(card(), 'component')
    expect(result.ok).toBe(true)
    expect(propsOf(result, 'image')).toEqual({ alt: 'Portrait of {{prop.name}}' })
    expect(propsOf(result, 'muiButton')).toEqual({ children: '{{prop.label}}' })
  })

  it('keeps nothing but a whole property token: not one inside a value, another namespace’s, or a literal directive', () => {
    const mixed = tree({
      componentId: 'div',
      children: [
        {
          componentId: 'muiButton',
          props: {
            children: 'Get a quote',
            variant: 'Style {{prop.style}}',
            fullWidth: '{{entry.wide}}',
            href: 'javascript:{{prop.url}}',
            hideIf: 'true',
          },
        },
      ],
    })
    const result = validateAiNodeTree(mixed, 'component', { definesComponent: true })
    expect(result.ok).toBe(true)
    expect(propsOf(result, 'muiButton')).toEqual({ children: 'Get a quote' })
  })

  it('binds an Icon’s pick to an icon property, and drops an icon a model names itself, whose drawing it cannot write (AGL-3054)', () => {
    const icons = tree({
      componentId: 'div',
      children: [
        { componentId: 'icon', props: { iconId: '{{prop.icon}}' } },
        { componentId: 'icon', props: { iconId: 'mdiScaleBalance', size: '32' } },
        { componentId: 'muiButton', props: { children: 'Call us', startIconId: 'mdiPhone' } },
      ],
    })
    const result = validateAiNodeTree(icons, 'component', { definesComponent: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.values(result.nodes).filter((node) => node.componentId === 'icon').map((node) => node.props)).toEqual([
      { iconId: '{{prop.icon}}' },
      { size: '32' },
    ])
    expect(propsOf(result, 'muiButton')).toEqual({ children: 'Call us' })
    expect(result.repairs).toEqual([
      expect.stringContaining('.iconId is an icon, which the site owner picks from the library; dropped'),
      expect.stringContaining('.startIconId is an icon, which the site owner picks from the library; dropped'),
    ])
    // A page's surface places no Icon of its own.
    expect(validateAiNodeTree(icons, 'screen')).toMatchObject({ ok: false, code: 'component' })
  })

  it('hands a whole token on to a placed component’s values only while the tree defines a component', () => {
    const placed = tree({
      componentId: 'div',
      children: [
        {
          componentId: 'reusableInstance',
          props: { refId: 'cmp-avatar', propValues: { picture: '{{prop.photo}}', size: '{{prop.size}}' } },
        },
      ],
    })
    const context = {
      definesComponent: true,
      componentIds: ['cmp-avatar'],
      componentProps: { 'cmp-avatar': { picture: 'image', size: 'number' } },
    }
    expect(propsOf(validateAiNodeTree(placed, 'component', context), 'reusableInstance')).toEqual({
      refId: 'cmp-avatar',
      propValues: { picture: '{{prop.photo}}', size: '{{prop.size}}' },
    })
    expect(
      propsOf(validateAiNodeTree(placed, 'component', { ...context, definesComponent: false }), 'reusableInstance'),
    ).toEqual({ refId: 'cmp-avatar' })
  })
})
