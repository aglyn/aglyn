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
 * ESLint rule: a third-party service asked to DRAW something out of data we
 * put in its URL — a QR code, a barcode, a chart, an avatar, a proxied image.
 *
 * The shape is always the same and always looks harmless, because the thing
 * that leaves is "just a picture request". What actually leaves is the
 * argument, in a GET query string, to a host we have no contract with:
 *
 * ```tsx
 * <Box component="img"
 *   src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${
 *     encodeURIComponent(cardUrl)}`} />
 * ```
 *
 * That is `pos-page.component.tsx:624` as it shipped (AGL-1671). `cardUrl` is
 * a LIVE Stripe payment URL for a real customer's order, and the QR exists
 * precisely because anyone holding that link can pay with it. So every POS
 * card sale handed goQR.me a working checkout link, plus the merchant's IP
 * and a `Referer` naming the console and the org — with no DPA, no vendor
 * review, no register entry, and no gate of any kind to turn off. Rendering
 * the QR in-process removed the vendor instead of disclosing it, and made the
 * register work on a dead network, which the remote version never did.
 *
 * The generalisation is the repo's standing rule, which predates this
 * instance: personal or sensitive data never goes in a URL parameter. An
 * image service is where that rule gets broken by people who are not thinking
 * about data at all — they are thinking about pixels.
 *
 * ## What counts as a violation
 *
 * Two detections, deliberately different in kind:
 *
 *   1. **A known drawing host, anywhere in a string.** `REMOTE_IMAGE_SERVICES`
 *      names the endpoints whose entire product is "send us your data, get a
 *      picture" — QR, barcode, chart and avatar generators, and image
 *      proxies. Any of them appearing in a string literal or a template quasi
 *      is reported wherever it appears, in whatever shape: a `src`, a `const`,
 *      a config object, a fetch. This is the half that stops `api.qrserver.com`
 *      coming back through a different door.
 *
 *   2. **A package whose product is a URL to one of those hosts.**
 *      `REMOTE_IMAGE_SERVICE_PACKAGES` names dependencies that exist only to
 *      build such a URL, reported at the `import`/`require`. This is the half
 *      detection 1 structurally cannot do: `gravatarUrlFromEmail(email)`
 *      assembles `gravatar.com/avatar/<md5(email)>` INSIDE the dependency, so
 *      no host literal exists in our source and no amount of string scanning
 *      will ever see it. That shipped for months across every console member
 *      row (AGL-1683) — an MD5 of each colleague's email, sent to Automattic
 *      with the viewer's IP. An import is the one place the shape is visible,
 *      and it is unambiguous: nothing imports `gravatar` for another reason.
 *
 *   3. **An image source built by interpolating into a remote query string.**
 *      A `src` / `srcSet` on an image-ish element — `<img>`, anything whose
 *      name ends in `Image`/`Avatar`, or MUI's `component="img"` — whose value
 *      is a template literal that starts at an absolute `http(s)://` host and
 *      whose STATIC text opens a query string. That is the precise shipped
 *      shape, and it catches a host nobody has thought to deny yet.
 *
 * Requiring the `?` is what keeps detection 3 honest. `src={`${cdn}/${id}.png`}`
 * is a path on a CDN and is nobody's business but ours; the invariant being
 * guarded is about parameters, so the rule asks for one. `FIRST_PARTY_HOSTS`
 * is the other half of that: an `?alt=media&token=…` on our own Firebase
 * bucket is how our media is served, and "serve it from a first-party route"
 * is the remedy this rule recommends — a rule that then reports the remedy
 * would be worse than no rule.
 *
 * ## Honest limits
 *
 * These are false NEGATIVES, chosen so the rule never fires on correct code:
 *
 *   - **A remote URL assembled away from the element.** `const src = base + '?d=' + v`
 *     built in a helper and passed down is invisible to detection 3, which
 *     reads one template literal at one attribute. Detection 1 still catches
 *     it if the host is a known one.
 *   - **`new URL()` / `URLSearchParams`.** Not modelled. Same fallback.
 *   - **Non-image sinks.** `<Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`}>`
 *     in `site-analytics.tsx` is a real, disclosed, consent-gated egress and
 *     is NOT an instance — a tag manager is not an image service, and the
 *     rule must not conflate "third-party request" with "third party drawing
 *     our data". Detection 3 only looks at image-ish elements for exactly
 *     this reason.
 *   - **A package NOT on the list.** Detection 2 is a denylist of one shape,
 *     not an analysis: a new dependency that builds a remote avatar URL is
 *     invisible until someone adds its name. That is the accepted cost of a
 *     rule with no false positives — the alternative is flagging every import
 *     that might touch a URL, which nobody would keep enabled.
 *
 * When this rule was written (AGL-1671) the gravatar case was left out on the
 * grounds that "a denylist entry would be theatre", which was true of a HOST
 * entry and only of a host entry: the source contained no such string, so it
 * would have reported nothing. Fixing AGL-1683 changed what a denylist is for
 * here. The egress is gone and the dependency is uninstalled, so both entries
 * now guard REINTRODUCTION, which arrives by exactly two doors — `npm i
 * gravatar` (detection 2) or somebody typing the host by hand (detection 1) —
 * and both are shut. Neither reports anything in the tree today.
 *
 * ## Provenance
 *
 * Run against `pos-page.component.tsx` as it stood before this fix, the rule
 * reports that line — detection 1, on the host; detection 2 stands down
 * because a known host is already fully described by the first message, and
 * two reports on one line teach nothing the first did not. Strip the host to
 * an unknown one and detection 2 takes over, which is the case that matters
 * for the next vendor. Run across the whole tree after the fix it reports
 * nothing: the only other `src={`…`}` template literals in the repo are a
 * `<Script>` and an `<iframe>`, neither of which is an image. All of that is
 * asserted in `no-remote-image-service.test.mjs`.
 */

/**
 * Hosts whose product is "hand us your data in a URL, get an image back".
 * Only endpoints that DRAW something from the request belong here — a CDN
 * that serves a file we uploaded is not the same thing and must not be added.
 */
const REMOTE_IMAGE_SERVICES = [
  // QR — the AGL-1671 instance and its obvious substitutes.
  'api.qrserver.com',
  'goqr.me',
  'qrickit.com',
  'qrtag.net',
  'api.qrcode-monkey.com',
  'qrcode.tec-it.com',
  // Barcode.
  'barcodeapi.org',
  'barcode.tec-it.com',
  // Charts — the same shape with the dataset in the query string.
  'chart.googleapis.com',
  'chart.apis.google.com',
  'quickchart.io',
  'image-charts.com',
  // Avatars generated from an identifier we send.
  'api.dicebear.com',
  'ui-avatars.com',
  'api.multiavatar.com',
  // Gravatar (AGL-1683) — the identifier is an MD5 of an email address, and
  // that is a lookup key, not an anonymisation. Covers every subdomain the
  // package emitted: `www.`, `s.`, `secure.`, `0.`…`3.`.
  'gravatar.com',
  // Image proxies — everything they fetch, they also see.
  'images.weserv.nl',
  'wsrv.nl',
]

const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Host match on domain-label boundaries, so `api.qrserver.com` is found in
 * `https://api.qrserver.com/v1/…` but `notqrserver.com.example.org` is not.
 *
 * A leading `.` counts as a boundary, so an entry also covers its subdomains:
 * `gravatar.com` has to catch `secure.gravatar.com`, `s.gravatar.com` and
 * `0.`…`3.gravatar.com`, which are all the same vendor and were all reachable
 * from the package's own options (AGL-1683). Listing them one by one would
 * mean the next `4.` slips through. What the boundary still refuses is a
 * different registrable domain that merely ENDS in one of these labels —
 * `notqrserver.com` is preceded by a letter, not a dot, and does not match.
 */
