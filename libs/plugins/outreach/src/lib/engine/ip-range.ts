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
 * Whether an address falls inside a CIDR block, for IPv4 and IPv6 alike
 * (AGL-3488). Small on purpose: the open judgement asks only "is this one of
 * a mail provider's blocks?", over a handful of hard-coded ranges, and an
 * address or a block it cannot read is simply not in it.
 */

/** An address as a number and its width in bits, or `null` when it is not one. */
function parseAddress(raw: string): { value: bigint; bits: 32 | 128 } | null {
  const text = raw.trim().toLowerCase()
  if (!text) return null
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) {
    const parts = text.split('.').map(Number)
    if (parts.some((part) => part > 255)) return null
    return { value: parts.reduce((total, part) => (total << 8n) | BigInt(part), 0n), bits: 32 }
  }
  if (!text.includes(':')) return null
  // An IPv4-mapped IPv6 address (`::ffff:1.2.3.4`) is the IPv4 address.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text)
  if (mapped) return parseAddress(mapped[1])
  const halves = text.split('::')
  if (halves.length > 2) return null
  const groups = (half: string) => (half ? half.split(':') : [])
  const head = groups(halves[0])
  const tail = halves.length === 2 ? groups(halves[1]) : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  if (all.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null
  return { value: all.reduce((total, group) => (total << 16n) | BigInt(parseInt(group, 16)), 0n), bits: 128 }
}

/** A parsed block, so a list of them is read once rather than per address. */
export interface OutreachIpBlock {
  network: bigint
  prefix: number
  bits: 32 | 128
}

/** A block from its `address/prefix` text; throws on one that is not, since the lists are hard-coded. */
export function outreachIpBlock(cidr: string): OutreachIpBlock {
  const [address, prefixText] = cidr.split('/')
  const parsed = parseAddress(address ?? '')
  const prefix = Number(prefixText)
  if (!parsed || !Number.isInteger(prefix) || prefix < 0 || prefix > parsed.bits) {
    throw new Error(`Not a CIDR block: ${cidr}`)
  }
  const shift = BigInt(parsed.bits - prefix)
  return { network: (parsed.value >> shift) << shift, prefix, bits: parsed.bits }
}

/** Whether `address` is inside any of `blocks`; `false` for an address that is not one. */
export function outreachIpInBlocks(address: string | null | undefined, blocks: readonly OutreachIpBlock[]): boolean {
  const parsed = parseAddress(String(address ?? ''))
  if (!parsed) return false
  return blocks.some((block) => {
    if (block.bits !== parsed.bits) return false
    const shift = BigInt(block.bits - block.prefix)
    return (parsed.value >> shift) << shift === block.network
  })
}
