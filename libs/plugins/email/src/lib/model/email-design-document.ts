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

import { SCREEN_KIND_EMAIL } from '@aglyn/aglyn/app-utils/screen-route'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'

/**
 * THE TWO DOCUMENTS AN EMAIL DESIGN IS: a screen with `kind: 'email'`, and its
 * first version holding the node map.
 *
 * Leaf modules only, so the console's create (a client component) and the
 * server's draft writer build the same pair from one function: a design made
 * on either side opens in the same besigner, lists on the same Templates tab,
 * and is picked up by the same campaign composer.
 */

/** The screen document of a new email design. */
export interface EmailDesignScreenDocument {
  displayName: string
  kind: typeof SCREEN_KIND_EMAIL
  versionId: string
}

/** The first version of a new email design. */
export interface EmailDesignVersionDocument {
  screenId: string
  nodes: Record<string, unknown>
}

/** A new design's first canvas: one email section holding a greeting. */
export function emailDesignStarterNodes(ids: {
  sectionId: string
  textId: string
}): Record<string, unknown> {
  return {
    [CANVAS_ROOT_ELEMENT_ID]: {
      $id: CANVAS_ROOT_ELEMENT_ID,
      componentId: 'div',
      nodes: [ids.sectionId],
    },
    [ids.sectionId]: {
      $id: ids.sectionId,
      componentId: 'emailSection',
      pluginId: 'email',
      parentId: CANVAS_ROOT_ELEMENT_ID,
      nodes: [ids.textId],
    },
    [ids.textId]: {
      $id: ids.textId,
      componentId: 'emailText',
      pluginId: 'email',
      parentId: ids.sectionId,
      props: {
        children: 'Hello {{contact.firstName}},',
        variant: 'body',
      },
    },
  }
}

/** The screen and first version a design with these ids and this canvas is stored as. */
export function emailDesignDocuments(input: {
  screenId: string
  versionId: string
  displayName: string
  nodes: Record<string, unknown>
}): { screen: EmailDesignScreenDocument; version: EmailDesignVersionDocument } {
  return {
    screen: {
      displayName: input.displayName,
      kind: SCREEN_KIND_EMAIL,
      versionId: input.versionId,
    },
    version: { screenId: input.screenId, nodes: input.nodes },
  }
}
