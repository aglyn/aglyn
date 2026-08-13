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

import { getPluginConfigSchema, mergePluginConfig } from '@aglyn/aglyn'
import { doc } from 'firebase/firestore'
import { useMemo } from 'react'
import { useFirestore } from './firebase/firebase-services'
import { useFirestoreDoc } from './use-firestore-doc'

/**
 * Live per-plugin config for a workspace (AGL-428): the org's
 * `pluginSettings/{pluginId}` overrides merged over the plugin's declared
 * schema defaults (type-coerced). Plugins call this from console pages/
 * widgets with the orgId the shell resolves; `ready` turns true once the
 * doc read settles either way.
 */
export function usePluginConfig(
  orgId: string | null | undefined,
  pluginId: string,
): { config: Record<string, unknown>; ready: boolean } {
  const firestore = useFirestore()
  // Held at null while the org is unknown, never addressed as
  // `orgs/-pending-` (AGL-1440): `pluginSettings` is member-gated, so the
  // sentinel was a guaranteed-denied read on every mount of every plugin
  // surface — the exact anti-pattern `use-org-plan.ts` documents removing
  // (AGL-1064). A null ref issues nothing, `status` stays `'loading'`, and
  // `ready` below stays false, which is already this hook's contract while
  // the answer is unknown.
  const { data, status } = useFirestoreDoc<Record<string, unknown>>(
    () =>
      orgId
        ? doc(firestore, 'orgs', orgId, 'pluginSettings', pluginId)
        : null,
    [firestore, orgId, pluginId],
  )
  const config = useMemo(() => {
    const schema = getPluginConfigSchema(pluginId)
    if (!schema) return (data as Record<string, unknown>) ?? {}
    return mergePluginConfig(schema, data ?? null)
  }, [pluginId, data])
  // `'success'` rather than `!== 'loading'` (AGL-1066): a refused listen can
  // now reach `'error'`, and answering "ready" with an empty config would let
  // a caller act on schema defaults as though they were the stored settings.
  return { config, ready: status === 'success' }
}

export default usePluginConfig
