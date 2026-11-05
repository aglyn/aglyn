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

import { parseMediaCdnScope, type MediaCdnScope } from '@aglyn/aglyn/app-utils/media-cdn-scope'
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import { resolveVisitorUploadType, VISITOR_UPLOAD_TYPES } from '@aglyn/aglyn/app-utils/visitor-upload'
import { isOrgWideMember, memberScopeTokens, visibleToTokens } from '@aglyn/aglyn/server'
import { firebaseAdmin, resolveOrgMembership } from '@aglyn/tenant-data-admin'

/*==========================================
 * A MEDIA LIBRARY FILE CHOSEN FOR A QUOTE'S PROOF (AGL-4184).
 *
 * The console names the file (the library and its id); nothing else it says
 * about the file is believed. This answers where its bytes are, or refuses,
 * for THIS member on THIS site, on the server:
 *
 * - the library is this site's own, or the workspace that owns this site.
 *   Another site's or another workspace's is refused before anything is read.
 * - the member may read the file, as the rules would say: a site's library is
 *   its members', which the route's `commerce.quotes` already made them, and a
 *   workspace's is a roster member's whose reach includes the file.
 * - the workspace's file is shared with this site, as the picker offers it.
 * - it is live: not deleted, not quarantined, and its library not locked. A
 *   private file is fine: the copy stays as private as the proof it becomes.
 *
 * Every refusal but the last reads the same, so a member learns nothing about
 * a file they may not read. What the bytes ARE is not decided here: the object
 * goes through what an upload goes through (`keepVisitorUploadCopy`).
 *=========================================*/

export interface QuoteProofMediaRequest {
  hostId: string
  /** The workspace that owns the site. */
  orgId: string
  uid: string
  mediaScope: string
  mediaId: string
}

export type QuoteProofMediaAnswer =
  | { ok: true; path: string; name: string }
  | { ok: false; status: number; error: string }

export interface QuoteProofMediaDeps {
  /** The file's document in a library, or null. */
  mediaDoc(scope: MediaCdnScope, mediaId: string): Promise<Record<string, unknown> | null>
  /** The member's entry on the workspace's roster, or null when they have none. */
  orgMember(uid: string, orgId: string): Promise<Parameters<typeof memberScopeTokens>[0] | null>
  /** Why the media CDN would not serve this file, if it would not. */
  serveBlock(
    scope: MediaCdnScope,
    asset: { contentSha256?: string; contentHash?: string; scopeSegment: string; mediaId: string },
  ): Promise<'locked' | 'quarantined' | null>
  /** The file's object, only ever inside its library's media prefix. */
  objectPath(input: { storagePath: unknown; base: string; mediaId: string }): Promise<string>
}

export function defaultQuoteProofMediaDeps(): QuoteProofMediaDeps {
  return {
    mediaDoc: async (scope, mediaId) => {
      const snapshot = await firebaseAdmin
        .app()
        .firestore()
        .collection(scope.isOrg ? 'orgs' : 'hosts')
        .doc(scope.scopeId)
        .collection('media')
        .doc(mediaId)
        .get()
      return snapshot.exists ? ((snapshot.data() ?? {}) as Record<string, unknown>) : null
    },
    orgMember: async (uid, orgId) => (await resolveOrgMembership(uid, orgId))?.member ?? null,
    // Loaded only when a proof is taken from the library (`pos-reader-splash-server.ts` says why).
    serveBlock: async (scope, asset) => (await import('./pos-reader-splash-server')).mediaCdnServeBlock(scope, asset),
    objectPath: async (input) => (await import('./pos-reader-splash-server')).mediaStoragePathInScope(input),
  }
}

/**
 * A library file's name as a proof takes it. A proof's type is read from its
 * name's extension, and a library file can be named anything, so a name that
 * does not say what the file is takes the extension of its stored type.
 */
export function quoteProofMediaName(fileName: unknown, contentType: unknown): string {
  const name = String(fileName ?? '').trim() || 'proof'
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase()
  if (resolveVisitorUploadType(name, type)) return name
  const stored = VISITOR_UPLOAD_TYPES.find((entry) => entry.contentType === type || entry.aliases?.includes(type))
  return stored ? `${name}${stored.extensions[0]}` : name
}

const NOT_READABLE: QuoteProofMediaAnswer = {
  ok: false,
  status: 404,
  error: 'That file isn’t in a media library you can read for this site. Choose another.',
}

/** Where a chosen library file's bytes are, for this member on this site, or why they may not have them. */
export async function locateQuoteProofMedia(
  request: QuoteProofMediaRequest,
  deps: QuoteProofMediaDeps = defaultQuoteProofMediaDeps(),
): Promise<QuoteProofMediaAnswer> {
  const { hostId, orgId, uid, mediaScope, mediaId } = request
  const scope = parseMediaCdnScope(String(mediaScope ?? ''))
  if (!scope || !/^[A-Za-z0-9_-]{1,64}$/.test(String(mediaId ?? ''))) return NOT_READABLE
  // Whose library it is comes first: another's is never read.
  if (scope.isOrg ? !orgId || scope.scopeId !== orgId : scope.scopeId !== hostId) return NOT_READABLE
  if (scope.contextHostId && scope.contextHostId !== hostId) return NOT_READABLE
  const member = scope.isOrg ? await deps.orgMember(uid, orgId) : null
  if (scope.isOrg && !member) return NOT_READABLE

  const doc = await deps.mediaDoc(scope, mediaId)
  if (!doc || doc['deletedAt']) return NOT_READABLE
  if (scope.isOrg) {
    const visibleTo = doc['visibleTo'] as string[] | undefined
    if (!visibleToHost(visibleTo, hostId)) return NOT_READABLE
    if (!isOrgWideMember(member) && !visibleToTokens(visibleTo, memberScopeTokens(member))) return NOT_READABLE
  }

  const blocked = await deps.serveBlock(scope, {
    contentSha256: typeof doc['contentSha256'] === 'string' ? doc['contentSha256'] : undefined,
    contentHash: typeof doc['contentHash'] === 'string' ? doc['contentHash'] : undefined,
    // Keyed as a quarantine is: by the library, whatever site's context it was picked in.
    scopeSegment: scope.isOrg ? `org:${scope.scopeId}` : scope.scopeId,
    mediaId,
  })
  if (blocked) return { ok: false, status: 409, error: 'That file can’t be used right now. Choose another.' }
  return {
    ok: true,
    path: await deps.objectPath({
      storagePath: doc['storagePath'],
      base: `${scope.isOrg ? 'orgs' : 'hosts'}/${scope.scopeId}`,
      mediaId,
    }),
    name: quoteProofMediaName(doc['fileName'], doc['contentType']),
  }
}
