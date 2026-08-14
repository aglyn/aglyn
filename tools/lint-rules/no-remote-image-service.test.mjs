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

// Standalone RuleTester harness (run: `npm run test:eslint-rules`).
//
// The first invalid case is the AGL-1671 violation verbatim, copied off
// `pos-page.component.tsx:621-626` as it shipped. It stays here now that the
// file is fixed: the point of a regression case is that it keeps failing
// after the code stops.
//
// The valid cases are the two things in this repo that look like the
// violation and are not it — the consent-gated `<Script src>` in
// `site-analytics.tsx`, and the besigner `<iframe src>` — plus the fix that
// replaced it. If the rule ever starts reporting either, it is conflating
// "third-party request" with "third party drawing our data", and the next
// person will switch it off rather than argue with it.

import { RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import rule from './no-remote-image-service.mjs'

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

/**
 * Assembled rather than written out, so this file does not itself contain the
 * host string — the rule is on by default across the repo and a fixture is
 * not an exemption worth carving.
 */
const QR_HOST = ['api', 'qrserver', 'com'].join('.')
const GRAVATAR_HOST = ['gravatar', 'com'].join('.')

const knownService = (host) => ({ messageId: 'knownService', data: { host } })
const servicePackage = (name) => ({
  messageId: 'servicePackage',
  data: { package: name },
})
const interpolated = (host, attribute = 'src') => ({
  messageId: 'interpolatedRemoteSource',
  data: { host, attribute },
})

ruleTester.run('no-remote-image-service', rule, {
  valid: [
    // THE FIX. Encoded in-process; the payment URL never becomes a request.
    `const C = ({ cardUrl }: any) => (
       <Box sx={{ display: 'flex', justifyContent: 'center' }}>
         <QRCodeSVG value={cardUrl} size={220} level="L" marginSize={4} />
       </Box>
     )`,

    // `site-analytics.tsx:248-252` — a real third-party egress, disclosed,
    // consent-gated, and not an image service. A rule that reports this is
    // answering a different question than the one it was written for.
    `const C = ({ gaMeasurementId }: any) => (
       <Script
         id="ga-src"
         strategy="afterInteractive"
         src={\`https://www.googletagmanager.com/gtag/js?id=\${gaMeasurementId}\`}
       />
     )`,

    // `besigner-iframe.component.tsx:53` — absolute, interpolated, ours.
    `const C = ({ host, screenId, versionId }: any) => (
       <iframe src={\`\${host}/besigner/\${screenId}/\${versionId}\`} />
     )`,

    // A first-party media URL with a query string, on an image. Ours to send.
    `const C = ({ token }: any) => (
       <Box
         component="img"
         src={\`https://cdn.aglyn.com/media/hero.png?token=\${token}\`}
       />
     )`,

    // Firebase Storage download URLs are our own bucket, and `?alt=media` is
    // simply how it serves a file we uploaded (`serve-media-cdn`).
    `const C = ({ token }: any) => (
       <img src={\`https://firebasestorage.googleapis.com/v0/b/b/o/hero?alt=media&token=\${token}\`} />
     )`,

    // A remote PATH on an image. The invariant is about parameters, and this
    // has none — no data of ours is being handed over to be drawn.
    `const C = ({ id }: any) => (
       <img src={\`https://images.example.com/assets/\${id}.png\`} />
     )`,

    // A query string that opens only in the FINAL quasi has nothing after it
    // to interpolate, so nothing of ours reaches the parameter.
    `const C = ({ id }: any) => (
       <img src={\`https://images.example.com/\${id}/render.png?v=2\`} />
     )`,

    // Static image sources on unknown hosts are a disclosure question, not a
    // data-egress one, and this rule is not the place to litigate them.
    `const C = () => <img src="https://images.example.com/logo.png" />`,

    // THE AGL-1683 FIX. Initials drawn from the roster fields we already
    // hold; no vendor, no hash, no request.
    `import { splitDisplayName } from '@aglyn/shared-util-tools'
     const C = ({ displayName, photoURL }: any) => (
       <Avatar src={photoURL || undefined}>{splitDisplayName(displayName).firstName.slice(0, 1)}</Avatar>
     )`,

    // Detection 2 is a name denylist, not "any import that might fetch".
    // Ordinary imports — including ones that DO make requests — are silent.
    `import axios from 'axios'
     import QRCode from 'qrcode.react'
     const gravatarish = require('gravatar-picker-ui-kit')`,
  ],

  invalid: [
    // AGL-1671, verbatim. On every POS card sale this sent goQR.me a live
    // Stripe checkout link that pays the order for whoever opens it.
    {
      code: `const C = ({ cardUrl }: any) => (
         <Box sx={{ display: 'flex', justifyContent: 'center' }}>
           <Box
             component="img"
             alt="Payment QR"
             src={\`https://${QR_HOST}/v1/create-qr-code/?size=220x220&data=\${encodeURIComponent(cardUrl)}\`}
             sx={{ width: 220, height: 220 }}
           />
         </Box>
       )`,
      errors: [knownService(QR_HOST)],
    },

    // Detection 1 does not care what shape the host arrives in. A `const`,
    // a config object and a `fetch` are the three doors the vendor comes
    // back through once the `<img>` is closed.
    {
      code: `const QR_ENDPOINT = 'https://${QR_HOST}/v1/create-qr-code/'`,
      errors: [knownService(QR_HOST)],
    },
    {
      code: `const res = await fetch(\`https://${QR_HOST}/v1/create-qr-code/?data=\${url}\`)`,
      errors: [knownService(QR_HOST)],
    },
    {
      code: `const config = { qr: { endpoint: 'https://${QR_HOST}/v1/' } }`,
      errors: [knownService(QR_HOST)],
    },

    // Other drawing services, same shape, no `<img>` needed.
    {
      code: `const chart = 'https://quickchart.io/chart?c=' + JSON.stringify(data)`,
      errors: [knownService('quickchart.io')],
    },
    {
      code: `const avatar = \`https://ui-avatars.com/api/?name=\${encodeURIComponent(member.email)}\``,
      errors: [knownService('ui-avatars.com')],
    },
    {
      code: `const proxied = \`https://images.weserv.nl/?url=\${encodeURIComponent(src)}\``,
      errors: [knownService('images.weserv.nl')],
    },

    // DETECTION 2 — AGL-1683, the shape detection 1 cannot see. This is
    // `gravatar-url-from-email.ts` as it shipped: the host is assembled
    // inside the dependency, so the only visible evidence is the import.
    {
      code: `export {
           Options as GravatarUrlOptions,
           profile_url as gravatarProfileUrlFromEmail,
           url as gravatarUrlFromEmail,
         } from 'gravatar'`,
      errors: [servicePackage('gravatar')],
    },
    {
      code: `import { url } from 'gravatar'
         const src = url(member.email, { size: '64', default: '404' })`,
      errors: [servicePackage('gravatar')],
    },
    {
      code: `const { url } = require('gravatar/lib/gravatar')`,
      errors: [servicePackage('gravatar')],
    },
    {
      code: `const load = () => import('gravatar-url')`,
      errors: [servicePackage('gravatar-url')],
    },
    {
      code: `export * from 'gravatar'`,
      errors: [servicePackage('gravatar')],
    },

    // …and once the package is gone, the other door back in is typing the
    // host. Every subdomain the package could emit is one entry, so a `4.`
    // nobody listed is covered too.
    {
      code: `const src = 'https://secure.${GRAVATAR_HOST}/avatar/' + md5(email)`,
      errors: [knownService(GRAVATAR_HOST)],
    },
    {
      code: `const src = \`https://s.${GRAVATAR_HOST}/avatar/\${hash}?d=404\``,
      errors: [knownService(GRAVATAR_HOST)],
    },

    // DETECTION 3 — the case that matters for the vendor nobody has denied
    // yet. Same shipped shape, unknown host, still our data in their query
    // string on every render.
    {
      code: `const C = ({ cardUrl }: any) => (
         <Box
           component="img"
           src={\`https://qr.example.com/create?data=\${encodeURIComponent(cardUrl)}\`}
         />
       )`,
      errors: [interpolated('qr.example.com')],
    },
    {
      code: `const C = ({ email }: any) => (
         <img src={\`https://avatars.example.com/render.png?email=\${email}\`} />
       )`,
      errors: [interpolated('avatars.example.com')],
    },
    // Name-based detection, so the MUI `component` prop is not the only way in.
    {
      code: `const C = ({ id }: any) => (
         <ProductImage srcSet={\`https://thumbs.example.com/t?id=\${id}\`} />
       )`,
      errors: [interpolated('thumbs.example.com', 'srcSet')],
    },
    {
      code: `const C = ({ email }: any) => (
         <MemberAvatar src={\`https://avatars.example.com/a?e=\${email}\`} />
       )`,
      errors: [interpolated('avatars.example.com')],
    },
  ],
})

console.log('no-remote-image-service: all cases passed')
