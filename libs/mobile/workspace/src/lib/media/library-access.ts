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

import { DEFAULT_CONSOLE_ORIGIN, getMobileConfig, useLiveDoc, useOrgAccess } from '@aglyn/mobile-core'
import type { MobilePluginContext, MobileParams } from '@aglyn/mobile-plugin-host'
import { canWriteLibrary, type MediaLibrary } from './media-model'

export interface LibraryAccess {
  /** False until the reader's role (and, for a scoped reader, their tokens) is known. */
  ready: boolean
  canWrite: boolean
  /** The scope clause the reader's workspace-library reads must carry, or null for none. */
  scopeTokens: readonly string[] | null
}

/**
 * What the reader may do in a library, read the way the console reads it:
 * their workspace member row (role, reach, scope tokens) and, for a site's
 * library, their role in the site's `memberRoles`.
 */
export function useLibraryAccess(context: MobilePluginContext, library: MediaLibrary | null): LibraryAccess {
  const access = useOrgAccess(context.firestore, context.orgId, context.uid)
  const host = useLiveDoc<{ memberRoles?: Record<string, string> }>(
    context.firestore,
    library?.kind === 'site' ? ['hosts', library.hostId] : null,
  )
  if (!library) return { ready: false, canWrite: false, scopeTokens: null }
  if (library.kind === 'site') {
    return {
      ready: host.ready,
      canWrite: canWriteLibrary(library, { orgRole: access.role, hostRole: host.data?.memberRoles?.[context.uid] }),
      scopeTokens: null,
    }
  }
  return {
    ready: access.loaded,
    canWrite: canWriteLibrary(library, { orgRole: access.role, hostRole: null }),
    scopeTokens: access.orgWide ? null : access.tokens,
  }
}

/**
 * The library a screen opens: `params.library` when a link or the list
 * names one; else the site's when the link came through a site
 * (`/{org}/hosts/{site}/media`), the workspace's when it came through the
 * workspace (`/{org}/media`); else the picked site's, else the workspace's.
 */
export function libraryFor(params: MobileParams, context: Pick<MobilePluginContext, 'hostId' | 'orgId'>): MediaLibrary | null {
  const named = params['library']
  const scopeId = params['scopeId']
  if (named === 'site' && scopeId) return { kind: 'site', hostId: scopeId }
  if (named === 'org' && scopeId) return { kind: 'org', orgId: scopeId }
  const wantsOrg = named === 'org' || (Boolean(params['orgSlug']) && !params['hostSlug'])
  if (!wantsOrg && context.hostId) return { kind: 'site', hostId: context.hostId }
  if (context.orgId) return { kind: 'org', orgId: context.orgId }
  return context.hostId ? { kind: 'site', hostId: context.hostId } : null
}

/** The console origin thumbnails are served from. */
export function consoleOrigin(): string {
  try {
    return getMobileConfig().consoleOrigin
  } catch {
    return DEFAULT_CONSOLE_ORIGIN
  }
}
