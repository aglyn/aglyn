/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.aglyn.com/"}
 *
 * Pragmas must stay in the FIRST block comment — behind the license header
 * they are silently ignored.
 *
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
 * Admin-bar shared storage (AGL-1829): the returning-editor token moved
 * from sessionStorage (per-tab — a new tab lost the bar) to localStorage.
 * Pinned here:
 *
 * - round-trip and expiry pruning on the localStorage slot;
 * - MIGRATION: a still-valid legacy sessionStorage token is read, moved
 *   into localStorage, and removed from the old slot;
 * - an expired legacy token is NOT migrated;
 * - clearStoredEditToken empties both stores;
 * - the presence-hint cookie reader matches exactly `aglyn_editor=1`;
 * - the per-host disconnect opt-out round-trips.
 */

import {
  clearEditOptOut,
  clearStoredEditToken,
  editTokenStorageKey,
  hasEditorHint,
  isEditOptedOut,
  readStoredEditToken,
  setEditOptOut,
  writeStoredEditToken,
} from '../app/[host]/admin-bar/admin-bar-shared'

const HOST = 'host-1'

describe('admin-bar token storage (AGL-1829)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    document.cookie = 'aglyn_editor=; Max-Age=0; Path=/'
  })

  it('round-trips a token through localStorage', () => {
    const stored = {
      token: 't-1',
      expiresAtMs: Date.now() + 60_000,
      siteName: 'Site',
      userEmail: 'editor@aglyn.com',
    }
    writeStoredEditToken(HOST, stored)
    expect(readStoredEditToken(HOST)).toEqual(stored)
    // The point of the move: a second tab (fresh sessionStorage) still sees
    // the token, because it does not live in sessionStorage at all.
    expect(window.sessionStorage.getItem(editTokenStorageKey(HOST))).toBeNull()
    expect(
      window.localStorage.getItem(editTokenStorageKey(HOST)),
    ).not.toBeNull()
  })

  it('prunes an expired token on read', () => {
    writeStoredEditToken(HOST, { token: 't-1', expiresAtMs: Date.now() - 1 })
    expect(readStoredEditToken(HOST)).toBeNull()
    expect(window.localStorage.getItem(editTokenStorageKey(HOST))).toBeNull()
  })

  it('migrates a still-valid legacy sessionStorage token forward', () => {
    const legacy = { token: 't-legacy', expiresAtMs: Date.now() + 60_000 }
    window.sessionStorage.setItem(
      editTokenStorageKey(HOST),
      JSON.stringify(legacy),
    )
    expect(readStoredEditToken(HOST)).toEqual(legacy)
    expect(window.sessionStorage.getItem(editTokenStorageKey(HOST))).toBeNull()
    expect(readStoredEditToken(HOST)).toEqual(legacy) // now from localStorage
  })

  it('does not migrate an expired legacy token', () => {
    window.sessionStorage.setItem(
      editTokenStorageKey(HOST),
      JSON.stringify({ token: 't-legacy', expiresAtMs: Date.now() - 1 }),
    )
    expect(readStoredEditToken(HOST)).toBeNull()
    expect(window.localStorage.getItem(editTokenStorageKey(HOST))).toBeNull()
  })

  it('clearStoredEditToken empties both stores', () => {
    writeStoredEditToken(HOST, { token: 't-1', expiresAtMs: Date.now() + 60_000 })
    window.sessionStorage.setItem(
      editTokenStorageKey(HOST),
      JSON.stringify({ token: 't-old', expiresAtMs: Date.now() + 60_000 }),
    )
    clearStoredEditToken(HOST)
    expect(readStoredEditToken(HOST)).toBeNull()
    expect(window.sessionStorage.getItem(editTokenStorageKey(HOST))).toBeNull()
  })

  it('reads the presence hint only as the exact aglyn_editor=1', () => {
    expect(hasEditorHint()).toBe(false)
    document.cookie = 'aglyn_editor=1; Path=/'
    expect(hasEditorHint()).toBe(true)
    document.cookie = 'aglyn_editor=; Max-Age=0; Path=/'
    document.cookie = 'aglyn_editor=0; Path=/'
    expect(hasEditorHint()).toBe(false)
  })

  it('round-trips the per-host disconnect opt-out', () => {
    expect(isEditOptedOut(HOST)).toBe(false)
    setEditOptOut(HOST)
    expect(isEditOptedOut(HOST)).toBe(true)
    expect(isEditOptedOut('other-host')).toBe(false)
    clearEditOptOut(HOST)
    expect(isEditOptedOut(HOST)).toBe(false)
  })
})
