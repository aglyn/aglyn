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
 * Sizes on a page already published, with nothing re-saved (AGL-3485).
 *
 * A tree shaped like edr-construction.aglyn.app's home page, composed the way
 * the tenant composes it — the reusable card grafted, the repeat expanded, the
 * assets' pixel pairs laid on — and rendered with NO measurement anywhere.
 * Every `sizes` below comes from the tree alone, which is what lets every
 * existing site get them on its next render.
 */

import * as Aglyn from '@aglyn/aglyn'
import { applyMediaAssetFacts } from '@aglyn/aglyn/app-utils/media-asset-facts'
import { render } from '@testing-library/react'
import Image, { type ImageProps } from './image'

const ROOT = Aglyn.NODE_ROOT_ID

/** The project card, as its reusable component stores it. */
const CARD = {
  rootId: 'cardRoot',
  nodes: {
    cardRoot: {
      $id: 'cardRoot',
      type: 'node',
      componentId: 'muiCard',
      nodes: ['photo', 'content'],
      props: { variant: 'outlined', component: 'article' },
    },
    photo: {
      $id: 'photo',
      type: 'node',
      parentId: 'cardRoot',
      componentId: 'image',
      props: { src: '{{item.photo}}', alt: '{{item.photo_alt}}', loading: 'lazy' },
      sx: { width: '100%', aspectRatio: '4 / 3', display: 'block' },
    },
    content: {
      $id: 'content',
      type: 'node',
      parentId: 'cardRoot',
      componentId: 'muiCardContent',
      sx: { p: 3 },
    },
  },
} as any

const node = (
  id: string,
  parentId: string | undefined,
  componentId: string,
  extra: Record<string, unknown> = {},
) => ({ $id: id, type: 'node', parentId, componentId, ...extra })

/** The page as stored: the layout's header, and a services grid. */
const STORED = {
  [ROOT]: node(ROOT, undefined, 'box', {
    nodes: ['layout__header', 'section'],
  }),
  layout__header: node('layout__header', ROOT, 'section', {
    nodes: ['layout__bar'],
  }),
  layout__bar: node('layout__bar', 'layout__header', 'muiContainer', {
    nodes: ['layout__logo'],
    props: { maxWidth: 'xl' },
  }),
  layout__logo: node('layout__logo', 'layout__bar', 'image', {
    props: {
      src: 'media:site1/logo',
      alt: '',
      decorative: true,
      objectFit: 'contain',
      loading: 'eager',
    },
    sx: { height: { xs: 44, md: 56 }, width: 'auto' },
  }),
  section: node('section', ROOT, 'section', { nodes: ['container'] }),
  container: node('container', 'section', 'muiContainer', {
    nodes: ['column'],
    props: { maxWidth: 'lg' },
  }),
  column: node('column', 'container', 'muiBox', {
    nodes: ['grid'],
    sx: { display: 'flex', flexDirection: 'column', gap: { xs: 5, md: 7 } },
  }),
  grid: node('grid', 'column', 'muiBox', {
    nodes: ['card'],
    props: { repeatDataset: 'Projects' },
    sx: {
      display: 'grid',
      gridTemplateColumns: {
        xs: '1fr',
        sm: 'repeat(2, 1fr)',
        md: 'repeat(3, 1fr)',
      },
      gap: { xs: 3, md: 4 },
      width: '100%',
    },
  }),
  card: node('card', 'grid', Aglyn.REUSABLE_INSTANCE_COMPONENT_ID, {
    props: { refId: 'projectCard', name: 'Project card' },
    nodes: [],
  }),
} as any

const PROJECTS = {
  records: [
    { $id: 'p1', photo: 'media:site1/drive', photo_alt: 'A driveway' },
    { $id: 'p2', photo: 'media:site1/patio', photo_alt: 'A patio' },
  ],
}

/** The page as the tenant composes it, with every asset's pair laid on. */
const composed = applyMediaAssetFacts(
  Aglyn.expandRepeatables(
    Aglyn.composeReusableComponentNodes(STORED, { projectCard: CARD }),
    { Projects: PROJECTS },
  ),
  new Map([
    ['site1/logo', { width: 1200, height: 986 }],
    ['site1/drive', { width: 1600, height: 900 }],
    ['site1/patio', { width: 1185, height: 941 }],
  ]),
) as Record<string, any>

/** Renders one node of the composed page as the renderer does. */
const sizesOf = (id: string) => {
  const target = composed[id]
  const img = render(
    <Aglyn.NodeIdentityContext.Provider value={id}>
      <Image {...(target.props as ImageProps)} sx={target.sx} />
    </Aglyn.NodeIdentityContext.Provider>,
  ).container.querySelector('img')!
  return img.getAttribute('sizes')
}

beforeEach(() => Aglyn.canvas.setNodes(composed as never))
afterEach(() => Aglyn.canvas.clearNodes())

describe('sizes on a composed page with no measurement (AGL-3485)', () => {
  it('composes the shape the published page ships', () => {
    expect(composed['grid'].nodes).toEqual([
      'rep__grid__0__card',
      'rep__grid__1__card',
    ])
    expect(composed['rep__grid__0__cmp__card__photo']).toMatchObject({
      componentId: 'image',
      props: {
        src: 'media:site1/drive',
        intrinsicWidth: 1600,
        intrinsicHeight: 900,
      },
    })
    expect(composed['rep__grid__0__cmp__card__photo'].props).not.toHaveProperty(
      'renderedWidths',
    )
  })

  it('sizes the header logo from its responsive height and its shape', () => {
    expect(sizesOf('layout__logo')).toBe('(min-width: 900px) 68px, 54px')
  })

  it('sizes each repeated card from the grid tracks, gaps and the Container', () => {
    const expected =
      '(min-width: 1200px) 363px, ' +
      '(min-width: 900px) calc(33.3vw - 37px), ' +
      '(min-width: 600px) calc(50vw - 36px), ' +
      'calc(100vw - 32px)'
    expect(sizesOf('rep__grid__0__cmp__card__photo')).toBe(expected)
    expect(sizesOf('rep__grid__1__cmp__card__photo')).toBe(expected)
  })
})
