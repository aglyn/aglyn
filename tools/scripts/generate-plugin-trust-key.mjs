/**
 * Generates the platform plugin-trust Ed25519 key pair (AGL-420).
 *
 *   node tools/scripts/generate-plugin-trust-key.mjs
 *
 * Prints the env values the trust chain consumes:
 * - PLUGIN_TRUST_PRIVATE_KEY — base64 PKCS8 DER private key. Console app
 *   ONLY (the staff sign-plugin route). Treat like any signing secret.
 * - PLUGIN_TRUST_PUBLIC_KEY / NEXT_PUBLIC_PLUGIN_TRUST_PUBLIC_KEY —
 *   base64 RAW 32-byte public key (WebCrypto `importKey('raw', …)`
 *   format). Safe to publish; deploy to every runtime that loads realm
 *   bundles (tenant + console, client and server).
 *
 * Rotating: generate a new pair, re-sign every granted version through
 * the sign-plugin route, then swap the public key everywhere.
 */
import { generateKeyPairSync } from 'node:crypto'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')

const privateDer = privateKey.export({ format: 'der', type: 'pkcs8' })
// WebCrypto wants the raw 32-byte key; node exposes it as the JWK `x`
// claim in base64url — convert to standard base64.
const jwk = publicKey.export({ format: 'jwk' })
const rawPublic = Buffer.from(String(jwk.x), 'base64url').toString('base64')

console.log(`PLUGIN_TRUST_PRIVATE_KEY=${privateDer.toString('base64')}`)
console.log(`PLUGIN_TRUST_PUBLIC_KEY=${rawPublic}`)
console.log(`NEXT_PUBLIC_PLUGIN_TRUST_PUBLIC_KEY=${rawPublic}`)
