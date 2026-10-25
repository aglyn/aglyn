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
 * DNS RECORDS FOR A NAME ON OUR NAMESERVERS (AGL-4040), as the Domains page
 * edits them: one record at a time, through ordinary form fields — a type,
 * then the name, the value and the fields that type takes. No zone file and
 * nothing a person has to write in a record syntax: a CAA record is a tag and
 * a value, an SRV record its four numbers and a target, and this module
 * composes what the registrar stores.
 *
 * Pure, so the form and the route validate with the same rules.
 */

/** The record types the editor offers. */
export const DNS_EDITABLE_TYPES = ['A', 'AAAA', 'ALIAS', 'CAA', 'CNAME', 'MX', 'SRV', 'TXT'] as const
export type DnsEditableType = (typeof DNS_EDITABLE_TYPES)[number]

/** What each type is for, in a sentence the type picker shows. */
export const DNS_TYPE_HELP: Record<DnsEditableType, string> = {
  A: 'Points a name at an IPv4 address.',
  AAAA: 'Points a name at an IPv6 address.',
  ALIAS: 'Points a name at another host name, including the bare domain.',
  CAA: 'Says which certificate authorities may issue certificates for the domain.',
  CNAME: 'Makes a subdomain another name for a host name.',
  MX: 'Says which mail server receives email for the domain.',
  SRV: 'Says where a service, such as calling or chat, runs.',
  TXT: 'Holds text, usually a verification code from another service.',
}

/** The CAA tags the editor offers, by what they mean. */
export const CAA_TAGS = ['issue', 'issuewild', 'iodef'] as const
export type CaaTag = (typeof CAA_TAGS)[number]

/** TTL choices, in seconds; `null` leaves the registrar's default. */
export const DNS_TTL_OPTIONS: readonly { seconds: number | null; label: string }[] = [
  { seconds: null, label: 'Automatic' },
  { seconds: 60, label: '1 minute' },
  { seconds: 300, label: '5 minutes' },
  { seconds: 3600, label: '1 hour' },
  { seconds: 86400, label: '1 day' },
]

/** One record as the form holds it. Every field a string or number the form draws. */
export interface DnsRecordInput {
  type: DnsEditableType
  /** The part before the domain: '' for the domain itself, `www`, `_dmarc`. */
  name: string
  /** A, AAAA, ALIAS, CNAME, MX, TXT; the CAA value for CAA. */
  value: string
  ttl?: number | null
  /** MX, and SRV. */
  priority?: number | null
  /** SRV only. */
  weight?: number | null
  port?: number | null
  /** CAA only. */
  caaTag?: CaaTag | null
}

/** A record as the registrar stores it, which the driver sends. */
export interface RegistrarDnsRecord {
  type: DnsEditableType
  name: string
  value?: string
  ttl?: number
  mxPriority?: number
  srv?: { priority: number; weight: number; port: number; target: string }
}

/** A record as the page lists it. */
export interface DnsRecordView {
  id: string
  type: string
  name: string
  value: string
  ttl: number | null
  priority: number | null
  /**
   * Whether Aglyn keeps this record for the site the name serves, or the
   * registrar made it for the name's own DNS. Shown, never edited.
   */
  managed: boolean
  /** Whether the editor can change this record at all (a type it offers). */
  editable: boolean
}

