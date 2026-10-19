#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Domain Connect signing key (AGL-3963): makes the RSA pair one-click
 * DNS signs its apply links with, and the DNS records that publish its
 * public half.
 *
 *   node tools/scripts/domain-connect-key.mjs                 # new pair, dry run
 *   node tools/scripts/domain-connect-key.mjs --out key.pem   # new pair, PEM to a file (0600)
 *   node tools/scripts/domain-connect-key.mjs --from key.pem  # records for a key you hold
 *   node tools/scripts/domain-connect-key.mjs --from key.pem --publish
 *
 * A DNS provider checks each signed link against the public key at
 * `<key host>.<syncPubKeyDomain>`, which both templates in
 * `tools/domain-connect/` name. The spec's form for that key is one or more
 * TXT records `p=<part>,a=RS256,d=<base64 chunk>` at the same name: `d`
 * across the parts, in `p` order, is the base64 DER SubjectPublicKeyInfo.
 * A 2048-bit key's is ~392 characters, longer than one 255-byte DNS string,
 * so it is split into numbered parts.
 *
 * What it prints:
 *   (a) the private key as a PEM, and the same on one line with `\n`, the
 *       form `DOMAIN_CONNECT_PRIVATE_KEY` takes in a variable store;
 *   (b) the TXT records to publish.
 *
 * `--publish` writes (b) into the zone through the Vercel DNS API
 * (`POST /v2/domains/<zone>/records`, `VERCEL_TOKEN` and optional
 * `VERCEL_TEAM_ID`, as `sending-zone-provider.ts` does). Without it nothing
 * leaves this machine. `--publish` takes `--from`, never a fresh pair: the
 * key that signs and the key that is published must be the same one, so you
 * set the variable first and publish what it holds.
 *
 * Flags: `--zone <domain>` (default `DOMAIN_CONNECT_PUB_KEY_DOMAIN`, else
 * the platform's), `--key-host <label>` (default `DOMAIN_CONNECT_KEY_HOST`,
 * else `_dcpubkeyv1`; a rotation uses a new label, e.g. `_dcpubkeyv2`).
 *
 * Operator tooling: ships in no app, and runs only by hand.
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

/** The longest `d=` chunk per TXT string, with room for the `p=…,a=RS256,d=` prefix. */
const CHUNK = 200

function flag(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return null
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) {
    console.error(`${name} needs a value`)
    process.exit(2)
  }
  return value
}

const has = (name) => process.argv.includes(name)

const zone = (flag('--zone') ?? process.env.DOMAIN_CONNECT_PUB_KEY_DOMAIN ?? 'aglyn.com').trim().toLowerCase()
const keyHost = (flag('--key-host') ?? process.env.DOMAIN_CONNECT_KEY_HOST ?? '_dcpubkeyv1').trim()
const from = flag('--from')
const out = flag('--out')
const publish = has('--publish')

if (publish && !from) {
  console.error('--publish publishes the key you already set: pass --from <pem>.')
  process.exit(2)
}

let privateKey
if (from) {
  privateKey = createPrivateKey(readFileSync(from, 'utf8').replace(/\\n/g, '\n'))
} else {
  privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
}
if (privateKey.asymmetricKeyType !== 'rsa') {
  console.error('Domain Connect signs with RSA (RS256); that key is not RSA.')
  process.exit(2)
}
const publicKey = createPublicKey(privateKey)

// A signature the public half cannot verify is a key a provider will refuse.
const probe = Buffer.from('domain=example.com&state=probe', 'utf8')
if (!verify('sha256', probe, publicKey, sign('sha256', probe, privateKey))) {
  console.error('The key pair does not verify its own signature.')
  process.exit(1)
}

const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const der = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
const chunks = []
for (let offset = 0; offset < der.length; offset += CHUNK) chunks.push(der.slice(offset, offset + CHUNK))
const records = chunks.map((chunk, index) => `p=${index + 1},a=RS256,d=${chunk}`)
const name = `${keyHost}.${zone}`

if (!from) {
  if (out) {
    writeFileSync(out, pem, { mode: 0o600 })
    console.log(`(a) Private key written to ${out} (mode 0600).`)
  } else {
    console.log('(a) Private key (PEM). Keep it secret; it is shown once:\n')
    console.log(pem)
  }
  console.log('    As DOMAIN_CONNECT_PRIVATE_KEY, on one line:\n')
  console.log(`    ${pem.trim().replace(/\n/g, '\\n')}\n`)
}

console.log(`(b) ${records.length} TXT record(s) at ${name}:\n`)
for (const record of records) console.log(`    ${name}  TXT  "${record}"`)
console.log('')

if (!publish) {
  console.log('Dry run: nothing was written. Pass --from <pem> --publish to write (b) to the zone.')
  process.exit(0)
}

const token = String(process.env.VERCEL_TOKEN ?? '').trim()
if (!token) {
  console.error('VERCEL_TOKEN is not set.')
  process.exit(2)
}
const teamId = String(process.env.VERCEL_TEAM_ID ?? '').trim()
const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''
let failed = 0
for (const record of records) {
  const response = await fetch(
    `https://api.vercel.com/v2/domains/${encodeURIComponent(zone)}/records${query}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: keyHost, type: 'TXT', value: record, ttl: 3600 }),
    },
  )
  if (response.ok) {
    console.log(`  published ${record.slice(0, 24)}…`)
    continue
  }
  const detail = await response.text().catch(() => '')
  if (response.status === 409 || detail.includes('record_already_exists')) {
    console.log(`  already there ${record.slice(0, 24)}…`)
    continue
  }
  failed += 1
  console.error(`  FAILED (${response.status}) ${record.slice(0, 24)}… ${detail.slice(0, 200)}`)
}
process.exit(failed ? 1 : 0)
