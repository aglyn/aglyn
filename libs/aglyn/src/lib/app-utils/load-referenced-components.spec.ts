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
 * THE COMPONENTS ONE DOCUMENT PLACES, AND NOTHING ELSE (AGL-3287).
 *
 * An email is rendered on demand — sent, test-sent, previewed — so it cannot
 * lean on the page cache that makes `getComponents`' whole-site read cheap.
 * What it may read is the components it places, however deeply they nest, and
 * not one document more. These pin that, against a fake store that counts.
 */

import { compress } from './compress'
import {
  MAX_COMPONENT_DEPTH,
  REUSABLE_INSTANCE_COMPONENT_ID,
} from './compose-reusable-components'
import {
  composeHostComponentNodes,
  composeReferencedComponents,
  hostComponentReader,
  loadReferencedComponents,
  readStoredComponentTree,
  type ComponentStoreLike,
  type LoadReferencedComponentsOptions,
  type SkippedComponent,
  type StoredComponentDocument,
} from './load-referenced-components'

const ROOT = '_@_'

/** A placement of component `refId` under the document root. */
const placement = (
  id: string,
  refId: string,
  extra: Record<string, unknown> = {},
) => ({
  $id: id,
  componentId: REUSABLE_INSTANCE_COMPONENT_ID,
  parentId: ROOT,
  props: { refId, ...((extra['props'] as object) ?? {}) },
  nodes: [] as string[],
  ...Object.fromEntries(
    Object.entries(extra).filter(([key]) => key !== 'props'),
  ),
})

/** A document whose root holds the given nodes, in order. */
const documentOf = (
  ...children: Array<{ $id: string }>
): Record<string, Record<string, unknown>> => ({
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: children.map((c) => c.$id) },
  ...Object.fromEntries(children.map((child) => [child.$id, child])),
})

/** A published definition whose root is one text block. */
const textComponent = (
  text: string,
  extra: Partial<StoredComponentDocument> = {},
): StoredComponentDocument => ({
  rootId: 'txt',
  nodes: {
    txt: { $id: 'txt', componentId: 'emailText', props: { children: text } },
  },
  ...extra,
})

/** A published definition whose section holds a placement of `refId`. */
const nestingComponent = (refId: string): StoredComponentDocument => ({
  rootId: 'sec',
  nodes: {
    sec: { $id: 'sec', componentId: 'emailSection', nodes: ['inner'] },
    inner: {
      $id: 'inner',
      componentId: REUSABLE_INSTANCE_COMPONENT_ID,
      parentId: 'sec',
      props: { refId },
      nodes: [],
    },
  },
})

/** A reader over an in-memory site that records every id it was asked. */
function siteOf(components: Record<string, StoredComponentDocument>) {
  const asked: string[] = []
  const read = async (id: string) => {
    asked.push(id)
    return components[id] ?? null
  }
  return { asked, read }
}

/** Every text a composed map would draw, in no particular order. */
const textsOf = (nodes: Record<string, unknown>) =>
  Object.values(nodes)
    .map(
      (node) => (node as { props?: { children?: unknown } })?.props?.children,
    )
    .filter((text): text is string => typeof text === 'string')

const quiet: LoadReferencedComponentsOptions = { onSkipped: () => undefined }

