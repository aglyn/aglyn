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

import type { HostFunction } from '@aglyn/aglyn/app-utils/functions'
import type { AiLogicSiteVariable } from '../model/ai-logic-job'

/**
 * What a `logic` job reads (AGL-3603): the site's variables and function
 * names, in the window the Functions & Variables page itself reads, and one
 * saved function by id. Functions and variables are core documents
 * (`hosts/{hostId}/functions`, `hosts/{hostId}/variables`), read through the
 * Admin SDK as projections of the fields named here.
 */

type Firestore = FirebaseFirestore.Firestore
type Data = Record<string, unknown>

/** Records of one kind a job reads: the logic page's own ceiling. */
export const AI_LOGIC_RECORDS_WINDOW = 100

const live = (data: Data) => data['deletedAt'] == null

export interface AiLogicRecords {
  variables: AiLogicSiteVariable[]
  functions: string[]
}

/** The site's live variables (name, type, value) and function names. */
export async function readAiLogicRecords(firestore: Firestore, hostId: string): Promise<AiLogicRecords> {
  const host = firestore.collection('hosts').doc(hostId)
  const [variables, functions] = await Promise.all([
    host.collection('variables').select('name', 'type', 'value', 'deletedAt').limit(AI_LOGIC_RECORDS_WINDOW).get(),
    host.collection('functions').select('name', 'deletedAt').limit(AI_LOGIC_RECORDS_WINDOW).get(),
  ])
  return {
    variables: variables.docs
      .map((doc) => (doc.data() ?? {}) as Data)
      .filter(live)
      .filter((data) => typeof data['name'] === 'string' && data['name'])
      .map((data) => ({
        name: String(data['name']),
        type: (typeof data['type'] === 'string' ? data['type'] : 'text') as AiLogicSiteVariable['type'],
        value: typeof data['value'] === 'string' ? data['value'] : '',
      })),
    functions: functions.docs
      .map((doc) => (doc.data() ?? {}) as Data)
      .filter(live)
      .map((data) => (typeof data['name'] === 'string' ? data['name'].trim() : ''))
      .filter(Boolean),
  }
}

/** One saved function of the site, or `null` for one that does not exist or was deleted. */
export async function readAiLogicFunction(
  firestore: Firestore,
  input: { hostId: string; id: string },
): Promise<HostFunction | null> {
  const snapshot = await firestore.collection('hosts').doc(input.hostId).collection('functions').doc(input.id).get()
  const data = snapshot.exists ? ((snapshot.data() ?? {}) as Data) : null
  if (!data || !live(data) || typeof data['name'] !== 'string') return null
  return {
    name: data['name'],
    parameters: Array.isArray(data['parameters']) ? (data['parameters'] as HostFunction['parameters']) : [],
    variables: Array.isArray(data['variables']) ? (data['variables'] as HostFunction['variables']) : [],
    operations: Array.isArray(data['operations']) ? (data['operations'] as HostFunction['operations']) : [],
    ...(typeof data['returnValue'] === 'string' ? { returnValue: data['returnValue'] } : {}),
  }
}
