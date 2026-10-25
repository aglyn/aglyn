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
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import type {
  PosReaderSplashChoice,
  PosReaderSplashFamilyId,
  PosReaderSplashStatus,
} from '../../../model/pos-reader-splash'

/*
 * The card reader start-up screen's client half (AGL-4048): the POS devices
 * card's setting and the staff page's default, so neither builds a request
 * by hand.
 */

type User = Parameters<typeof authorizedFetch>[0]

export class PosReaderSplashRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function send<T>(user: User, url: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  const response = await authorizedFetch(user, url, {
    method: init.method,
    headers: init.method === 'POST' ? { 'Content-Type': 'application/json' } : {},
    ...(init.method === 'POST' ? { body: JSON.stringify(init.body ?? {}) } : {}),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new PosReaderSplashRequestError(String(payload?.error ?? 'Something went wrong'), response.status)
  }
  return payload as T
}

const STORE_URL = '/api/commerce/pos-reader-splash'
const STAFF_URL = '/api/commerce/admin/reader-splash'

export function readerSplashStatus(user: User, hostId: string): Promise<PosReaderSplashStatus> {
  return send(user, STORE_URL, { method: 'POST', body: { action: 'status', hostId } })
}

export function saveReaderSplash(
  user: User,
  hostId: string,
  choice: PosReaderSplashChoice,
  image?: { mediaScope: string; mediaId: string },
): Promise<PosReaderSplashStatus> {
  return send(user, STORE_URL, { method: 'POST', body: { action: 'save', hostId, choice, ...(image ?? {}) } })
}

export interface StaffReaderSplashFamily {
  id: PosReaderSplashFamilyId
  label: string
  width: number
  height: number
  image: { contentType: string; bytes: number; sha256: string; uploadedAtMs: number } | null
}

export interface StaffReaderSplash {
  ready: boolean
  families: StaffReaderSplashFamily[]
  updatedAtMs: number | null
  canWrite: boolean
}

export function staffReaderSplash(user: User): Promise<StaffReaderSplash> {
  return send(user, STAFF_URL, { method: 'GET' })
}

export function staffUploadReaderSplash(
  user: User,
  family: PosReaderSplashFamilyId,
  dataBase64: string,
): Promise<StaffReaderSplash> {
  return send(user, STAFF_URL, { method: 'POST', body: { action: 'upload', family, dataBase64 } })
}

export function staffRemoveReaderSplash(user: User, family: PosReaderSplashFamilyId): Promise<StaffReaderSplash> {
  return send(user, STAFF_URL, { method: 'POST', body: { action: 'remove', family } })
}

export function staffApplyReaderSplash(
  user: User,
): Promise<{ applied: number; unchanged: number; failed: number; more: boolean }> {
  return send(user, STAFF_URL, { method: 'POST', body: { action: 'apply' } })
}

/** A family's current default image, as an object URL the page revokes. */
export async function staffReaderSplashPreview(user: User, family: PosReaderSplashFamilyId): Promise<string | null> {
  const response = await authorizedFetch(user, `${STAFF_URL}?preview=${encodeURIComponent(family)}`, { method: 'GET' })
  if (!response.ok) return null
  return URL.createObjectURL(await response.blob())
}
