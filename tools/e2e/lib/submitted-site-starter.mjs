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

// One site starter waiting for review on the emulator (AGL-4049), for what
// the staff review queue shows: the listing and its first version, written in
// the shape `publish-starter.ts` writes them, under a publisher of its own.
//
// Written over the Firestore emulator's REST door with its admin token, which
// nothing but an emulator accepts, so this cannot reach a real project. A
// docs shot takes the starter out again: a starter in the queue changes what
// every other shot of `/admin/plugin-reviews` shows.

/** The listing's id, and the base of its review page's path. */
export const SUBMITTED_STARTER_LISTING = 'docs-submitted-starter'

/** The publisher's org. The queue names a publisher by its org's name. */
export const SUBMITTED_STARTER_PUBLISHER = 'docs-review-publisher'

const EMULATOR_ADMIN = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }

const PAGES = [
  { displayName: 'Home', slug: '/' },
  { displayName: 'Menu', slug: '/menu' },
  { displayName: 'About', slug: '/about' },
  { displayName: 'Contact', slug: '/contact' },
]

/** A value as the Firestore REST API stores it. */
function firestoreValue(value) {
  if (value === null) return { nullValue: null }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return { integerValue: String(value) }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } }
  return { mapValue: { fields: firestoreFields(value) } }
}

function firestoreFields(record) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, firestoreValue(value)]),
  )
}

/**
 * Writes the starter and its publisher, and returns the function that removes
 * them. Throws rather than warning: a starter that silently failed to land
 * photographs an empty queue.
 *
 * @param {object} options
 * @param {string} options.firestoreHost `host:port` of the Firestore emulator.
 * @param {string} options.projectId The project the seed wrote to.
 * @param {string} options.agreementVersion The Publisher Agreement in force.
 * @param {string} options.sourceHostId The site the starter was published from.
 */
export async function submitSiteStarter({
  firestoreHost,
  projectId,
  agreementVersion,
  sourceHostId,
}) {
  const root = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`
  const write = async (path, data) => {
    const response = await fetch(`${root}/${path}`, {
      method: 'PATCH',
      headers: EMULATOR_ADMIN,
      body: JSON.stringify({ fields: firestoreFields(data) }),
    })
    if (!response.ok) {
      throw new Error(`${path} not written (${response.status}) at ${firestoreHost}`)
    }
  }
  const remove = async (path) => {
    const response = await fetch(`${root}/${path}`, { method: 'DELETE', headers: EMULATOR_ADMIN })
    if (!response.ok) throw new Error(`${path} not removed (${response.status})`)
  }

  const listing = `marketplaceListings/${SUBMITTED_STARTER_LISTING}`
  const now = new Date()
  const facets = {
    kind: 'restaurant',
    base: 'material3',
    fonts: 'fraunces',
    pages: PAGES.length,
    mode: 'base',
  }

  await write(`orgs/${SUBMITTED_STARTER_PUBLISHER}`, {
    name: 'Northwind Coffee',
    slug: SUBMITTED_STARTER_PUBLISHER,
  })
  await write(`publisherProfiles/${SUBMITTED_STARTER_PUBLISHER}`, {
    handle: 'northwind-coffee',
    displayName: 'Northwind Coffee',
    publisherAgreement: { version: agreementVersion },
  })
  await write(`${listing}/versions/1`, {
    publishedAt: now,
    starter: {
      mode: 'base',
      facets,
      theme: {
        kind: 'builtin',
        base: facets.base,
        fonts: facets.fonts,
        brand: {
          light: { primary: '#7A4B2A', secondary: '#2F6B5E' },
          dark: { primary: '#E2B48C', secondary: '#8FCFBF' },
        },
      },
      screens: PAGES,
      layout: { displayName: 'Site header and footer' },
    },
  })
  await write(listing, {
    artifactType: 'siteStarter',
    profileId: SUBMITTED_STARTER_PUBLISHER,
    sourceStarterHostId: sourceHostId,
    displayName: 'Corner Bistro',
    description: 'A warm four-page site for a neighborhood restaurant, with a menu page.',
    category: 'Restaurant & café',
    priceUsd: 19,
    screenCount: PAGES.length,
    latestVersion: 1,
    deletedAt: null,
    reviewStatus: 'submitted',
    createdAt: now,
    updatedAt: now,
    starterKind: facets.kind,
    starterBase: facets.base,
    starterFonts: facets.fonts,
    starterPages: facets.pages,
    starterMode: facets.mode,
  })

  return async () => {
    await remove(`${listing}/versions/1`)
    await remove(listing)
    await remove(`publisherProfiles/${SUBMITTED_STARTER_PUBLISHER}`)
    await remove(`orgs/${SUBMITTED_STARTER_PUBLISHER}`)
  }
}