const SERVICE_PATTERNS = REMOTE_IMAGE_SERVICES.map((host) => ({
  host,
  pattern: new RegExp(
    `(^|[^A-Za-z0-9-])${escapeForRegExp(host)}(?![A-Za-z0-9-])`,
    'i',
  ),
}))

/**
 * Dependencies whose entire product is a URL to one of the hosts above.
 *
 * The bar for an entry is that the package has NO use except building that
 * request — `gravatar` exports `url()`/`profile_url()` and nothing else, so
 * an import of it IS the egress. A package that merely can fetch an image
 * (axios, next/image) obviously does not belong here.
 */
const REMOTE_IMAGE_SERVICE_PACKAGES = ['gravatar', 'gravatar-url']

/** `gravatar` and `gravatar/lib/…` both name the same dependency. */
function namedServicePackage(request) {
  if (typeof request !== 'string') return null
  return (
    REMOTE_IMAGE_SERVICE_PACKAGES.find(
      (name) => request === name || request.startsWith(`${name}/`),
    ) ?? null
  )
}

/**
 * Hosts that are ours, or are storage we own and pay for. An image URL here
 * with a query string is not an egress — `?alt=media&token=…` is how Firebase
 * Storage serves a file we uploaded, and asking a first-party route to render
 * something IS the fix this rule pushes people towards, so it must not then
 * report the fix. Matched on a domain-label boundary, so `aglyn.com` covers
 * `cdn.aglyn.com` and does NOT cover `aglyn.com.evil.example`.
 */
