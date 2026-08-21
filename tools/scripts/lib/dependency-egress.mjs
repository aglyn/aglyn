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

// AGL-1692 — what our production dependencies actually contact, as a detector
// that can be re-run rather than a sweep somebody did once.
//
// WHY THE REGISTER NEEDED THIS
//
// `/legal/subprocessors` is SCC Annex III by incorporation, so the sentence
// "No other vendor that touches customer data was found" is a representation
// to customers. It was produced by grepping OUR SOURCE. `gravatar` (AGL-1683)
// had been shipping an MD5 of every console member's email to Automattic on
// every members-list view, and our source contained exactly
// `gravatarUrlFromEmail(email)` — nothing a host grep, a CSP entry or
// `images.remotePatterns` could ever have surfaced.
//
// THE TWO CLASSES, AND WHY THE SECOND ONE IS THE NEW PART
//
// The 2026-08-14 re-sweep walked the dependency closure for HOST LITERALS and
// found jsDelivr (AGL-1779) and four Firebase endpoints (AGL-1780). That is
// the right unit for a vendor that picks its own host. It is the wrong unit —
// and silently returns nothing — for a package that picks NO host:
//
//   `vendor-host`  a third-party host the package itself supplies, in shipped
//                  code. A real recipient of data, and the only class that can
//                  become an Annex III row. NOT conditioned on a co-located
//                  egress primitive: `gravatar` performs no IO whatsoever, and
//                  `firebase-admin` reaches `identitytoolkit.googleapis.com`
//                  through a transport module in a different file. Requiring
//                  co-location loses both.
//   `caller-host`  an egress primitive and no host of its own: the transport
//                  our code hands a destination to. `undici` is the live
//                  example — AGL-2480 promoted it out of devDependencies
//                  because the plugin-fetch SSRF guard was renting its HTTP
//                  client from a dev dependency. Not a subprocessor. It IS
//                  the production network path along which the next recipient
//                  arrives, and a method blind to it cannot say where to look.
//   `inert`        neither.
//
// WHAT THIS DETECTOR STILL CANNOT SEE — read before trusting a negative
//
// * A host assembled from fragments, base64 or a runtime config value is
//   invisible. This finds `gravatar` (its host is a literal); it does not
//   find a vendor that obfuscates.
// * Code fetched at runtime is out of scope by construction: once Monaco's
//   loader arrives from jsDelivr it fetches chunks from URLs in no package on
//   disk (AGL-1779), and the same is true of gtag.
// * Marketplace plugin bundles are not in any `node_modules` here. Nothing
//   this reports says anything about what a published plugin contacts.
// * A host held only in an env var never appears.
// * Static only. No page was loaded and no network panel was read.
//
// The evidence a finding carries is the file and the primitive, so the next
// person reads vendor source at a named path instead of re-deriving the lead.

// MARK – GLOBALS

/**
 * Hosts that appear in essentially every package and mean nothing: licence
 * headers, specs, RFCs, issue trackers, the registry itself.
 *
 * Suffix-matched, so `www.w3.org` and `lists.w3.org` are both covered. This
 * is the difference between a report of 397 hosts, which the 2026-08-14 sweep
 * produced and a person had to triage by hand, and a report short enough to
 * be read on every run.
 */
export const DOCUMENTATION_HOST_SUFFIXES = [
  'apache.org',
  'opensource.org',
  'gnu.org',
  'creativecommons.org',
  'mozilla.org',
  'w3.org',
  'whatwg.org',
  'ietf.org',
  'rfc-editor.org',
  'unicode.org',
  'ecma-international.org',
  'iso.org',
  'iana.org',
  'github.com',
  'githubusercontent.com',
  'gitlab.com',
  'npmjs.org',
  'npmjs.com',
  'nodejs.org',
  'developer.mozilla.org',
  'stackoverflow.com',
  'wikipedia.org',
  'json-schema.org',
  'schema.org',
  'purl.org',
  'xmlns.com',
  'jquery.com',
  'semver.org',
  'keepachangelog.com',
  'tc39.es',
  'caniuse.com',
  'browserstack.com',
  'travis-ci.org',
  'shields.io',
  'badgen.net',
  'codecov.io',
  'coveralls.io',
  'patreon.com',
  'opencollective.com',
  'tidelift.com',
  'paypal.me',
  'twitter.com',
  'medium.com',
  'youtube.com',
]

