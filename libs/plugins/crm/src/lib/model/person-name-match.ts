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
 * Whether two people's names plausibly belong to one person — the "possible"
 * half of the sign-up cross-check (AGL-3289).
 *
 * Deliberately conservative, because a false "possible" sends a salesperson
 * after the wrong person. Both names need a first and a last word; the LAST
 * words must be identical; and the first words must be the same name — equal,
 * one a clipped form of the other ("Matt"/"Matthew"), a common nickname
 * ("Bob"/"Robert"), or one typo apart. A single-word name never matches: one
 * word is too common to mean anyone in particular.
 */

/** Nicknames that are not simply a clipped form of the full name. */
const NICKNAMES: Readonly<Record<string, string>> = {
  bob: 'robert',
  bobby: 'robert',
  bill: 'william',
  billy: 'william',
  liam: 'william',
  liz: 'elizabeth',
  beth: 'elizabeth',
  betty: 'elizabeth',
  jim: 'james',
  jimmy: 'james',
  mike: 'michael',
  dave: 'david',
  kate: 'katherine',
  katie: 'katherine',
  kathy: 'katherine',
  cathy: 'catherine',
  tom: 'thomas',
  tommy: 'thomas',
  joe: 'joseph',
  joey: 'joseph',
  tony: 'anthony',
  andy: 'andrew',
  drew: 'andrew',
  rick: 'richard',
  dick: 'richard',
  ted: 'edward',
  eddie: 'edward',
  jenny: 'jennifer',
  meg: 'margaret',
  maggie: 'margaret',
  peggy: 'margaret',
  sue: 'susan',
  nate: 'nathan',
  larry: 'lawrence',
  charlie: 'charles',
  chuck: 'charles',
  hank: 'henry',
  harry: 'henry',
  jack: 'john',
  johnny: 'john',
  jon: 'john',
  abby: 'abigail',
  becky: 'rebecca',
  vicky: 'victoria',
  tori: 'victoria',
  mandy: 'amanda',
}

/** A name's words, without accents, case or punctuation; initials dropped. */
export function nameWords(name: string | null | undefined): string[] {
  if (typeof name !== 'string') return []
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 2)
}

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else {
      i++
      j++
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

function sameFirstName(a: string, b: string): boolean {
  if (a === b) return true
  if ((NICKNAMES[a] ?? a) === (NICKNAMES[b] ?? b)) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length >= 3 && long.startsWith(short)) return true
  return a.length >= 4 && b.length >= 4 && withinOneEdit(a, b)
}

/** Whether two names plausibly name one person. */
export function namesResemble(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = nameWords(a)
  const right = nameWords(b)
  if (left.length < 2 || right.length < 2) return false
  if (left[left.length - 1] !== right[right.length - 1]) return false
  return sameFirstName(left[0], right[0])
}
