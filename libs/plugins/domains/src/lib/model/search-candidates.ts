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

/*
 * FROM WHAT A PERSON TYPES TO THE NAMES WE ASK ABOUT (AGL-3962).
 *
 * A search box for people who have never bought a domain: they type their
 * business ("Joe's Plumbing & Heating"), not a hostname. So the query becomes
 * one label — letters and digits, `&` read as "and" — tried across the
 * endings we sell, plus a few `.com` variations for when the plain `.com` is
 * taken. A query that is already a hostname is asked about exactly, first.
 */

/**
 * The endings offered, in the order results are shown. Each takes the
 * standard ICANN contact alone (checked against the registrar's contact
 * schema, 2026-10-19); `.us` and its kind, which ask for a nexus or a local
 * presence, are left out because a form for them would ask people questions
 * they cannot answer. The purchase re-checks the schema, so an ending that
 * starts asking for more is refused before anyone is charged.
 */
export const OFFERED_TLDS: readonly string[] = [
  'com', 'net', 'co', 'org', 'shop', 'store', 'online', 'site', 'biz',
  'info', 'pro', 'me', 'io', 'app', 'dev', 'xyz', 'design', 'studio', 'tech',
]

/** Prefixes and suffixes tried on `.com` when the plain name is taken. */
const COM_VARIATIONS: readonly [string, string][] = [
  ['get', ''],
  ['', 'co'],
  ['the', ''],
  ['', 'hq'],
]

/** At most this many names per search: one registrar call, fast results. */
export const MAX_CANDIDATES = 24

const HOSTNAME = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** The one label a business name becomes, or '' when nothing usable is left. */
export function labelFromQuery(query: string): string {
  const text = query
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
  const label = text.replace(/[^a-z0-9]+/g, '')
  return label.length >= 2 && label.length <= 63 ? label : ''
}

/** A query that is already a hostname, normalized; '' otherwise. */
export function exactDomainFromQuery(query: string): string {
  const host = query
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#\s]/)[0]
    .replace(/\.+$/, '')
  return HOSTNAME.test(host) ? host : ''
}

export function tldOf(domain: string): string {
  const dot = domain.lastIndexOf('.')
  return dot >= 0 ? domain.slice(dot + 1) : ''
}

/** Only a registrable name we sell: one label under an offered ending. */
export function isOfferedName(domain: string): boolean {
  const labels = domain.split('.')
  return (
    labels.length === 2 &&
    HOSTNAME.test(domain) &&
    OFFERED_TLDS.includes(labels[1] ?? '')
  )
}

export function searchCandidates(query: string): string[] {
  const names: string[] = []
  const add = (name: string) => {
    if (isOfferedName(name) && !names.includes(name)) names.push(name)
  }
  const exact = exactDomainFromQuery(query)
  if (exact) add(exact)
  const label = labelFromQuery(exact ? exact.split('.')[0] ?? '' : query)
  if (!label) return names.slice(0, MAX_CANDIDATES)
  for (const tld of OFFERED_TLDS) add(`${label}.${tld}`)
  for (const [prefix, suffix] of COM_VARIATIONS) {
    const variant = `${prefix}${label}${suffix}`
    if (variant.length <= 63) add(`${variant}.com`)
  }
  return names.slice(0, MAX_CANDIDATES)
}
