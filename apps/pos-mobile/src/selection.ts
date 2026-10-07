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

import type { WorkspaceSite } from '@aglyn/mobile-core'
import { collection, getDocs, limit, query, type Firestore } from 'firebase/firestore'

/*==========================================
 * WHERE THE REGISTER RUNS (AGL-3618).
 *
 * Sites the signed-in member can SELL on: `admin` or `editor` on the site,
 * the same allowlist `pos-order.ts` applies (AGL-2262). `managePos` and the
 * `pos` plan entitlement are the server's to check, and the register page and
 * the connection-token route both do; the app only avoids offering sites the
 * role alone already rules out.
 *
 * Registers come from `hosts/{hostId}/registers`, the collection the web
 * register reads. Which of them are within the plan's cap is the register
 * page's decision (it ranks them by creation, as the sale route does), so the
 * app's choice rides along as `?register=` and the page keeps the final say.
 *=========================================*/

export interface PosRegister {
  id: string
  name: string
}

export interface PosSelection {
  site: WorkspaceSite
  register: PosRegister | null
}

export function sitesThatCanSell(sites: WorkspaceSite[]): WorkspaceSite[] {
  return sites.filter((site) => site.role === 'admin' || site.role === 'editor')
}

export function sortRegisters(registers: PosRegister[]): PosRegister[] {
  return [...registers].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

export async function listRegisters(firestore: Firestore, hostId: string): Promise<PosRegister[]> {
  const snapshot = await getDocs(query(collection(firestore, 'hosts', hostId, 'registers'), limit(25)))
  return sortRegisters(
    snapshot.docs.map((entry) => ({
      id: entry.id,
      name: String(entry.get('name') ?? '') || 'Register',
    })),
  )
}

const SELECTION_KEY = 'aglyn-pos:selection:v1'

/** The last site and register, so a relaunch opens straight to the register. */
export function serializeSelection(selection: PosSelection, uid: string): string {
  return JSON.stringify({ ...selection, uid })
}

export function parseSelection(raw: string | null, uid: string, sites: WorkspaceSite[]): PosSelection | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as PosSelection & { uid?: string }
    // Only a site this member can still sell on is reopened.
    const site = sitesThatCanSell(sites).find((entry) => entry.hostId === parsed?.site?.hostId)
    if (!site || parsed.uid !== uid) return null
    const register =
      parsed.register && typeof parsed.register.id === 'string'
        ? { id: parsed.register.id, name: String(parsed.register.name ?? 'Register') }
        : null
    return { site, register }
  } catch {
    return null
  }
}

export { SELECTION_KEY }
