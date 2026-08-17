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

/**
 * The demo seeding engine (AGL-1734).
 *
 * Split out of `seed-demo-host.mjs` so the same fixture graph can be stamped
 * with any brand pack, by either the single-host CLI or the multi-site org
 * CLI, without either one owning a copy of it.
 *
 * Two invariants the demo depends on, both of which the old top-to-bottom
 * script could not give:
 *
 * 1. **Re-seeding converges, including across a brand change.** Every write
 *    is merge-set under a deterministic `seed-…` id, and every run first
 *    deletes the `seed-…` documents already there. Without the delete a host
 *    seeded as a bakery and re-seeded as a law firm keeps the sourdough post
 *    and the brake-rotor product alongside the new fixtures — run two of a
 *    live demo would not look like run one, which is exactly the failure the
 *    issue asks to avoid.
 * 2. **The prune is prefix-scoped.** It only ever touches ids starting with
 *    `seed-`, so pointing this at a host with real content cannot delete it.
 */

import { FieldValue } from 'firebase-admin/firestore'
import { buildHomeNodes } from './demo-brands.mjs'

/** Every host subcollection the seeder writes into. Order is cosmetic. */
export const HOST_SEEDED_COLLECTIONS = [
  'variables',
  'functions',
  'workflows',
  'actions',
  'datasets',
  'collections',
  'media',
  'leads',
  'siteMembers',
  'services',
  'screens',
  'components',
  'productCategories',
  'products',
  'locations',
  'orders',
  'discounts',
  'coupons',
  'giftCards',
  'reviews',
  'bookableUnits',
  'reservations',
  'campaigns',
  'overlays',
  'experiments',
  'redirects',
]

/** Org-scoped collections the seeder writes into (AGL-240 / AGL-1478). */
export const ORG_SEEDED_COLLECTIONS = [
  'contacts',
  'contactSegments',
  'lists',
  'datasets',
  'invites',
]

const SEED_PREFIX = 'seed-'
const HOME_SCREEN_ID = 'seed-home'
const HOME_VERSION_ID = 'seed-home-v1'
const EMAIL_SCREEN_ID = 'seed-email-welcome'
const EMAIL_VERSION_ID = 'seed-email-v1'

/** Root path of a host's home screen (`SCREEN_ROOT_PATH`). */
const SCREEN_ROOT_PATH = '/'

/** `nameLower` normalization, mirroring `membershipRow`. */
export const nameLower = (value) =>
  String(value).trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Deletes the `seed-…` documents (and their subcollections) under a host and,
 * when the host is org-wired, this host's fixtures in the shared org
 * collections.
 *
 * Deliberately NOT a wipe: a real document sitting next to the fixtures
 * survives, because the demo org may end up holding a hand-built site that
 * nobody wants a re-seed to eat.
 */
export async function pruneSeedFixtures({ firestore, hostRef, orgRef, log }) {
  let deleted = 0
  // `listDocuments`, not a query: a parent whose own fields were never
  // written still owns its subcollection (dataset records, blog entries,
  // screen versions), and such a document is invisible to `get()` while its
  // children very much are not. Listing refs finds it; a query would leave
  // the children orphaned for the next run to read back.
  const prune = async (collectionRef) => {
    const refs = await collectionRef.listDocuments()
    for (const ref of refs) {
      if (!ref.id.startsWith(SEED_PREFIX)) continue
      await firestore.recursiveDelete(ref)
      deleted += 1
    }
  }
  for (const name of HOST_SEEDED_COLLECTIONS) {
    await prune(hostRef.collection(name))
  }
  // The org collections are SHARED between the org's sites, so only this
  // host's rows may go. They are tagged with `seedHostId` on write for
  // exactly this reason — pruning by the `seed-` prefix alone would delete
  // the sibling sites' contacts every time one site was re-seeded.
  if (orgRef) {
    for (const name of ORG_SEEDED_COLLECTIONS) {
      const snapshot = await orgRef
        .collection(name)
        .where('seedHostId', '==', hostRef.id)
        .get()
      for (const doc of snapshot.docs) {
        await firestore.recursiveDelete(doc.ref)
        deleted += 1
      }
    }
  }
  // The routing map is a FIELD, not a document, so recursiveDelete cannot
  // reach it. Left behind it points at screens that no longer exist and the
  // tenant 404s the home page — a stale map is the one piece of residue that
  // shows up as a broken site rather than as extra rows.
  await hostRef.set(
    {
      screens: {
        [HOME_SCREEN_ID]: FieldValue.delete(),
        [EMAIL_SCREEN_ID]: FieldValue.delete(),
      },
    },
    { merge: true },
  )
  log?.(`Pruned ${deleted} seed document(s) from ${hostRef.id}.`)
  return deleted
}