const LABEL = /^(?:\*|_?[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?)$/
const HOST =
  /^(?=.{1,253}\.?$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]\.?$/
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

function isIpv6(value: string): boolean {
  if (!/^[0-9a-f:.]+$/i.test(value) || !value.includes(':')) return false
  const doubles = value.split('::').length - 1
  if (doubles > 1) return false
  const groups = value.split(':').filter((group) => group !== '')
  if (groups.some((group) => group.length > 4 && !IPV4.test(group))) return false
  return doubles === 1 ? groups.length < 8 : groups.length === 8
}

const inRange = (value: unknown, min: number, max: number): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

/** `WWW.` → `www`; `@` and the domain itself → ''. */
export function normalizeRecordName(name: string, domain: string): string {
  let next = String(name ?? '').trim().toLowerCase().replace(/\.$/, '')
  const apex = domain.trim().toLowerCase()
  if (next === '@' || next === apex) return ''
  if (apex && next.endsWith(`.${apex}`)) next = next.slice(0, -(apex.length + 1))
  return next
}

/**
 * The fields of a record that are missing or malformed, by name. An empty
 * list is a record the registrar can take.
 */
export function invalidDnsRecordFields(input: Partial<DnsRecordInput>, domain: string): string[] {
  const bad: string[] = []
  const type = input.type
  if (!type || !DNS_EDITABLE_TYPES.includes(type)) return ['type']
  const name = normalizeRecordName(input.name ?? '', domain)
  if (name && (name.length > 253 || !name.split('.').every((label) => LABEL.test(label)))) {
    bad.push('name')
  }
  if (type === 'CNAME' && !name) bad.push('name')
  const value = String(input.value ?? '').trim()
  switch (type) {
    case 'A':
      if (!IPV4.test(value)) bad.push('value')
      break
    case 'AAAA':
      if (!isIpv6(value)) bad.push('value')
      break
    case 'ALIAS':
    case 'CNAME':
    case 'MX':
    case 'SRV':
      if (!HOST.test(value.toLowerCase())) bad.push('value')
      break
    case 'TXT':
      if (!value || value.length > 4096) bad.push('value')
      break
    case 'CAA':
      if (!value || value.length > 255 || /["\s]/.test(value.replace(/^mailto:/, ''))) bad.push('value')
      if (!input.caaTag || !CAA_TAGS.includes(input.caaTag)) bad.push('caaTag')
      break
  }
  if ((type === 'MX' || type === 'SRV') && !inRange(input.priority, 0, 65535)) bad.push('priority')
  if (type === 'SRV') {
    if (!inRange(input.weight, 0, 65535)) bad.push('weight')
    if (!inRange(input.port, 0, 65535)) bad.push('port')
  }
  if (input.ttl !== undefined && input.ttl !== null && !inRange(input.ttl, 60, 2_147_483_647)) {
    bad.push('ttl')
  }
  return [...new Set(bad)]
}

/** The form's record as the registrar stores it. Validate first. */
export function toRegistrarRecord(input: DnsRecordInput, domain: string): RegistrarDnsRecord {
  const name = normalizeRecordName(input.name, domain)
  const value = String(input.value ?? '').trim()
  const ttl = typeof input.ttl === 'number' ? { ttl: input.ttl } : {}
  switch (input.type) {
    case 'MX':
      return { type: 'MX', name, value: value.toLowerCase(), mxPriority: Number(input.priority), ...ttl }
    case 'SRV':
      return {
        type: 'SRV',
        name,
        srv: {
          priority: Number(input.priority),
          weight: Number(input.weight),
          port: Number(input.port),
          target: value.toLowerCase(),
        },
        ...ttl,
      }
    case 'CAA':
      return { type: 'CAA', name, value: `0 ${input.caaTag} "${value}"`, ...ttl }
    case 'ALIAS':
    case 'CNAME':
      return { type: input.type, name, value: value.toLowerCase(), ...ttl }
    default:
      return { type: input.type, name, value, ...ttl }
  }
}

/** A listed record back into the form's fields, for an edit. */
export function toRecordInput(record: DnsRecordView): DnsRecordInput | null {
  if (!DNS_EDITABLE_TYPES.includes(record.type as DnsEditableType)) return null
  const type = record.type as DnsEditableType
  const base = { type, name: record.name, ttl: record.ttl }
  if (type === 'CAA') {
    const match = /^(\d+)\s+(issue|issuewild|iodef)\s+"?([^"]*)"?$/i.exec(record.value.trim())
    return {
      ...base,
      caaTag: (match?.[2]?.toLowerCase() as CaaTag | undefined) ?? 'issue',
      value: match?.[3] ?? record.value,
    }
  }
  if (type === 'SRV') {
    // Listed as "weight port target", or with the priority in front.
    const parts = record.value.trim().split(/\s+/)
    const [priority, weight, port, target] =
      parts.length >= 4 ? parts : [String(record.priority ?? ''), ...parts]
    return {
      ...base,
      priority: Number(priority),
      weight: Number(weight),
      port: Number(port),
      value: target ?? '',
    }
  }
  if (type === 'MX') return { ...base, priority: record.priority, value: record.value }
  return { ...base, value: record.value }
}

/** Address records at the domain or `www`: what serves a connected site. */
const SITE_ADDRESS_TYPES = new Set(['A', 'AAAA', 'ALIAS', 'CNAME'])

/**
 * Whether a record is one Aglyn keeps for the name and must not be changed
 * from the editor: a record the registrar created for the name's own DNS
 * (`creator: system`), and — while the name serves a site — the address
 * records at the domain itself and at `www`, which are how visitors reach it,
 * and every CAA record, which says who may issue its certificate.
 */
export function isAglynManagedRecord(
  record: { type: string; name: string; creator?: string | null },
  siteConnected: boolean,
): boolean {
  if (String(record.creator ?? '').toLowerCase() === 'system') return true
  if (!siteConnected) return false
  // A CAA record decides which authority may issue the site's certificate;
  // one that left ours out would take the site off HTTPS at its renewal.
  if (record.type === 'CAA') return true
  return SITE_ADDRESS_TYPES.has(record.type) && (record.name === '' || record.name === 'www')
}

/**
 * Whether a new or changed record would take the address a connected site
 * serves from — an address record at the domain itself or at `www` — or
 * decide who may issue its certificate (CAA).
 */
export function wouldReplaceSiteAddress(record: RegistrarDnsRecord, siteConnected: boolean): boolean {
  if (!siteConnected) return false
  // A CAA record could leave out the authority the site's certificate needs.
  if (record.type === 'CAA') return true
  return SITE_ADDRESS_TYPES.has(record.type) && (record.name === '' || record.name === 'www')
}

/** `''` → the domain itself, as the list shows a record's name. */
export function recordHostLabel(name: string, domain: string): string {
  return name ? `${name}.${domain}` : domain
}
