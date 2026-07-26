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

import { collection, getDocs, limit, query, type Firestore } from 'firebase/firestore'
import type { HostAction } from '@aglyn/aglyn'
import type { SiteRuntimePreviewContext } from '@aglyn/aglyn'
import { compileClientAutomations, type RawHostAction } from './model'

/**
 * The marketing site-runtime's client-side page-props for the besigner
 * Preview (AGL-830). No server enricher runs there, so this reads the host's
 * `actions` with the client SDK and compiles them the same way the enricher
 * does — the Preview then mounts the SAME MarketingSiteRuntime the tenant
 * uses, and hover-to-open menus/drawers behave exactly like the live site.
 *
 * Compiled with `actionsEntitled: false`, so only basic PRESENTATIONAL steps
 * (menu/drawer/show-hide/class/nav) run and `hasServerSteps` stays false —
 * preview never fires analytics, webhooks, or server events. `matchAllPaths`
 * because the Preview renders one composed screen and scopes relevance by
 * selector match, not page path.
 */
export async function loadMarketingPreviewProps(
  ctx: SiteRuntimePreviewContext,
): Promise<Record<string, unknown>> {
  const { hostId, firestore } = ctx
  if (!hostId || !firestore) return {}
  try {
    const snapshot = await getDocs(
      query(
        collection(firestore as Firestore, 'hosts', hostId, 'actions'),
        limit(50),
      ),
    )
    const actions: RawHostAction[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      action: doc.data() as HostAction,
    }))
    const clientAutomations = compileClientAutomations(actions, {
      path: '/',
      actionsEntitled: false,
      allowJs: false,
      matchAllPaths: true,
    })
    return { clientAutomations }
  } catch (error) {
    console.error('marketing: preview props load failed', error)
    return {}
  }
}
