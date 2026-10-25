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

/*
 * Seed for the Aglyn app's workspace screens (AGL-3622): Sites, the media
 * library, and team and users, in the shapes the console's own writers leave
 * (`membershipRow` in tenant-data-admin, the DAM upload route, the members
 * and invites routes). Everything is readable by the seeded owner under the
 * real rules: the sites through their `memberRoles` and the owner's own
 * `hostMemberships` rows, the libraries through site membership and the
 * owner's org-wide member row, the roster and invites as an owner.
 *
 * The thumbnails point where a real asset's do (the console's CDN path and a
 * Storage download URL); with no console serving them, the app shows each
 * file's icon instead.
 *
 * Writes are whole-document PATCHes, so this module writes only documents it
 * owns, plus the owner's own member row, which no other seed writes in full.
 */

const NAME_TOKEN_MAX_PREFIX = 12
const NAME_TOKEN_LIMIT = 120

/** `nameSearchKey` (libs/aglyn/src/lib/app-utils/name-search.ts). */
const nameSearchKey = (name) => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

/** `nameSearchTokens`: every prefix of every word, capped as the writers cap them. */
function nameSearchTokens(name) {
  const key = nameSearchKey(name)
  const tokens = new Set()
  for (const word of key.split(' ')) {
    if (!word) continue
    const capped = word.slice(0, NAME_TOKEN_MAX_PREFIX)
    for (let end = 1; end <= capped.length; end += 1) {
      tokens.add(capped.slice(0, end))
      if (tokens.size >= NAME_TOKEN_LIMIT) return [...tokens]
    }
  }
  return [...tokens]
}

/** `hostMembershipSearchTokens`: the name, slug and domain, each word and each word's tails. */
function hostSearchTokens({ displayName, subdomain, cname }) {
  const separator = /[^\p{L}\p{N}]/u
  const words = [displayName, subdomain, cname]
    .map((value) => nameSearchKey(value))
    .flatMap((key) => (key ? key.split(' ') : []))
    .flatMap((word) => {
      const chars = [...word]
      const tails = [word]
      for (let at = 1; at < chars.length; at += 1) {
        if (separator.test(chars[at - 1]) && !separator.test(chars[at])) tails.push(chars.slice(at).join(''))
      }
      return tails
    })
  return nameSearchTokens(words.join(' '))
}

/** `mediaFilterKeys` (libs/aglyn/src/lib/app-utils/media-metadata.ts) for a still image. */
export function mediaKeys({ fileName, contentType, alt, width, height }) {
  const words = String(fileName).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const kind = contentType.startsWith('image/')
    ? 'image'
    : contentType.startsWith('video/')
      ? 'video'
      : contentType === 'application/pdf'
        ? 'pdf'
        : 'document'
  return {
    kind,
    nameLower: nameSearchKey(fileName),
    nameTokens: nameSearchTokens(words),
    hasAlt: String(alt ?? '').trim().length > 0,
    orientation: width && height ? (width === height ? 'square' : width > height ? 'landscape' : 'portrait') : null,
  }
}

export const BUCKET = 'demo-aglyn.appspot.com'

/** Sample photos the repository ships, one per seeded JPEG, uploaded when the seed is given a Storage emulator. */
const SAMPLE_PHOTOS = {
  'seed-media-storefront': 'apps/console/public/_static/starter/gallery-plants.jpg',
  'seed-media-croissants': 'apps/console/public/_static/starter/gallery-craft.jpg',
  // The seed's own brand art: the workspace's logo, and a favicon for every site (the site logo is the bakery's).
  'seed-media-brand-mark': 'tools/scripts/seed-native/art/juniper-street-co-logo.png',
  'seed-media-logo': 'tools/scripts/seed-native/art/juniper-street-bakery-favicon.png',
  'seed-media-favicon:mobile-demo-site': 'tools/scripts/seed-native/art/juniper-street-bakery-favicon.png',
  'seed-media-favicon:mobile-bloom-bakery': 'tools/scripts/seed-native/art/juniper-street-catering-favicon.png',
  'seed-media-favicon:mobile-studio-north': 'tools/scripts/seed-native/art/juniper-street-cafe-favicon.png',
}