/**
 * Hosts that are nobody's egress: loopback, the reserved example names, and
 * the RFC 2606 test TLDs. Matched exactly or as a suffix, same as above.
 */
export const NON_EGRESS_HOST_SUFFIXES = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'example.com',
  'example.org',
  'example.net',
  '.example',
  '.invalid',
  '.test',
  '.local',
  'your-domain.com',
  'domain.com',
  'site.com',
]

/**
 * The mechanisms, keyed by the name a finding reports.
 *
 * Two groups on purpose. The browser group (`fetch` … `fontFace`) is what
 * egresses from a page — including the three tag-injection shapes that never
 * appear as an image `src` and so are invisible to `images.remotePatterns`.
 * The node group (`netConnect` … `webSocket`) is what egresses from a server
 * route, and it is the group that finds a transport: `undici` reaches the
 * network through `net.connect`/`tls.connect` and mentions no host at all.
 */
export const EGRESS_PRIMITIVES = [
  ['fetch', /\bfetch\s*\(/],
  ['xhr', /\bnew\s+XMLHttpRequest\s*\(/],
  ['sendBeacon', /\bsendBeacon\s*\(/],
  ['scriptElement', /createElement\s*\(\s*['"`]script['"`]/],
  ['linkElement', /createElement\s*\(\s*['"`]link['"`]/],
  ['imageElement', /\bnew\s+Image\s*\(/],
  ['importScripts', /\bimportScripts\s*\(/],
  ['fontFace', /@font-face/],
  ['netConnect', /\bnet\s*\.\s*connect\s*\(/],
  ['tlsConnect', /\btls\s*\.\s*connect\s*\(/],
  ['httpRequest', /\bhttps?\s*\.\s*request\s*\(/],
  ['webSocket', /\bnew\s+WebSocket\s*\(/],
]

/** Extensions that can run, or that the browser can fetch from. */
const SWEPT_EXTENSIONS = /\.(?:m?js|cjs|jsx|tsx?|css|html?|json)$/

/**
 * Never code: types, sourcemaps, and the package manifest.
 *
 * `package.json` is excluded by NAME rather than by extension because it is
 * the single biggest source of false hosts in the whole corpus — `author`,
 * `funding` and `homepage` put a personal site or a Ko-fi page into the
 * findings for dozens of packages at once. Other shipped `.json` still
 * counts: config and locale data can carry a real endpoint.
 */
const NEVER_SWEPT = /(?:\.d\.ts|\.map|(?:^|\/)package\.json)$/

/**
 * Path SEGMENTS that mean "this ships with the package but never runs for
 * us". Matched as whole segments — `src/attestation/verify.js` contains the
 * letters of `test` and is real code.
 */
const NON_SHIPPING_SEGMENTS = new Set([
  'demo',
  'demos',
  'example',
  'examples',
  'test',
  'tests',
  '__tests__',
  'spec',
  '__mocks__',
  'fixtures',
  'bench',
  'benchmark',
  'benchmarks',
  'docs',
  'doc',
  'website',
  'coverage',
])

const HOST_LITERAL = /https?:\/\/([^\s'"`<>()[\]{},;\\]+)/gi

// MARK – DETECTION

/**
 * Source with its COMMENTS removed, strings left intact.
 *
 * This is the single discriminator that makes the sweep readable, and it is
 * not a heuristic — it is the difference between documentation and a
 * destination. `@firebase/app` mentions `firebase.google.com` in a JSDoc
 * `@see`; `gravatar` writes `'https://secure.gravatar.com/avatar/'` into a
 * variable. Without this, the run reports 1,028 hosts — every doc link in
 * every package — which is the same unreadable output the 2026-08-14 sweep
 * produced (397 hosts, triaged by hand) and the reason it was never repeated.
 *
 * A hand-rolled scanner rather than a regex because the two constructs are
 * mutually recursive in exactly the way that matters here: `'https://x'`
 * contains `//`, so a regex that strips line comments eats the founding case.
 * The scanner tracks string state, so a `//` inside a string is never a
 * comment and a quote inside a comment never opens a string.
 *
 * Deliberately NOT restricted to string literals afterwards: a CSS
 * `@font-face { src: url(https://…) }` and an HTML `src=` attribute carry no
 * quotes a JS scanner would recognise, and both egress.
 */
export function stripComments(source) {
  const text = String(source ?? '')
  let out = ''
  let index = 0
  let quote = null
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    if (quote) {
      // Backslash escapes the next character, whatever it is.
      if (char === '\\') {
        out += char + (next ?? '')
        index += 2
        continue
      }
      if (char === quote) quote = null
      // A newline terminates an unterminated single/double-quoted string;
      // without this a stray apostrophe in a comment swallows the file.
      if ((char === '\n' || char === '\r') && quote !== '`') quote = null
      out += char
      index += 1
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      out += char
      index += 1
      continue
    }
    // `//` preceded by `:` is a scheme separator, never a comment. Without
    // this, an UNQUOTED url — `@font-face{src:url(https://…)}`, an HTML
    // `src=https://…` — is eaten from the `//` to end of line, and the host
    // vanishes. A silent false negative in the two file types whose whole
    // reason for being swept is that they egress without a JS string.
    if (char === '/' && next === '/' && text[index - 1] !== ':') {
      while (index < text.length && text[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (
        index < text.length &&
        !(text[index] === '*' && text[index + 1] === '/')
      ) {
        index += 1
      }
      index += 2
      // Keep a separator so two tokens do not fuse across the comment.
      out += ' '
      continue
    }
    if (char === '<' && text.startsWith('<!--', index)) {
      const end = text.indexOf('-->', index)
      index = end < 0 ? text.length : end + 3
      out += ' '
      continue
    }
    out += char
    index += 1
  }
  return out
}

function matchesSuffix(host, suffixes) {
  return suffixes.some(
    (suffix) =>
      host === suffix ||
      host.endsWith(suffix.startsWith('.') ? suffix : `.${suffix}`),
  )
}

/**
 * Whether a host is one a sweep should report at all — i.e. not a licence
 * URL, a spec, or a loopback/example placeholder.
 */
export function isReportableHost(host) {
  if (!host) return false
  if (matchesSuffix(host, DOCUMENTATION_HOST_SUFFIXES)) return false
  if (matchesSuffix(host, NON_EGRESS_HOST_SUFFIXES)) return false
  // A bare label with no dot is a loopback name or an internal alias, never a
  // public recipient.
  return host.includes('.')
}

/**
 * Every third-party host this source could contact, from `http(s)://…`
 * literals. Credentials, port and path are stripped: what a register row
 * names is a host.
 */
export function extractEgressHosts(source) {
  const hosts = new Set()
  // Comments first — see {@link stripComments}. A host in a `@see` is
  // documentation; a host in code is a destination.
  const text = stripComments(source)
  HOST_LITERAL.lastIndex = 0
  for (;;) {
    const match = HOST_LITERAL.exec(text)
    if (!match) break
    // Everything before the first `/`, `?` or `#` is the authority.
    const authority = match[1].split(/[/?#]/)[0]
    // Credentials live before an `@`; the port after the last `:`.
    const hostAndPort = authority.includes('@')
      ? authority.slice(authority.lastIndexOf('@') + 1)
      : authority
    const host = hostAndPort.replace(/:\d*$/, '').toLowerCase()
    if (isReportableHost(host)) hosts.add(host)
  }
  return hosts
}

/** The egress mechanisms present in this source, by name. */
export function detectEgressPrimitives(source) {
  const text = String(source ?? '')
  const found = []
  for (const [name, pattern] of EGRESS_PRIMITIVES) {
    if (pattern.test(text)) found.push(name)
  }
  return found
}

/**
 * Whether a path inside a package is worth reading: an extension that can
 * run, and no `demo`/`example`/`test` segment on the way to it.
 */
export function isSweptFile(relativePath) {
  const path = String(relativePath ?? '').replace(/\\/g, '/')
  if (!SWEPT_EXTENSIONS.test(path)) return false
  if (NEVER_SWEPT.test(path)) return false
  const segments = path.split('/')
  // The basename is checked for the extension above; the segments before it
  // are what decide whether this tree ships.
  for (const segment of segments.slice(0, -1)) {
    if (NON_SHIPPING_SEGMENTS.has(segment.toLowerCase())) return false
  }
  return true
}

/**
 * Classify one package from its files.
 *
 * ## Why a host literal alone is enough, and a primitive is not required
 *
 * The obvious rule — report a host only when an egress primitive sits beside
 * it in the same file — is wrong, and it is wrong on the founding case.
 * `gravatar/lib/gravatar.js` contains `https://secure.gravatar.com/avatar/`
 * and performs NO IO: it returns a string, and the request is made by an
 * `<img>` tag in OUR code. Requiring a co-located primitive reports it
 * `inert`, which is precisely the miss AGL-1683 is about.
 *
 * So a reportable third-party host in a SHIPPED file is the finding, whether
 * the package fetches it or hands us the URL to fetch. `direct` records which
 * one it was, because that is what the reader needs in order to know where to
 * look: `direct: true` means the package egresses on its own, `direct: false`
 * means it produces a destination for someone else — the invisible shape.
 *
 * The false-positive pressure the co-location rule was trying to relieve is
 * carried instead by {@link isSweptFile} (no demo/example/test tree, which is
 * where the previous pass's cdnjs/unpkg leads all lived) and by the
 * documentation denylist. Anything that survives both is triaged ONCE into
 * the register and never again.
 */
export function classifyPackageEgress(pkg) {
  const evidence = []
  const hosts = new Set()
  const primitives = new Set()
  let anyPrimitive = false
  for (const file of pkg?.files ?? []) {
    if (!isSweptFile(file.path)) continue
    const filePrimitives = detectEgressPrimitives(file.source)
    const fileHosts = [...extractEgressHosts(file.source)].sort()
    if (filePrimitives.length === 0 && fileHosts.length === 0) continue
    if (filePrimitives.length > 0) anyPrimitive = true
    for (const primitive of filePrimitives) primitives.add(primitive)
    for (const host of fileHosts) hosts.add(host)
    evidence.push({
      path: file.path,
      hosts: fileHosts,
      primitives: filePrimitives,
      // Did this file egress on its own, or only produce a destination?
      direct: filePrimitives.length > 0 && fileHosts.length > 0,
    })
  }
  const sortedHosts = [...hosts].sort()
  return {
    name: pkg?.name,
    class: sortedHosts.length > 0
      ? 'vendor-host'
      : anyPrimitive
        ? 'caller-host'
        : 'inert',
    hosts: sortedHosts,
    primitives: [...primitives].sort(),
    evidence,
  }
}

// MARK – THE CONTROL

/**
 * The key a register row is written against: the HOST for a vendor egress
 * (that is the recipient), the PACKAGE for a transport (there is no host to
 * name).
 */
export function registerKeysFor(finding) {
  if (finding.class === 'vendor-host') return finding.hosts
  if (finding.class === 'caller-host') return [finding.name]
  return []
}

/**
 * Findings against the recorded decisions.
 *
 * Two directions, and the second one is the half a register usually lacks:
 *
 * - `undecided` — something egresses and no row covers it. This is what makes
 *   the sweep a control rather than a report: a dependency bump that adds a
 *   new recipient fails here instead of waiting for the next manual pass.
 * - `stale` — a row whose package or host is no longer in the closure. A
 *   register that only ever grows names recipients who receive nothing, and
 *   an Annex III that overstates is as wrong as one that understates.
 */
export function compareToRegister(findings, register) {
  const decided = new Set(Object.keys(register ?? {}))
  const seen = new Set()
  const undecided = []
  for (const finding of findings ?? []) {
    for (const key of registerKeysFor(finding)) {
      seen.add(key)
      if (!decided.has(key)) {
        undecided.push({
          key,
          package: finding.name,
          class: finding.class,
        })
      }
    }
  }
  const stale = [...decided].filter((key) => !seen.has(key)).sort()
  return { ok: undecided.length === 0 && stale.length === 0, undecided, stale }
}
