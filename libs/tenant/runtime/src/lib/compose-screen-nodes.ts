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

import * as Aglyn from '@aglyn/aglyn/server'
import applyDuePublishSchedule from './apply-publish-schedule'
import getComponents from './get-components'
import getDatasets from './get-datasets'
import getPluginInstalls from './get-plugin-installs'
import getVariables, { getFunctions, getWorkflows } from './get-variables'
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
  /** Entry-template tokens (AGL-105) substituted before denormalize. */
  tokens?: Record<string, string>
  /**
   * Compose a specific version instead of the published one (AGL-253):
   * experiment variants point at versions; schedules don't apply.
   */
  versionId?: string
}): Promise<Record<string, any> | null> {
  const { hostId, screenId, screen } = options

  const effectiveVersionId = options.versionId
    ? null
    : await applyDuePublishSchedule({
        hostId,
        collectionName: 'screens',
        docId: screenId,
        parent: screen,
      })
  const versionRes = await getScreenVersion({
    hostId,
    screenId,
    versionId: (options.versionId ??
      effectiveVersionId ??
      screen.versionId) as string,
  })
  if (versionRes.error || !versionRes.version) return null

  const layoutId = screen.layoutId
  const layoutRes = layoutId
    ? await getPublishedLayoutVersion({ hostId, layoutId })
    : undefined

  const composedNodes = Aglyn.composeLayoutAndScreenNodes(
    layoutRes?.version?.nodes as any,
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
  const [rawVariables, functions, datasets, workflows, pluginInstalls] =
    await Promise.all([
      getVariables({ hostId }),
      getFunctions({ hostId }),
      getDatasets({ hostId }),
      getWorkflows({ hostId }),
      getPluginInstalls({ hostId }),
    ])
  // Computed variables (AGL-129): workflow-backed values resolve once per
  // compose; failures keep each variable's stored fallback.
  const variables = Aglyn.resolveComputedVariables(
    rawVariables,
    functions,
    workflows,
  )
  // Repeatables (AGL-103) expand after grafting (so they work inside
  // reusable components) and before bindings (so {{name}} tokens inside
  // cloned items still resolve).
  const repeated = Aglyn.expandRepeatables(grafted as any, datasets)
  const bound = Aglyn.resolveNodesBindings(repeated as any, variables, functions)
  // Function widgets run client-side: embed their definitions (AGL-93).
  const withFunctions = Aglyn.attachFunctionDefinitions(bound, functions)
  // Community plugins (AGL-45): stamp each communityPlugin node with its
  // pinned install (version/sha256/capabilities) + kill-switch state.
  const nodes = Aglyn.attachPluginInstalls(withFunctions, pluginInstalls)
  // Entry-template tokens (AGL-105): {{entry.*}} from the rendered entry.
  const finalNodes = Aglyn.resolveNamedTokens(nodes as any, options.tokens)
  return Aglyn.canvas.processNodesToDenormalized(finalNodes as any)
}

export default composeScreenNodes
