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
'use client'

import {
  EditorPluginConnectionsContext,
  editorConnectionRecordsPageData,
} from '@aglyn/aglyn/app-utils/plugin-connection-editor'
import { PluginConnectionRecordsContext } from '@aglyn/aglyn/app-utils/plugin-connection-records-context'
import { useContext, useMemo, type ReactNode } from 'react'

/**
 * A signed marketplace element on the canvas, handed its own listing's
 * connection records (AGL-4196), the way the published page hands them.
 *
 * Attributed per element, as it renders, so an element dropped a moment ago
 * reads its record as readily as one the document was saved with. Anything
 * that is not a namespaced element, or a site with no records, passes
 * through untouched.
 */
export function ConnectionRecordsScope(props: {
  node: { $id?: unknown; componentId?: unknown } | null | undefined
  children: ReactNode
}) {
  const { node, children } = props
  const connections = useContext(EditorPluginConnectionsContext)
  const nodeId = node?.$id
  const componentId = node?.componentId
  const value = useMemo(
    () => editorConnectionRecordsPageData(connections, [{ $id: nodeId, componentId }]),
    [connections, nodeId, componentId],
  )
  if (!value) return <>{children}</>
  return <PluginConnectionRecordsContext.Provider value={value}>{children}</PluginConnectionRecordsContext.Provider>
}

export default ConnectionRecordsScope