describe('loadReferencedComponents', () => {
  it('reads only the components the document places', async () => {
    const { asked, read } = siteOf({
      header: textComponent('Acme header'),
      footer: textComponent('Acme footer'),
      // Published, on the same site, placed nowhere in this document.
      hero: textComponent('A hero nobody placed'),
      pricing: textComponent('A pricing table'),
    })
    const definitions = await loadReferencedComponents(
      documentOf(placement('a', 'header'), placement('b', 'footer')),
      read,
      quiet,
    )
    expect(asked.sort()).toEqual(['footer', 'header'])
    expect(Object.keys(definitions).sort()).toEqual(['footer', 'header'])
  })

  it('reads nothing at all for a document that places nothing', async () => {
    const { asked, read } = siteOf({ header: textComponent('Acme header') })
    const plain = documentOf({ $id: 't', componentId: 'emailText' } as never)
    expect(await loadReferencedComponents(plain, read, quiet)).toEqual({})
    expect(asked).toEqual([])
  })

  it('follows a component placed inside a component', async () => {
    const { asked, read } = siteOf({
      header: nestingComponent('logo'),
      logo: textComponent('Acme logo'),
    })
    const definitions = await loadReferencedComponents(
      documentOf(placement('a', 'header')),
      read,
      quiet,
    )
    expect(asked).toEqual(['header', 'logo'])
    expect(Object.keys(definitions).sort()).toEqual(['header', 'logo'])
  })

  it('reads each component once, whatever places it and however it cycles', async () => {
    const { asked, read } = siteOf({
      a: nestingComponent('b'),
      b: nestingComponent('a'),
    })
    await loadReferencedComponents(
      documentOf(
        placement('p1', 'a'),
        placement('p2', 'a'),
        placement('p3', 'b'),
      ),
      read,
      quiet,
    )
    expect(asked.sort()).toEqual(['a', 'b'])
  })

  it('stops where the graft stops expanding', async () => {
    // A chain two levels deeper than the graft will ever expand.
    const chain = Array.from(
      { length: MAX_COMPONENT_DEPTH + 2 },
      (_, i) => `c${i}`,
    )
    const components = Object.fromEntries(
      chain.map((id, i) => [
        id,
        i + 1 < chain.length
          ? nestingComponent(chain[i + 1])
          : textComponent('end'),
      ]),
    )
    const { asked, read } = siteOf(components)
    await loadReferencedComponents(
      documentOf(placement('p', 'c0')),
      read,
      quiet,
    )
    expect(asked).toEqual(chain.slice(0, MAX_COMPONENT_DEPTH))
  })

  it('leaves out a deleted component, and says so with its id', async () => {
    const { read } = siteOf({
      header: textComponent('Acme header', { deletedAt: { seconds: 1 } }),
      footer: textComponent('Acme footer'),
    })
    const onSkipped = jest.fn<void, [readonly SkippedComponent[]]>()
    const definitions = await loadReferencedComponents(
      documentOf(placement('a', 'header'), placement('b', 'footer')),
      read,
      { onSkipped },
    )
    expect(Object.keys(definitions)).toEqual(['footer'])
    expect(onSkipped).toHaveBeenCalledTimes(1)
    expect(onSkipped.mock.calls[0][0]).toEqual([
      { id: 'header', reason: 'deleted' },
    ])
  })

  it('names why each other placement gave nothing', async () => {
    const { asked, read } = siteOf({
      draft: { nodes: { x: { $id: 'x' } } },
      garbled: { rootId: 'x', nodes: Buffer.from([0xc1, 0xc1, 0xc1]) },
    })
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const onSkipped = jest.fn<void, [readonly SkippedComponent[]]>()
    try {
      await loadReferencedComponents(
        documentOf(
          placement('a', 'draft'),
          placement('b', 'garbled'),
          placement('c', 'gone'),
          // A reference that is a PATH, not an id: never handed to `doc()`,
          // where it would throw or read beneath some other document.
          placement('d', 'hosts/other/components/x'),
          placement('e', '__reserved__'),
        ),
        read,
        { onSkipped },
      )
    } finally {
      spy.mockRestore()
    }
    expect(asked.sort()).toEqual(['draft', 'garbled', 'gone'])
    expect(onSkipped.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        { id: 'draft', reason: 'unpublished' },
        { id: 'garbled', reason: 'undecodable' },
        { id: 'gone', reason: 'missing' },
        { id: 'hosts/other/components/x', reason: 'invalid' },
        { id: '__reserved__', reason: 'invalid' },
      ]),
    )
  })

  it('reads no more documents than it is allowed', async () => {
    const { asked, read } = siteOf({
      a: textComponent('a'),
      b: textComponent('b'),
      c: textComponent('c'),
    })
    const onSkipped = jest.fn<void, [readonly SkippedComponent[]]>()
    const definitions = await loadReferencedComponents(
      documentOf(
        placement('p1', 'a'),
        placement('p2', 'b'),
        placement('p3', 'c'),
      ),
      read,
      { maxDocuments: 2, onSkipped },
    )
    expect(asked).toHaveLength(2)
    expect(Object.keys(definitions)).toHaveLength(2)
    expect(onSkipped.mock.calls[0][0]).toEqual([
      expect.objectContaining({ reason: 'limit' }),
    ])
  })

  it('fails the whole load when a read fails', async () => {
    // A quietly partial design is the one outcome no caller wants: an email
    // mailed without its footer because one request timed out.
    const read = async (id: string) => {
      if (id === 'footer') throw new Error('unavailable')
      return textComponent('Acme header')
    }
    await expect(
      loadReferencedComponents(
        documentOf(placement('a', 'header'), placement('b', 'footer')),
        read,
        quiet,
      ),
    ).rejects.toThrow('unavailable')
  })
})

describe('readStoredComponentTree', () => {
  it('reads both stored forms the same way (AGL-1151)', () => {
    const stored = textComponent('Acme header')
    const plain = readStoredComponentTree(stored)
    const packed = readStoredComponentTree({
      ...stored,
      nodes: Buffer.from(compress(stored.nodes)),
    })
    expect(plain.ok).toBe(true)
    expect(packed).toEqual(plain)
  })

  it('carries declared props, and only a real list of them', () => {
    const props = [{ name: 'title', type: 'text' }]
    const read = readStoredComponentTree(textComponent('x', { props }))
    expect(read.ok === true && read.tree.props).toEqual(props)
    const none = readStoredComponentTree(textComponent('x', { props: [] }))
    expect(none.ok === true && 'props' in none.tree).toBe(false)
  })
})