const FIRST_PARTY_HOSTS = [
  'aglyn.com',
  'aglyn.app',
  'aglyn.dev',
  'localhost',
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
]

/** Attributes that make the browser go and fetch the thing. */
const SOURCE_ATTRIBUTES = new Set(['src', 'srcSet', 'srcset'])

/** `<Box.Image>` → `Image`; `<img>` → `img`. */
function elementName(node) {
  let name = node.name
  while (name?.type === 'JSXMemberExpression') name = name.property
  if (name?.type === 'JSXNamespacedName') name = name.name
  return name?.type === 'JSXIdentifier' ? name.name : null
}

/**
 * An element that renders an `<img>`. Three ways to be one, because MUI's
 * `component="img"` is how the shipped instance spelled it and a name test
 * alone would have missed it entirely.
 */
function isImageElement(node) {
  const name = elementName(node)
  if (name) {
    const lower = name.toLowerCase()
    if (lower === 'img' || lower.endsWith('image') || lower.endsWith('avatar')) {
      return true
    }
  }
  return node.attributes.some((attribute) => {
    if (attribute.type !== 'JSXAttribute') return false
    if (attribute.name?.name !== 'component') return false
    const value = attribute.value
    if (value?.type === 'Literal') return value.value === 'img'
    if (
      value?.type === 'JSXExpressionContainer' &&
      value.expression?.type === 'Literal'
    ) {
      return value.expression.value === 'img'
    }
    return false
  })
}

/** The absolute host a template literal starts at, or `null`. */
function leadingAbsoluteHost(template) {
  const first = template.quasis[0]?.value?.cooked
  if (!first) return null
  const match = /^https?:\/\/([A-Za-z0-9.-]+)/.exec(first)
  return match ? match[1] : null
}

/**
 * Does the template's own static text open a query string? Only text BEFORE
 * the final quasi can be followed by an interpolation, so a trailing `?` with
 * nothing after it is not a parameter and does not count.
 */
function staticTextOpensQuery(template) {
  if (template.expressions.length === 0) return false
  return template.quasis
    .slice(0, -1)
    .some((quasi) => (quasi.value?.cooked ?? '').includes('?'))
}

/** Is this host ours (or storage we own)? Exact, or a subdomain of one. */
function isFirstPartyHost(host) {
  const lower = host.toLowerCase()
  return FIRST_PARTY_HOSTS.some(
    (own) => lower === own || lower.endsWith(`.${own}`),
  )
}

