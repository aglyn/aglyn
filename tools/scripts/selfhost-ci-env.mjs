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

// Fills `.env.selfhost.example` with an imaginary operator's values so CI can
// build the self-host images the way a self-hoster does (AGL-2433).
//
//   node tools/scripts/selfhost-ci-env.mjs [outfile]   # default .env.selfhost
//
// Every value here is a placeholder and authenticates nothing — there is no
// Firebase project, no Stripe account and no mailbox behind any of them. That
// is deliberate: the images must build for an operator who has none of Aglyn's
// configuration, so inventing one is exactly the test. Never point this at
// real credentials; a build log is not a secret store.
//
// It starts from the TEMPLATE rather than from a list, so a variable added to
// `.env.selfhost.example` is exercised without editing this file.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const template = join(repoRoot, '.env.selfhost.example')
const outFile = join(repoRoot, process.argv[2] ?? '.env.selfhost')

/**
 * A throwaway RSA key. The Admin SDK parses `FIREBASE_PRIVATE_KEY` when it
 * initialises, and a malformed one fails the build for a reason that has
 * nothing to do with what is being tested.
 */
const privateKey = execFileSync(
  'openssl',
  ['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048'],
  {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  },
)
  .trim()
  .replace(/\n/g, '\\n')

const VALUES = {
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'operator-ci',
  NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY: 'AIzaSyPLACEHOLDERnotarealkey0123456789',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'operator-ci.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_DATABASE_URL: 'https://operator-ci.firebaseio.com',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'operator-ci.appspot.com',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '123456789012',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:123456789012:web:0123456789abcdef',
  FIREBASE_PROJECT_ID: 'operator-ci',
  FIREBASE_PRIVATE_KEY_ID: '0123456789abcdef0123456789abcdef01234567',
  FIREBASE_CLIENT_EMAIL: 'ci@operator-ci.iam.gserviceaccount.com',
  FIREBASE_CLIENT_ID: '109876543210987654321',
  FIREBASE_CLIENT_X509_CERT_URL:
    'https://www.googleapis.com/robot/v1/metadata/x509/ci%40operator-ci.iam.gserviceaccount.com',
  FIREBASE_DATABASE_URL: 'https://operator-ci.firebaseio.com',
  FIREBASE_STORAGE_BUCKET: 'operator-ci.appspot.com',
  TOKEN_SIGNING_SECRET: 'a1'.repeat(32),
  MEMBER_SESSION_SECRET: 'b2'.repeat(32),
  NEXT_PUBLIC_OPERATOR_NAME: 'Operator CI',
  NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL: 'support@example.com',
  NEXT_PUBLIC_PLATFORM_BRAND_NAME: 'Operator CI',
}

const filled = readFileSync(template, 'utf8')
  .split('\n')
  .map((line) => {
    const name = line.includes('=') ? line.slice(0, line.indexOf('=')) : null
    if (name === 'FIREBASE_PRIVATE_KEY') {
      return `FIREBASE_PRIVATE_KEY="${privateKey}"`
    }
    return name && name in VALUES ? `${name}=${VALUES[name]}` : line
  })
  .join('\n')

writeFileSync(outFile, filled.endsWith('\n') ? filled : `${filled}\n`)

/**
 * The apex the tenant middleware matches an incoming `Host` against. It lives
 * in the template (AGL-2424); if it stops doing so, say that here rather than
 * let the image build and the serving smoke fail as something else.
 */
if (!/^AGLYN_TENANT_HOST_CNAME=\S/m.test(filled)) {
  console.error(
    '.env.selfhost.example has no AGLYN_TENANT_HOST_CNAME line with a value. ' +
      'The tenant runtime has nothing to match an incoming Host against, so every ' +
      'visitor to every published site falls through to the console redirect (AGL-2424).',
  )
  process.exit(1)
}

const publicCount = (filled.match(/^NEXT_PUBLIC_\w+=/gm) ?? []).length
console.log(
  `wrote ${outFile} from .env.selfhost.example (${publicCount} NEXT_PUBLIC_* values, all placeholders)`,
)
