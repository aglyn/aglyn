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

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { BUCKET, mediaKeys } from './workspace.mjs'

/*
 * A second workspace for the seeded member, and a white-label one (AGL-3966):
 * on the Agency plan, which carries the `whiteLabel` entitlement, with its own
 * brand. It is what the apps' white-label surfaces need on every drive: the
 * workspace's brand color on the rail and the Home tab, its product name
 * where "Aglyn" would be, and its own mark.
 *
 * The shapes are the console's own:
 * - the workspace and its owner's roster row and `users/{uid}/orgs` mirror, as
 *   `createOrganization` (libs/tenant/data/admin, server/organizations.ts)
 *   writes them, plus the `memberRoles` projection the rules read;
 * - the plan as `plan` on the workspace, which `resolveEffectivePlan` reads
 *   when no subscription is mirrored, as the Pro workspace's is seeded;
 * - `brandingProfile` as `/api/orgs/settings` (`update-branding`) stores it:
 *   only the fields that are set, the color as a hex, and the image fields
 *   as a media CDN path from the workspace's own library, which is what its
 *   Browse button writes;
 * - the mark as a library file, as the media seed in workspace.mjs writes one,
 *   and the workspace's `logoUrl` as its CDN path.
 */

export const WHITE_LABEL_ORG_ID = 'mobile-harbor-org'
const NAME = 'Harbor Light Dental'
const SLUG = 'harbor-light'
const MARK_ID = 'seed-media-harbor-mark'
const MARK_ART = 'tools/scripts/seed-native/art/harbor-light-dental-logo.png'

/** The brand, as the white-label settings would save it. */
export const WHITE_LABEL_BRAND = {
  productName: 'Harbor Suite',
  primaryColor: '#0F7B6C',
}

export async function seedWhiteLabel({ put, uid, now, nameSearchFields, putObject = null, root = null }) {
  const orgId = WHITE_LABEL_ORG_ID
  const created = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  const mark = `/api/media/cdn/org:${orgId}/${MARK_ID}`

  await put(`orgSlugs/${SLUG}`, { orgId })
  await put(`orgs/${orgId}`, {
    ...nameSearchFields(NAME),
    slug: SLUG,
    ownerUid: uid,
    createdByUid: uid,
    memberRoles: { [uid]: 'owner' },
    hosts: {},
    suspended: false,
    plan: 'agency',
    logoUrl: mark,
    brandingProfile: { ...WHITE_LABEL_BRAND, faviconUrl: mark },
    createdAt: created,
    updatedAt: now,
    lastActivityAt: now,
  })
  await put(`orgs/${orgId}/members/${uid}`, {
    role: 'owner',
    allHosts: true,
    hostAccess: {},
    scopeTokens: ['org'],
    email: 'mobile-owner@example.test',
    displayName: 'Hannah Reyes',
    joinedAt: created,
  })
  await put(`users/${uid}/orgs/${orgId}`, { role: 'owner', orgName: NAME, slug: SLUG, orgWide: true })

  // The mark, in the workspace's library under a Brand folder, with the file behind it when there is a Storage
  // emulator (no delivery copies listed, so the console's CDN serves the original).
  await put(`orgs/${orgId}/mediaFolders/seed-brand`, {
    name: 'Brand',
    parentId: null,
    order: 0,
    visibleTo: ['org'],
    createdAt: created,
  })
  const fileName = 'harbor-light-mark.png'
  const contentType = 'image/png'
  const storagePath = `orgs/${orgId}/media/seed-brand/${MARK_ID}`
  let sizeBytes = 12_140
  if (putObject && root) {
    await putObject(storagePath, readFileSync(join(root, MARK_ART)), contentType)
    sizeBytes = statSync(join(root, MARK_ART)).size
  }
  await put(`orgs/${orgId}/media/${MARK_ID}`, {
    fileName,
    contentType,
    sizeBytes,
    url: `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(storagePath)}?alt=media&token=seed-${MARK_ID}`,
    storagePath,
    folderId: 'seed-brand',
    ...mediaKeys({ fileName, contentType, alt: 'Harbor Light Dental mark', width: 512, height: 512 }),
    width: 512,
    height: 512,
    alt: 'Harbor Light Dental mark',
    tags: [],
    uploadedBy: uid,
    variants: [],
    cdnPath: mark,
    visibleTo: ['org'],
    createdAt: created,
    updatedAt: created,
  })
}