/** The first known service host named by a piece of text, or `null`. */
function namedService(text) {
  if (!text) return null
  for (const { host, pattern } of SERVICE_PATTERNS) {
    if (pattern.test(text)) return host
  }
  return null
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'never build a request to a third-party image, QR, barcode, chart or ' +
        'avatar service — the data we ask it to draw leaves in a URL parameter',
    },
    schema: [],
    messages: {
      knownService:
        '`{{host}}` is a third-party service that DRAWS whatever we put in ' +
        'its URL, so the data reaches it in a GET query string — no ' +
        'contract, no DPA, no logging guarantee. This shipped once as the ' +
        'POS card QR and it was a LIVE Stripe payment link on every ' +
        'transaction (AGL-1671). Render it in our own runtime instead ' +
        '(`qrcode.react` for QR); registering the vendor is NOT the fix.',
      servicePackage:
        '`{{package}}` exists only to build a URL to a third-party image ' +
        'service, so importing it IS the egress — the host never appears in ' +
        'our source, which is exactly why this went unnoticed. `gravatar` ' +
        'put an MD5 of every member email on the console members list, sent ' +
        'to Automattic with the viewer IP (AGL-1683). An email MD5 is a ' +
        'lookup key, not an anonymisation. Draw initials locally instead.',
      interpolatedRemoteSource:
        'This image `{{attribute}}` interpolates our data into a query ' +
        'string on `{{host}}`, so whatever `{{attribute}}` encodes is sent to ' +
        'a third party on every render — the AGL-1671 shape. Generate the ' +
        'image in our own runtime, or serve it from a first-party route.',
    },
  },

  create(context) {
    /** Detection 1, on every literal in the file whatever it is doing there. */
    function checkText(node, text) {
      const host = namedService(text)
      if (!host) return
      context.report({ node, messageId: 'knownService', data: { host } })
    }

    /** Detection 2, at whichever syntax pulled the dependency in. */
    function checkRequest(node, request) {
      const name = namedServicePackage(request)
      if (!name) return
      context.report({
        node,
        messageId: 'servicePackage',
        data: { package: name },
      })
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') checkText(node, node.value)
      },

      TemplateElement(node) {
        checkText(node, node.value?.cooked ?? node.value?.raw)
      },

      // Detection 2 — `import`, `export … from`, `import()`, `require()`.
      ImportDeclaration(node) {
        checkRequest(node, node.source?.value)
      },

      ExportNamedDeclaration(node) {
        if (node.source) checkRequest(node, node.source.value)
      },

      ExportAllDeclaration(node) {
        if (node.source) checkRequest(node, node.source.value)
      },

      ImportExpression(node) {
        if (node.source?.type === 'Literal') {
          checkRequest(node, node.source.value)
        }
      },

      CallExpression(node) {
        if (node.callee?.type !== 'Identifier') return
        if (node.callee.name !== 'require') return
        const [first] = node.arguments
        if (first?.type === 'Literal') checkRequest(node, first.value)
      },

      // Detection 3 — the shipped shape, at the element that fetches.
      JSXAttribute(node) {
        if (!SOURCE_ATTRIBUTES.has(node.name?.name)) return
        const container = node.value
        if (container?.type !== 'JSXExpressionContainer') return
        const template = container.expression
        if (template?.type !== 'TemplateLiteral') return

        const opening = node.parent
        if (opening?.type !== 'JSXOpeningElement') return
        if (!isImageElement(opening)) return

        const host = leadingAbsoluteHost(template)
        if (!host) return
        if (isFirstPartyHost(host)) return
        if (!staticTextOpensQuery(template)) return

        // Already reported in full by detection 1; one report, not two.
        if (namedService(host)) return

        context.report({
          node: template,
          messageId: 'interpolatedRemoteSource',
          data: { host, attribute: node.name.name },
        })
      },
    }
  },
}