/**
 * Stamps a brand pack onto a host.
 *
 * `hostRef` must already exist — creating hosts is the org CLI's job, because
 * a create bypasses the site quota and that is a decision, not a detail.
 */
export async function seedBrand({ firestore, hostRef, brand, log, prune = true }) {
  const hostSnapshot = await hostRef.get()
  if (!hostSnapshot.exists) {
    throw new Error(`Host ${hostRef.id} does not exist`)
  }
  const orgId = hostSnapshot.get('orgId')
  const orgRef = orgId ? firestore.collection('orgs').doc(orgId) : null
  const dataRef = orgRef ?? hostRef
  /**
   * The AGL-1037 scope for anything written to `dataRef` (AGL-1478). Only
   * when it resolved to an ORG: a `hosts/{hostId}` subcollection is private
   * by construction and stores no scope, which is the same `null` branch
   * `newMediaFolderDoc` takes.
   */
  const dataScope = orgRef ? { visibleTo: ['org'], seedHostId: hostRef.id } : {}

  if (prune) await pruneSeedFixtures({ firestore, hostRef, orgRef, log })

  const now = FieldValue.serverTimestamp()
  const nowMs = Date.now()
  let written = 0
  const put = async (ref, data) => {
    await ref.set({ ...data, updatedAt: now }, { merge: true })
    written += 1
  }

  // ── Identity: name, theme, favicon ────────────────────────────────────────
  // The theme is a FIELD on the host doc (`resolveSiteTheme`), which is what
  // makes four sites in one switcher read as four businesses. Without it
  // every demo site renders the platform default and the whole exercise is
  // four names over one look.
  await put(hostRef, {
    displayName: brand.displayName,
    theme: brand.theme,
    seo: { favicon: `https://picsum.photos/seed/${brand.id}fav/64` },
  })

  // ── Variables / functions / workflows / actions ──────────────────────────
  for (const variable of brand.variables ?? []) {
    await put(hostRef.collection('variables').doc(variable.id), {
      name: variable.name,
      type: variable.type,
      value: variable.value,
      createdAt: now,
    })
  }
  const logic = brand.logic ?? {}
  if (logic.fn) {
    const { id, ...fn } = logic.fn
    await put(hostRef.collection('functions').doc(id), { ...fn, createdAt: now })
  }
  if (logic.workflow) {
    const { id, ...workflow } = logic.workflow
    await put(hostRef.collection('workflows').doc(id), {
      ...workflow,
      createdAt: now,
    })
  }
  if (logic.action) {
    const { id, ...action } = logic.action
    await put(hostRef.collection('actions').doc(id), { ...action, createdAt: now })
  }

  // ── Datasets ─────────────────────────────────────────────────────────────
  for (const dataset of brand.datasets ?? []) {
    const ref = hostRef.collection('datasets').doc(dataset.id)
    await put(ref, {
      name: dataset.name,
      fields: dataset.fields,
      createdAt: now,
    })
    for (const [index, values] of dataset.rows.entries()) {
      await put(ref.collection('records').doc(`seed-${index}`), {
        values,
        order: index,
        createdAt: now,
      })
    }
  }

  // ── Content collections ──────────────────────────────────────────────────
  for (const collection of brand.collections ?? []) {
    const ref = hostRef.collection('collections').doc(collection.id)
    await put(ref, {
      displayName: collection.displayName,
      slug: collection.slug,
      createdAt: now,
    })
    for (const entry of collection.entries ?? []) {
      const { id, ...fields } = entry
      await put(ref.collection('entries').doc(id), {
        ...fields,
        status: 'published',
        publishedAt: now,
        createdAt: now,
      })
    }
  }

  // ── Media ────────────────────────────────────────────────────────────────
  for (const media of brand.media ?? []) {
    await put(hostRef.collection('media').doc(media.id), {
      fileName: media.fileName,
      contentType: 'image/jpeg',
      sizeBytes: 120000,
      url: `https://picsum.photos/seed/${media.seed}`,
      folder: media.folder,
      tags: media.tags,
      alt: media.fileName.replace(/\.[a-z]+$/, ''),
      createdAt: now,
    })
  }

  // ── Leads / site members ─────────────────────────────────────────────────
  for (const lead of brand.leads ?? []) {
    const { id, ...fields } = lead
    await put(hostRef.collection('leads').doc(id), { ...fields, createdAt: now })
  }
  for (const member of brand.siteMembers ?? []) {
    const { id, ...fields } = member
    await put(hostRef.collection('siteMembers').doc(id), {
      ...fields,
      createdAt: now,
    })
  }

  // ── Bookable services ────────────────────────────────────────────────────
  for (const service of brand.services ?? []) {
    const { id, ...fields } = service
    await put(hostRef.collection('services').doc(id), { ...fields, createdAt: now })
  }

  // ── Commerce ─────────────────────────────────────────────────────────────
  // Absent for the practice and the firm, and that absence is the point:
  // an empty Products list next to the cantina's full one is what proves the
  // switcher is crossing between businesses, not between colour schemes.
  if (brand.commerce) {
    const c = brand.commerce
    for (const category of c.categories ?? []) {
      const { id, ...fields } = category
      await put(hostRef.collection('productCategories').doc(id), {
        ...fields,
        createdAt: now,
      })
    }
    for (const collection of c.collections ?? []) {
      const { id, ...fields } = collection
      await put(hostRef.collection('collections').doc(id), {
        ...fields,
        mode: 'manual',
        createdAt: now,
      })
    }
    for (const location of c.locations ?? []) {
      const { id, ...fields } = location
      await put(hostRef.collection('locations').doc(id), {
        ...fields,
        createdAt: now,
      })
    }
    for (const product of c.products ?? []) {
      const { id, imageSeed, ...fields } = product
      const url = `https://picsum.photos/seed/${imageSeed}`
      await put(hostRef.collection('products').doc(id), {
        ...fields,
        status: 'active',
        // Flat legacy fields alongside the structured `variants`, so every
        // surface renders without a lift step.
        imageUrl: url,
        mediaUrls: [url],
        createdAtMs: nowMs,
        createdAt: now,
      })
    }
    for (const order of c.orders ?? []) {
      const { id, ...fields } = order
      await put(hostRef.collection('orders').doc(id), {
        ...fields,
        createdAtMs: nowMs,
        createdAt: now,
      })
    }
    for (const discount of c.discounts ?? []) {
      const { id, ...fields } = discount
      await put(hostRef.collection('discounts').doc(id), {
        ...fields,
        createdAt: now,
      })
    }
    for (const coupon of c.coupons ?? []) {
      const { id, ...fields } = coupon
      await put(hostRef.collection('coupons').doc(id), { ...fields, createdAt: now })
    }
    for (const card of c.giftCards ?? []) {
      const { id, ...fields } = card
      await put(hostRef.collection('giftCards').doc(id), { ...fields, createdAt: now })
    }
    for (const review of c.reviews ?? []) {
      const { id, ...fields } = review
      await put(hostRef.collection('reviews').doc(id), {
        ...fields,
        status: 'approved',
        verified: true,
        createdAt: now,
      })
    }
  }

  // ── Reservations ─────────────────────────────────────────────────────────
  if (brand.reservations) {
    for (const unit of brand.reservations.units ?? []) {
      const { id, ...fields } = unit
      await put(hostRef.collection('bookableUnits').doc(id), {
        ...fields,
        createdAt: now,
      })
    }
    for (const booking of brand.reservations.bookings ?? []) {
      const { id, ...fields } = booking
      await put(hostRef.collection('reservations').doc(id), {
        ...fields,
        createdAtMs: nowMs,
        createdAt: now,
      })
    }
  }

  // ── Marketing ────────────────────────────────────────────────────────────
  const marketing = brand.marketing ?? {}
  for (const campaign of marketing.campaigns ?? []) {
    const { id, ...fields } = campaign
    await put(hostRef.collection('campaigns').doc(id), {
      ...fields,
      status: 'sent',
      sentAt: now,
      createdAt: now,
    })
  }
  if (marketing.email) {
    const emailScreen = hostRef.collection('screens').doc(EMAIL_SCREEN_ID)
    await put(emailScreen, {
      displayName: 'Welcome email',
      kind: 'email',
      versionId: EMAIL_VERSION_ID,
      emailSubject: marketing.email.subject,
      emailPreheader: marketing.email.preheader,
      createdAt: now,
    })
    await put(emailScreen.collection('versions').doc(EMAIL_VERSION_ID), {
      screenId: EMAIL_SCREEN_ID,
      nodes: {
        root: { $id: 'root', componentId: 'div', nodes: ['sec'] },
        sec: {
          $id: 'sec',
          componentId: 'emailSection',
          pluginId: 'email',
          parentId: 'root',
          nodes: ['txt', 'btn'],
        },
        txt: {
          $id: 'txt',
          componentId: 'emailText',
          pluginId: 'email',
          parentId: 'sec',
          props: { children: marketing.email.heading, variant: 'heading' },
        },
        btn: {
          $id: 'btn',
          componentId: 'emailButton',
          pluginId: 'email',
          parentId: 'sec',
          props: { children: marketing.email.button, href: '{{site.url}}' },
        },
      },
      createdAt: now,
    })
  }
  for (const overlay of marketing.overlays ?? []) {
    const { id, ...fields } = overlay
    await put(hostRef.collection('overlays').doc(id), { ...fields, createdAt: now })
  }
  for (const experiment of marketing.experiments ?? []) {
    const { id, ...fields } = experiment
    await put(hostRef.collection('experiments').doc(id), {
      ...fields,
      status: 'running',
      createdAt: now,
    })
  }

  // ── Redirects ────────────────────────────────────────────────────────────
  for (const redirect of brand.redirects ?? []) {
    const { id, ...fields } = redirect
    await put(hostRef.collection('redirects').doc(id), {
      ...fields,
      enabled: true,
      createdAt: now,
    })
  }

  // ── Home screen ──────────────────────────────────────────────────────────
  // A screen is only reachable once BOTH the screen doc carries the slug and
  // the host's `screens` routing map names it (`publishScreenRoute`) — a
  // seeded version with no map entry renders nothing and looks like a bug in
  // the product rather than a gap in the fixture.
  if (brand.home) {
    const homeScreen = hostRef.collection('screens').doc(HOME_SCREEN_ID)
    await put(homeScreen, {
      displayName: 'Home',
      nameLower: 'home',
      slug: SCREEN_ROOT_PATH,
      versionId: HOME_VERSION_ID,
      publishedAt: now,
      createdAt: now,
    })
    await put(homeScreen.collection('versions').doc(HOME_VERSION_ID), {
      screenId: HOME_SCREEN_ID,
      nodes: buildHomeNodes(brand.home.sections),
      createdAt: now,
    })
    await put(hostRef, { screens: { [HOME_SCREEN_ID]: SCREEN_ROOT_PATH } })
  }

  // ── Org-scoped data ──────────────────────────────────────────────────────
  const orgData = brand.orgData ?? {}
  for (const contact of orgData.contacts ?? []) {
    const { id, ...fields } = contact
    await put(dataRef.collection('contacts').doc(scopedId(id, hostRef.id, orgRef)), {
      ...fields,
      ...dataScope,
      createdAt: now,
    })
  }
  for (const segment of orgData.segments ?? []) {
    const { id, ...fields } = segment
    await put(
      dataRef.collection('contactSegments').doc(scopedId(id, hostRef.id, orgRef)),
      { ...fields, sources: [], ...dataScope, createdAt: now },
    )
  }
  for (const list of orgData.lists ?? []) {
    const { id, ...fields } = list
    await put(dataRef.collection('lists').doc(scopedId(id, hostRef.id, orgRef)), {
      ...fields,
      ...dataScope,
      createdAt: now,
    })
  }
  for (const dataset of orgData.datasets ?? []) {
    const { id, ...fields } = dataset
    await put(dataRef.collection('datasets').doc(scopedId(id, hostRef.id, orgRef)), {
      ...fields,
      ...dataScope,
      createdAt: now,
    })
  }

  // ── An invited teammate scoped to THIS site ──────────────────────────────
  // Demo minutes 3–10 are "switch between several sites in one org; roles and
  // permissions". A per-site invite is what makes that surface non-empty, and
  // `hostAccess` (rather than `allHosts`) is what makes it interesting: the
  // roles table then shows a team with different reach per client.
  //
  // Written as an INVITE, not a member. `orgs/{orgId}/members/{uid}` is keyed
  // by uid and read by the rules on every request; there is no uid for an
  // email that has never signed in, and inventing one would put a
  // never-resolvable principal in the authorization collection.
  if (orgRef && brand.teamMember) {
    await put(orgRef.collection('invites').doc(`seed-invite-${brand.id}`), {
      email: brand.teamMember.email,
      role: brand.teamMember.role,
      allHosts: false,
      hostAccess: { [hostRef.id]: brand.teamMember.role },
      acceptedAt: null,
      seedHostId: hostRef.id,
      createdAt: now,
    })
  } else if (!orgRef) {
    log?.('Host has no orgId — skipped org-scoped fixtures and the invite.')
  }

  log?.(`Seeded ${written} "${brand.id}" fixture document(s) into ${hostRef.id}.`)
  return written
}

