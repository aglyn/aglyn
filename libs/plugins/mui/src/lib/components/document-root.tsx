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

import * as Aglyn from '@aglyn/aglyn'
import { mdiFileDocumentOutline } from '@aglyn/shared-data-mdi'
import MuiBox from '@mui/material/Box'
import { forwardRef, type ReactNode } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * The canvas ROOT's component id — the `Document` layer at the top of every
 * hierarchy (`NODE_ROOT_ID`). Persisted in screen and layout documents since
 * the first seed; never rename.
 *
 * Until now nothing was registered under it, so the renderer fell through to
 * its unstyled `styled('div')` fallback and the besigner's attributes panel
 * had no schema to draw: the Document layer could be styled and could not be
 * given an element. Registering the id changes no stored document — the same
 * `div` renders — and gives the root the one attribute it has always needed.
 */
export const ID: Aglyn.ComponentId = 'div'

/**
 * Elements the document root may render as (AGL-2486, widened by AGL-2514).
 *
 * `main` is offered here and on the Layout Slot, and nowhere else: those two
 * are the only nodes that can BE the page's content region, and
 * `stampDocumentLandmark` guarantees exactly one of them carries it.
 *
 * The rest of the list is the sectioning set `SECTION_ELEMENTS` offers, for
 * the same reason it offers them: the root is an element like any other, and
 * a document whose whole body is one region — a layout that is nothing but
 * chrome, a fragment composed into a larger page — had no way to say so. It
 * stayed `div` and the region went unnamed. A root that is `header` or
 * `footer` is a document with no `main`, which `stampDocumentLandmark`
 * already treats as the author's choice rather than a state to repair: it
 * hands the landmark to the slot when there is one, and otherwise ships the
 * page without.
 *
 * An allow-list rather than free text: the value is persisted and rendered
 * verbatim, so a typed one would put `script` into every visitor's page.
 */
export const DOCUMENT_ROOT_ELEMENTS = [
  'div',
  'main',
  'header',
  'footer',
  'nav',
  'aside',
  'section',
  'article',
] as const
export type DocumentRootElement = (typeof DOCUMENT_ROOT_ELEMENTS)[number]

export interface DocumentRootProps {
  /**
   * The DOM element rendered; defaults to `div`. On a screen with no shared
   * layout, composition fills in `main` — with no slot to carry it, the root
   * IS the page's content region.
   *
   * Named `component` like Box's and Typography's, not `element` like
   * Section's: the attribute means the same thing everywhere it appears, and
   * two names for it is one the author has to learn twice.
   */
  component?: DocumentRootElement | string
  children?: ReactNode
}

/**
 * The document root: the outermost node of a screen or layout tree.
 *
 * A plain container, as it has always been. It exists as a registered
 * component so the root can answer the two questions every other node can —
 * what element am I, and what does the attributes panel show — rather than
 * being the one node in the tree with no schema.
 */
const DocumentRoot = forwardRef<HTMLDivElement, DocumentRootProps>(
  (props, ref) => {
    const { component, children, ...rest } = props
    // Unknown values degrade to `div` rather than reaching the DOM as an
    // invented tag — the resolver pattern `Section` uses.
    const element = (DOCUMENT_ROOT_ELEMENTS as readonly string[]).includes(
      String(component ?? ''),
    )
      ? (component as DocumentRootElement)
      : 'div'
    return (
      <MuiBox ref={ref} component={element} {...rest}>
        {children}
      </MuiBox>
    )
  },
)
DocumentRoot.displayName = 'AglynDocumentRoot'

export const schema: Aglyn.ComponentSchema<DocumentRootProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: Aglyn.NODE_ROOT_LABEL,
  description:
    'The page itself — the outermost element every other element sits in.',
  category: Aglyn.ComponentCategory.LAYOUT,
  icon: { path: mdiFileDocumentOutline.path, sx: { color: 'text.secondary' } },
  attributes: [
    {
      name: 'component',
      label: 'Component',
      description:
        'The DOM element the page renders as. On a screen framed by a ' +
        'shared layout the layout’s slot carries "main" instead, so this ' +
        'stays a plain container unless you say otherwise. Choosing a ' +
        'landmark other than "main" leaves the page without one.',
      component: Aglyn.FieldComponentType.SELECT,
      options: DOCUMENT_ROOT_ELEMENTS.map((value) => ({
        value,
        label: value,
      })),
    },
  ],
}

// No preset, deliberately: the root is not an element anybody drops. The
// element drawer lists presets, so registering the schema alone keeps it out
// of the palette while giving the node its attributes panel.

export { DocumentRoot }
export default DocumentRoot