describe('composeReferencedComponents', () => {
  it('returns a document that places nothing as it was given, unread', async () => {
    const { asked, read } = siteOf({})
    const plain = documentOf({ $id: 't', componentId: 'emailText' } as never)
    expect(await composeReferencedComponents(plain, read)).toBe(plain)
    expect(asked).toEqual([])
  })

  it('draws a placed component, nested ones included, with the placement’s values', async () => {
    const { read } = siteOf({
      header: {
        rootId: 'sec',
        props: [{ name: 'title', type: 'text', defaultValue: 'Default title' }],
        nodes: {
          sec: {
            $id: 'sec',
            componentId: 'emailSection',
            nodes: ['txt', 'logo'],
          },
          txt: {
            $id: 'txt',
            componentId: 'emailText',
            parentId: 'sec',
            // A merge token beside the property token: the graft owns only
            // the second, and the first must reach the mail renderer intact.
            props: { children: '{{prop.title}} for {{contact.firstName}}' },
          },
          logo: {
            $id: 'logo',
            componentId: REUSABLE_INSTANCE_COMPONENT_ID,
            parentId: 'sec',
            props: { refId: 'logo' },
            nodes: [],
          },
        },
      },
      logo: textComponent('Acme logo'),
    })
    const composed = await composeReferencedComponents(
      documentOf(
        placement('hdr', 'header', {
          props: { propValues: { title: 'Spring news' } },
        }),
      ),
      read,
      quiet,
    )
    expect(textsOf(composed)).toEqual(
      expect.arrayContaining([
        'Spring news for {{contact.firstName}}',
        'Acme logo',
      ]),
    )
    // The placement IS the component's root now (AGL-2521): same id, real block.
    expect((composed['hdr'] as { componentId?: string }).componentId).toBe(
      'emailSection',
    )
    expect(
      Object.values(composed).some(
        (node) =>
          (node as { componentId?: string })?.componentId ===
          REUSABLE_INSTANCE_COMPONENT_ID,
      ),
    ).toBe(false)
  })

  it('leaves a placement of a deleted component standing, drawing nothing', async () => {
    const { read } = siteOf({
      header: textComponent('Acme header', { deletedAt: new Date() }),
    })
    const document = documentOf(placement('hdr', 'header'))
    const composed = await composeReferencedComponents(document, read, quiet)
    expect(composed['hdr']).toEqual(document['hdr'])
    expect(textsOf(composed)).toEqual([])
  })
})

describe('the Admin reader', () => {
  /** A store keyed by document path, walking the chain the reader builds. */
  function storeOf(documents: Record<string, object>) {
    const paths: string[] = []
    const docRef = (path: string): any => ({
      get: async () => {
        paths.push(path)
        const data = documents[path] as Record<string, unknown> | undefined
        return {
          exists: data !== undefined,
          get: (field: string) => data?.[field],
        }
      },
      collection: (name: string) => ({
        doc: (id: string) => docRef(`${path}/${name}/${id}`),
      }),
    })
    const store: ComponentStoreLike = {
      collection: (name: string) => ({
        doc: (id: string) => docRef(`${name}/${id}`),
      }),
    }
    return { store, paths }
  }

  it('reads the site’s own component document, and nothing but the fields a render needs', async () => {
    const { store, paths } = storeOf({
      'hosts/h1/components/header': {
        ...textComponent('Acme header'),
        displayName: 'Header',
        updatedAt: 'yesterday',
      },
    })
    const read = hostComponentReader(store, 'h1')
    expect(await read('header')).toEqual({
      ...textComponent('Acme header'),
      props: undefined,
      deletedAt: undefined,
    })
    expect(await read('missing')).toBeNull()
    expect(paths).toEqual([
      'hosts/h1/components/header',
      'hosts/h1/components/missing',
    ])
  })

  it('composes a site’s document and logs what it skipped against the site', async () => {
    const { store } = storeOf({
      'hosts/h1/components/header': textComponent('Acme header'),
    })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const composed = await composeHostComponentNodes(
        documentOf(placement('a', 'header'), placement('b', 'deleted-footer')),
        { firestore: store, hostId: 'h1' },
      )
      expect(textsOf(composed)).toEqual(['Acme header'])
      expect(warn).toHaveBeenCalledTimes(1)
      expect(JSON.parse(String(warn.mock.calls[0][0]))).toEqual({
        tag: 'AGL-3287:components-skipped',
        hostId: 'h1',
        skipped: [{ id: 'deleted-footer', reason: 'missing' }],
      })
    } finally {
      warn.mockRestore()
    }
  })
})
