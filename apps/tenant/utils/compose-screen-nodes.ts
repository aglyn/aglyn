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
import applyDuePublishSchedule from './apply-publish-schedule'
import getComponents from './get-components'
import getDatasets from './get-datasets'
import getVariables, { getFunctions } from './get-variables'
import getPublishedLayoutVersion from './get-layout-version'
import getScreenVersion from './get-screen-version'

/**
 * Full published-render composition for one screen (extracted for AGL-87 so
 * the SSG path and the password-unlock API build identical trees): applies
 * a due publish schedule, loads the version, composes the shared layout
 * chrome, grafts reusable components, and denormalizes.
 */
export async function composeScreenNodes(options: {
  hostId: string
  screenId: string
  screen: Aglyn.AglynScreen
}): Promise<Record<string, any> | null> {
  const { hostId, screenId, screen } = options

  const effectiveVersionId = await applyDuePublishSchedule({
    hostId,
    collectionName: 'screens',
    docId: screenId,
    parent: screen,
  })
  const versionRes = await getScreenVersion({
    hostId,
    screenId,
    versionId: (effectiveVersionId ?? screen.versionId) as string,
  })
  if (versionRes.error || !versionRes.version) return null

  const layoutId = screen.layoutId
  const layoutRes = layoutId
    ? await getPublishedLayoutVersion({ hostId, layoutId })
    : undefined

  const composedNodes = Aglyn.composeLayoutAndScreenNodes(
    layoutRes?.version?.nodes,
    versionRes.version.nodes,
  )
  const componentsRes = await getComponents({ hostId })
  const grafted = Aglyn.composeReusableComponentNodes(
    composedNodes as any,
    componentsRes.definitions as any,
  )
  // Host variable + function bindings (AGL-91/93): {{name}} and
  // {{fn:name(args)}} in string props resolve to values; unknown tokens
  // and failed runs stay literal.
  const [variables, functions, datasets] = await Promise.all([
    getVariables({ hostId }),
    getFunctions({ hostId }),
    getDatasets({ hostId }),
  ])
  // Repeatables (AGL-103) expand after grafting (so they work inside
  // reusable components) and before bindings (so {{name}} tokens inside
  // cloned items still resolve).
  const repeated = Aglyn.expandRepeatables(grafted as any, datasets)
  const bound = Aglyn.resolveNodesBindings(repeated as any, variables, functions)
  // Function widgets run client-side: embed their definitions (AGL-93).
  const nodes = Aglyn.attachFunctionDefinitions(bound, functions)
  return Aglyn.canvas.processNodesToDenormalized(nodes as any)
}

export default composeScreenNodes
