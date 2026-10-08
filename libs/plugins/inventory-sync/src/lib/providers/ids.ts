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

import { createHash } from 'node:crypto'

/**
 * A UUID derived from a name (AGL-3642): the same name always gives the same
 * id, in the RFC 4122 layout with version 5 bits. inFlow writes every record
 * with a client-chosen GUID and treats a second write under the same one as
 * an update, so an order, an adjustment or a product written under an id
 * derived from our own reference is one record however often it is sent.
 */
export function nameUuid(name: string): string {
  const hex = createHash('sha256').update(`aglyn-inventory-sync:${name}`).digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  const joined = hex.join('')
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20, 32)}`
}

/** Our reference for one order of one site, as the system's record carries it: `AG1042-3fa9c2d1`. */
export function orderReference(hostId: string, recordId: string, number: number | null): string {
  const digest = createHash('sha256').update(`${hostId}/${recordId}`).digest('hex').slice(0, 8)
  return `AG${typeof number === 'number' && number > 0 ? number : ''}-${digest}`
}
