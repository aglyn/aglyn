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

import { SITE_COLLABORATOR } from './workspace.mjs'

/*
 * Seed for the Aglyn app's workspace management screens (AGL-3671) and staff
 * section (AGL-3667): the workspace's profile, plan and subscription, the
 * site's settings and approved hosts, the owner's profile, a site
 * collaborator, site activity, and a STAFF account whose ID token carries
 * `staff: true` and `staffRole: super`, the claims the console's /admin area
 * and the apps' staff section read. Claims go on through the Auth emulator's
 * own admin API (`accounts:update` with `customAttributes`, as owner), which
 * exists only on the emulator.
 */

export const STAFF_EMAIL = 'mobile-staff@example.test'

/** Marks an account's email verified, as a real sign-up's is once confirmed; the console's routes refuse an unverified caller. */
async function verifyEmail(auth, project, localId) {
  const response = await fetch(`http://${auth}/identitytoolkit.googleapis.com/v1/projects/${project}/accounts:update`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ localId, emailVerified: true }),
  })
  if (!response.ok) throw new Error(`verify ${localId}: ${response.status} ${await response.text()}`)
}

/** Creates (or signs in) the staff account and sets its claims; returns its uid. */
async function staffAccount(auth, project) {
  const base = `http://${auth}/identitytoolkit.googleapis.com/v1`
  const password = `seed-${project}-staff`
  const headers = { 'content-type': 'application/json' }
  const body = JSON.stringify({ email: STAFF_EMAIL, password, returnSecureToken: true })
  let response = await fetch(`${base}/accounts:signUp?key=emulator`, { method: 'POST', headers, body })
  if (!response.ok) response = await fetch(`${base}/accounts:signInWithPassword?key=emulator`, { method: 'POST', headers, body })
  const { localId } = await response.json()
  const update = await fetch(`${base}/projects/${project}/accounts:update`, {
    method: 'POST',
    headers: { ...headers, authorization: 'Bearer owner' },
    body: JSON.stringify({
      localId,
      emailVerified: true,
      displayName: 'Riley Staff',
      customAttributes: JSON.stringify({ staff: true, staffRole: 'super' }),
    }),
  })
  if (!update.ok) throw new Error(`staff claims: ${update.status} ${await update.text()}`)
  return { uid: localId, password }
}

export async function seedAccount({ put, uid, orgId, hostId, now, auth, project }) {
  const day = 24 * 60 * 60 * 1000
  await put(
    `orgs/${orgId}`,
    {
      timeZone: 'America/Chicago',
      contact: { email: 'hello@juniperstreet.example', phone: '+1 512 555 0100', website: 'https://juniperstreet.example' },
      defaultMediaScope: 'host',
      defaultResourceScope: 'host',
      subscription: { status: 'active', interval: 'month', currentPeriodEnd: new Date(now.getTime() + 21 * day) },
      ownerUid: uid,
    },
    { merge: true },
  )
  await put(
    `hosts/${hostId}`,
    {
      timeZone: 'America/Chicago',
      approvedMediaHosts: ['images.unsplash.com'],
      approvedFontHosts: ['fonts.gstatic.com'],
      approvedFormActions: [],
      approvedFrameHosts: ['www.youtube.com'],
      approvedConnectHosts: [],
    },
    { merge: true },
  )
  // The profile's name is the one the roster shows, so the account menu and Team agree; the photo is the library pick
  // workspace.mjs seeds, stored as the console stores one: its CDN path on the profile (`photoUrl`, the account menu's)
  // and mirrored on the roster (`photoURL`, Team's rows), so every place the member appears shows it (AGL-4010).
  const photo = `/api/media/cdn/org:${orgId}/seed-media-member-photo`
  await put(`users/${uid}`, { firstName: 'Hannah', lastName: 'Reyes', phoneNumber: '+1 512 555 0101', photoUrl: photo }, { merge: true })
  await put(
    `orgs/${orgId}/members/${uid}`,
    { email: 'mobile-owner@example.test', displayName: 'Hannah Reyes', title: 'Founder', photoURL: photo },
    { merge: true },
  )
  await put(`hosts/${hostId}/members/${uid}`, {
    uid,
    email: 'mobile-owner@example.test',
    displayName: 'Hannah Reyes',
    role: 'admin',
    owner: true,
    status: 'active',
    createdAt: now,
  })
  // The site's collaborator is also on the workspace's roster with an account (workspace.mjs), as the console stores
  // one added by email: its role change and removal read both and answered 404 for a roster-only stub.
  await put(`hosts/${hostId}/members/${SITE_COLLABORATOR.uid}`, {
    uid: SITE_COLLABORATOR.uid,
    email: SITE_COLLABORATOR.email,
    displayName: SITE_COLLABORATOR.displayName,
    role: SITE_COLLABORATOR.siteRole,
    status: 'active',
    createdAt: new Date(now.getTime() - 9 * day),
  })
  const activity = [
    ['Published page', { type: 'screen', name: 'Home' }, 2],
    ['Updated host settings', { type: 'host', name: 'Juniper Street Bakery' }, 26],
    ['Added redirect', { type: 'redirect', name: '/fall' }, 50],
  ]
  for (const [index, [action, target, hours]] of activity.entries()) {
    await put(`hosts/${hostId}/activity/seed-activity-${index}`, {
      action,
      target,
      actorId: uid,
      actorEmail: 'mobile-owner@example.test',
      createdAt: new Date(now.getTime() - hours * 60 * 60 * 1000),
    })
  }
  if (!auth || !project) return null
  await verifyEmail(auth, project, uid)
  const staff = await staffAccount(auth, project)
  await put(`users/${staff.uid}`, { email: STAFF_EMAIL, displayName: 'Riley Staff', createdAt: now })
  return staff
}
