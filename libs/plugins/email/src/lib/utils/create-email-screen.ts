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

import { CANVAS_ROOT_ELEMENT_ID, createResourceUid } from '@aglyn/aglyn'

/**
 * Creates the quota-governed screen doc — the caller passes
 * `useHostResourceApi()` so the create rides the console API that enforces
 * screensPerHost server-side (AGL-473). Kept as a parameter (not a hook)
 * so this helper stays a plain async function usable outside React.
 */
export type CreateScreenResource = (options: {
  hostId: string
  resource: 'screen'
  id: string
  data: Record<string, unknown>
}) => Promise<{ id: string }>

/**
 * Creates the screen's first version — the caller passes
 * `useHostVersionApi()` so the create rides /api/hosts/versions (AGL-1369),
 * which the rules now make the only path. A parameter for the same reason
 * `CreateScreenResource` is one: this helper is not a hook.
 */
export type CreateScreenVersion = (options: {
  hostId: string
  kind: 'screen'
  parentId: string
  id: string
  data: Record<string, unknown>
}) => Promise<{ id: string }>

/**
 * Creates a besigner email document (AGL-347/349): a screen with kind
 * 'email' plus a first version seeded with an email section + a greeting
 * text block. Shared by the campaigns composer and the email-screens list
 * so both scaffold identical documents. The screen doc goes through the
 * quota-enforcing resources API (AGL-473) and the first version through
 * /api/hosts/versions (AGL-1369), which allows a resource's FIRST version on
 * every plan. Returns the ids for navigation.
 */
export async function createEmailScreen(
  hostId: string,
  createScreen: CreateScreenResource,
  createVersion: CreateScreenVersion,
  displayName = 'Untitled email',
): Promise<{ screenId: string; versionId: string }> {
  const screenId = createResourceUid()
  const versionId = createResourceUid()
  const sectionId = createResourceUid()
  const textId = createResourceUid()
  await createScreen({
    hostId,
    resource: 'screen',
    id: screenId,
    data: { displayName, kind: 'email', versionId },
  })
  await createVersion({
    hostId,
    kind: 'screen',
    parentId: screenId,
    id: versionId,
    data: {
      screenId,
      nodes: {
        [CANVAS_ROOT_ELEMENT_ID]: {
          $id: CANVAS_ROOT_ELEMENT_ID,
          componentId: 'div',
          nodes: [sectionId],
        },
        [sectionId]: {
          $id: sectionId,
          componentId: 'emailSection',
          pluginId: 'email',
          parentId: CANVAS_ROOT_ELEMENT_ID,
          nodes: [textId],
        },
        [textId]: {
          $id: textId,
          componentId: 'emailText',
          pluginId: 'email',
          parentId: sectionId,
          props: {
            children: 'Hello {{contact.firstName}},',
            variant: 'body',
          },
        },
      },
    },
  })
  return { screenId, versionId }
}