/**
 * Org collections are shared, so two sites seeded into one org would collide
 * on `seed-contact-1`.
 *
 * Namespaced by HOST, not by brand: the prune reclaims these rows by
 * `seedHostId`, so two sites carrying the same pack would otherwise take
 * turns deleting each other's org data — one of them ending up with none.
 * The host id is also what makes the row's owner readable at a glance in the
 * emulator UI.
 */
function scopedId(id, hostId, orgRef) {
  return orgRef ? `${id}-${hostId}` : id
}

/**
 * The one platform-global fixture: a published marketplace listing.
 *
 * Written once rather than per host, and never pruned — it lives outside any
 * host, so deleting it while re-seeding one site would blank the marketplace
 * for every other one.
 */
export async function seedMarketplaceListing({ firestore }) {
  await firestore
    .collection('marketplaceListings')
    .doc('seed-listing-hero')
    .set(
      {
        displayName: 'Hero banner',
        description: 'A reusable hero section with a headline and CTA.',
        category: 'Sections',
        latestVersion: 1,
        installCount: 4,
        priceUsd: 0,
        deletedAt: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
}

/**
 * Creates a host under an org if it is missing, with every projection the
 * console reads.
 *
 * Direct writes, not `/api/hosts/create`, because a seeder has no session —
 * which also means this bypasses the plan's site quota. That is why it is
 * opt-in behind a flag rather than something `seedBrand` does implicitly.
 */
export async function ensureHost({
  firestore,
  hostId,
  subdomain,
  displayName,
  orgId,
  log,
}) {
  const hostRef = firestore.collection('hosts').doc(hostId)
  const existing = await hostRef.get()
  const orgSnapshot = await firestore.collection('orgs').doc(orgId).get()
  if (!orgSnapshot.exists) throw new Error(`Org ${orgId} does not exist`)

  if (existing.exists) {
    const existingOrg = existing.get('orgId')
    if (existingOrg && existingOrg !== orgId) {
      throw new Error(
        `Host ${hostId} already belongs to org ${existingOrg}, refusing to move it`,
      )
    }
    log?.(`Host ${hostId} already exists — reusing it.`)
  }

  // A subdomain must be unique platform-wide; a duplicate would make one of
  // the two sites unreachable and the failure would surface as a 404 mid-demo.
  const clash = await firestore
    .collection('hosts')
    .where('subdomain', '==', subdomain)
    .get()
  for (const doc of clash.docs) {
    if (doc.id !== hostId) {
      throw new Error(
        `Subdomain "${subdomain}" is already taken by host ${doc.id}`,
      )
    }
  }

  const now = FieldValue.serverTimestamp()
  // One team model across every site is the demo's whole argument, so every
  // org member is projected onto the host — but at the role they actually
  // hold. This mirrors `hostRoleFor` (`libs/aglyn/…/organizations.ts`):
  // owner and admin become `admin`; an explicit `hostAccess` entry wins next;
  // otherwise `allHosts` grants the member's own role and its absence grants
  // nothing. Collapsing everyone to `admin` — which an earlier draft did —
  // makes the roles minute of the demo argue that scoping does not work.
  const members = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection('members')
    .get()
  const memberRoles = {}
  for (const member of members.docs) {
    const role = member.get('role')
    const resolved =
      role === 'owner' || role === 'admin'
        ? 'admin'
        : (member.get('hostAccess') ?? {})[hostId] ??
          (member.get('allHosts') ? role : null)
    if (resolved) memberRoles[member.id] = resolved
  }

  await hostRef.set(
    {
      displayName,
      subdomain,
      orgId,
      memberRoles,
      screens: {},
      createdAt: now,
      updatedAt: now,
    },
    { merge: true },
  )
  await firestore
    .collection('hostIndex')
    .doc(hostId)
    .set({ orgId, subdomain }, { merge: true })
  await firestore
    .collection('orgs')
    .doc(orgId)
    .set({ hosts: { [hostId]: true }, updatedAt: now }, { merge: true })
  // `users/{uid}/hostMemberships` is the projection the site switcher reads —
  // it never queries `hosts`. A missing row does not fail loudly; the site
  // simply does not appear in the switcher, which on a demo about switching
  // between sites is the worst possible silent failure.
  for (const member of members.docs) {
    // A member the role resolution gave nothing gets no row: the switcher
    // reads this collection directly, so a row here IS access as far as the
    // UI is concerned, and listing a site someone cannot open is worse than
    // omitting it.
    if (!memberRoles[member.id]) continue
    await firestore
      .collection('users')
      .doc(member.id)
      .collection('hostMemberships')
      .doc(hostId)
      .set(
        {
          orgId,
          subdomain,
          displayName,
          nameLower: nameLower(displayName),
          role: memberRoles[member.id],
          createdAt: now,
          updatedAt: now,
        },
        { merge: true },
      )
  }
  log?.(`Host ${hostId} (${subdomain}) ready in org ${orgId}.`)
  return hostRef
}