/** The demo site's collaborator: on the site's Users roster (account.mjs) and the workspace's, with an account. */
export const SITE_COLLABORATOR = {
  uid: 'seed-collab-morgan',
  email: 'morgan.diaz@example.test',
  displayName: 'Morgan Diaz',
  siteRole: 'editor',
}
const SITE_COLLABORATOR_MEMBER = (hostId) => ({
  uid: SITE_COLLABORATOR.uid,
  role: 'viewer',
  allHosts: false,
  hostAccess: { [hostId]: SITE_COLLABORATOR.siteRole },
  email: SITE_COLLABORATOR.email,
  displayName: SITE_COLLABORATOR.displayName,
  joined: 9,
})

/** A seeded site's favicon as the console stores it: a media reference to the site's own library. */
export const seededFavicon = (siteId) => `media:${siteId}/seed-media-favicon`

export async function seedWorkspace({ put, uid, orgId, hostId, now, putObject = null, root = null, auth = null, project = null }) {
  const day = 24 * 60 * 60 * 1000
  const ago = (days) => new Date(now.getTime() - days * day)

  // --- Team: the owner's own row, three members, the bakery's site collaborator and a pending invite. ----
  const people = [
    { uid, role: 'owner', allHosts: true, hostAccess: {}, email: 'mobile-owner@example.test', displayName: 'Hannah Reyes', joined: 60 },
    { uid: 'seed-admin-priya', role: 'admin', allHosts: true, hostAccess: {}, email: 'priya.shah@example.test', displayName: 'Priya Shah', title: 'Operations lead', joined: 40 },
    {
      uid: 'seed-editor-riley',
      role: 'editor',
      allHosts: false,
      hostAccess: { 'mobile-bloom-bakery': 'editor' },
      email: 'riley.chen@example.test',
      displayName: 'Riley Chen',
      title: 'Content writer',
      joined: 21,
    },
    {
      uid: 'seed-viewer-jordan',
      role: 'viewer',
      allHosts: false,
      hostAccess: { [hostId]: 'viewer' },
      email: 'jordan.lee@example.test',
      displayName: 'Jordan Lee',
      joined: 7,
    },
    // The bakery's site collaborator (account.mjs puts them on its Users roster): a viewer on the roster whose reach
    // is that one site, as the console's grantHostAccess stores a collaborator added by email.
    SITE_COLLABORATOR_MEMBER(hostId),
  ]
  for (const person of people) {
    const orgWide = person.role === 'owner' || person.role === 'admin' || person.allHosts
    await put(`orgs/${orgId}/members/${person.uid}`, {
      role: person.role,
      allHosts: person.allHosts,
      hostAccess: person.hostAccess,
      scopeTokens: orgWide ? ['org'] : ['org', ...Object.keys(person.hostAccess).map((id) => `host:${id}`)],
      email: person.email,
      displayName: person.displayName,
      ...(person.title ? { title: person.title } : {}),
      ...(person.uid === uid ? {} : { invitedBy: uid }),
      joinedAt: ago(person.joined),
    })
  }
  // Each teammate is a real (emulator) account, verified, under the member row's uid: the console's role change and
  // removal read the person's Auth record and answer 404 for a uid it does not know. No password: nobody signs in as
  // them. An existing account is left as it is (the batch reports it and goes on).
  if (auth && project) {
    const users = people
      .filter((person) => person.uid !== uid)
      .map((person) => ({ localId: person.uid, email: person.email, emailVerified: true, displayName: person.displayName }))
    const response = await fetch(`http://${auth}/identitytoolkit.googleapis.com/v1/projects/${project}/accounts:batchCreate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
      body: JSON.stringify({ users }),
    })
    if (!response.ok) throw new Error(`team accounts: ${response.status} ${await response.text()}`)
  }
  await put(`orgs/${orgId}/invites/seed-invite-sam`, {
    email: 'sam.ortiz@example.test',
    role: 'editor',
    allHosts: false,
    hostAccess: { 'mobile-bloom-bakery': 'author' },
    invitedBy: uid,
    createdAt: ago(2),
    acceptedAt: null,
  })

  // --- Sites: one live on a custom domain, one in maintenance. ----------
  const sites = [
    {
      id: 'mobile-bloom-bakery',
      displayName: 'Juniper Street Catering',
      subdomain: 'juniper-catering',
      cname: 'juniperstreetcatering.example',
      created: 30,
      homeId: 'bloom-home',
      screens: { 'bloom-home': '/', 'bloom-menu': 'menu', 'bloom-visit': 'visit-us' },
      roles: { [uid]: 'admin', 'seed-admin-priya': 'admin', 'seed-editor-riley': 'editor' },
    },
    {
      id: 'mobile-studio-north',
      displayName: 'Juniper Street Cafe',
      subdomain: 'juniper-cafe',
      cname: '',
      created: 12,
      homeId: 'studio-home',
      screens: { 'studio-home': '/' },
      maintenance: true,
      roles: { [uid]: 'admin', 'seed-admin-priya': 'admin' },
    },
  ]
  for (const site of sites) {
    await put(`hosts/${site.id}`, {
      orgId,
      displayName: site.displayName,
      subdomain: site.subdomain,
      ...(site.cname ? { cname: site.cname } : {}),
      memberRoles: site.roles,
      screens: site.screens,
      defaultHomeScreenId: site.homeId,
      ...(site.maintenance ? { maintenance: true } : {}),
      createdAt: ago(site.created),
      updatedAt: ago(1),
    })
    await put(`hosts/${site.id}/screens/${site.homeId}`, {
      hostId: site.id,
      displayName: 'Home',
      nameLower: 'home',
      slug: '/',
      versionId: `${site.homeId}-v3`,
      createdAt: ago(site.created),
      updatedAt: ago(2),
      publishedAt: ago(2),
    })
    await put(`users/${uid}/hostMemberships/${site.id}`, {
      orgId,
      subdomain: site.subdomain,
      displayName: site.displayName,
      nameLower: nameSearchKey(site.displayName),
      searchTokens: hostSearchTokens(site),
      hasCustomDomain: Boolean(site.cname),
      // The mirror carries the custom domain as the console's sync writes it (host-memberships.ts), so a site list
      // shows the address the live site answers on.
      ...(site.cname ? { cname: site.cname } : {}),
      createdAt: ago(site.created),
      role: 'admin',
      updatedAt: now,
    })
  }

  // The workspace's directory of its sites, as the console's create-site path claims one (provision-host.ts merges
  // `hosts: { <site>: true }` into the org, registerOrgHost writes the same key): the plan's site limit counts it, so
  // without it a seeded Pro workspace with three sites never reached its "3 of 3" notice.
  await put(
    `orgs/${orgId}`,
    { hosts: Object.fromEntries([hostId, ...sites.map((site) => site.id)].map((id) => [id, true])) },
    { merge: true, fields: ['hosts'] },
  )

  // --- Media: the demo site's library, a folder, and the workspace's. ----
  await put(`hosts/${hostId}/mediaFolders/seed-storefront`, { name: 'Storefront', parentId: null, order: 0, createdAt: ago(20) })
  await put(`orgs/${orgId}/mediaFolders/seed-brand`, {
    name: 'Brand',
    parentId: null,
    order: 0,
    visibleTo: ['org'],
    createdAt: ago(25),
  })
  const media = [
    ['hosts', hostId, 'seed-media-storefront', 'storefront-morning.jpg', 'image/jpeg', 1_258_291, 1600, 1067, 'The bakery storefront at sunrise', 'seed-storefront', 9],
    ['hosts', hostId, 'seed-media-croissants', 'croissant-tray.jpg', 'image/jpeg', 842_116, 1200, 1500, 'A tray of fresh croissants', 'seed-storefront', 8],
    ['hosts', hostId, 'seed-media-team', 'team-photo.png', 'image/png', 2_097_152, 2000, 1333, '', null, 6],
    ['hosts', hostId, 'seed-media-logo', 'logo-square.png', 'image/png', 48_213, 256, 256, 'Juniper Street Bakery logo', null, 5],
    ['hosts', hostId, 'seed-media-menu', 'fall-menu.pdf', 'application/pdf', 356_002, 0, 0, '', null, 3],
    ['hosts', hostId, 'seed-media-hero', 'hero-banner-wide.webp', 'image/webp', 412_880, 2400, 900, 'Loaves on a wooden counter', null, 1],
    ['orgs', orgId, 'seed-media-brand-mark', 'brand-mark.png', 'image/png', 64_512, 512, 512, 'Workspace brand mark', 'seed-brand', 20],
    ['orgs', orgId, 'seed-media-brand-guide', 'brand-guide.pdf', 'application/pdf', 1_802_240, 0, 0, '', 'seed-brand', 18],
    ...[hostId, ...sites.map((site) => site.id)].map((siteId) => [
      'hosts', siteId, 'seed-media-favicon', 'favicon.png', 'image/png', 0, 256, 256, 'Site favicon', null, 30,
    ]),
  ]
  for (const [collection, scopeId, id, fileName, contentType, rowBytes, width, height, alt, folderId, days] of media) {
    let sizeBytes = rowBytes
    const base = `${collection}/${scopeId}`
    const storagePath = `${base}/media/${folderId ? `${folderId}/` : ''}${id}`
    const image = contentType.startsWith('image/')
    // A real file behind the document, when there is a Storage emulator: it lists no delivery copies yet, so the
    // console's CDN serves the original and makes them on the first request, as it does for any older upload.
    const sample = putObject && root ? (SAMPLE_PHOTOS[`${id}:${scopeId}`] ?? SAMPLE_PHOTOS[id]) : undefined
    if (sample) {
      await putObject(storagePath, readFileSync(join(root, sample)), contentType)
      sizeBytes = statSync(join(root, sample)).size
    }
    await put(`${base}/media/${id}`, {
      fileName,
      contentType,
      sizeBytes,
      url: `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(storagePath)}?alt=media&token=seed-${id}`,
      storagePath,
      folderId,
      ...mediaKeys({ fileName, contentType, alt, width, height }),
      ...(width && height ? { width, height } : {}),
      ...(alt ? { alt } : {}),
      tags: [],
      uploadedBy: uid,
      variants: image && !sample ? [320, 640, 1280].filter((size) => size < width) : [],
      cdnPath: `/api/media/cdn/${collection === 'orgs' ? `org:${scopeId}` : scopeId}/${id}`,
      ...(collection === 'orgs' ? { visibleTo: ['org'] } : {}),
      createdAt: ago(days),
      updatedAt: ago(days),
    })
  }

  // The workspace's logo and every site's favicon point at those files the way the console stores them, so the rail,
  // the Sites list and the site switcher show pictures, never initials: the logo as its CDN path (`logoUrl`), a favicon
  // as a media reference on the site (`seo.favicon`) mirrored on the owner's membership row (`favicon`), which the
  // switcher and the Sites list read. The bakery's own setup (content.mjs) names the same reference.
  await put(`orgs/${orgId}`, { logoUrl: `/api/media/cdn/org:${orgId}/seed-media-brand-mark` }, { merge: true })
  for (const siteId of [hostId, ...sites.map((site) => site.id)]) {
    const favicon = seededFavicon(siteId)
    await put(`hosts/${siteId}`, { seo: { favicon } }, { merge: true, fields: ['seo.favicon'] })
    await put(`users/${uid}/hostMemberships/${siteId}`, { favicon }, { merge: true })
  }
}
