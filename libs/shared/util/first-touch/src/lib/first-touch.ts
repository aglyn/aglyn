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
 * First-touch capture: where a visitor first arrived from, kept on their
 * device until an account is created and the platform writes it down.
 *
 * ## The one rule everything else follows from
 *
 * A visitor rarely signs up on the page they landed on, and the page they
 * landed on is not always the marketing site. They find a guide on the docs
 * host through a search engine, read the pricing page, then sign up on the
 * console. Three hosts, and only the first one saw where they came from.
 *
 * So every surface the platform serves includes this capture, and every one
 * of them agrees on which referrers are its own. **An internal referrer is
 * never a first touch.** Only an external referrer, or a landing with no
 * referrer at all, starts the record; a hop between two of our own hosts
 * carries the record forward and never replaces it. "docs → pricing →
 * signup" therefore still reports the search engine that started it.
 *
 * ## Where the record lives
 *
 * - **A cookie on the registrable domain** of the surface (`.example.com`),
 *   found by asking the browser rather than by carrying a public-suffix list:
 *   the broadest domain that accepts a cookie is the registrable one. Every
 *   subdomain, and so every console door under it, reads the same value.
 * - **`sessionStorage`**, when the browser refuses the cookie. It dies with
 *   the tab and does not cross subdomains, which is the price of a browser
 *   that refuses storage.
 * - **Memory**, while the visitor's consent is unresolved or has been refused
 *   for this surface. Nothing is written to the device. A link to another of
 *   our hosts can still carry the record, sealed, in its URL (below).
 *
 * The cookie is re-written on every load with a fresh lifetime, because some
 * browsers cap the life of a script-written cookie at a week of inactivity;
 * the VALUE never changes once set.
 *
 * ## Crossing to a host the cookie cannot reach
 *
 * A surface on a different registrable domain, or any hop made while the
 * record is held in memory, cannot read the cookie. For those links the
 * capture asks the platform to SEAL the record (an HMAC over it and an
 * expiry, signed with a secret no page holds) and appends the sealed token as
 * `_ft` at the moment the link is followed. The receiving surface strips the
 * parameter from its address bar at once, asks the platform to OPEN it, and
 * adopts what comes back. Adoption is a merge, and the merge keeps the
 * earlier record, so replaying a token can never move a first touch later.
 *
 * What the seal proves is narrow and worth stating exactly: that this install
 * produced the record, recently, and nobody edited it on the way. It does not
 * prove the record is TRUE — a visitor can put any `utm_*` they like on a URL
 * and always could. Attribution is a label, and it grants nothing.
 *
 * ## What is never recorded
 *
 * No identifier. The record says how a visit began, and two visitors who
 * arrived the same way carry the same record give or take a timestamp. Click
 * ids are kept as PRESENCE only — "this arrived from a paid click" — and their
 * values never leave the URL they came on. Referrers are kept as a HOST, never
 * a path, because a referring path can carry a search query or an account
 * page. `utm_*` values are trimmed, refused when shaped like an email
 * address, and capped, the same scrub the signup campaign parser applies.
 *
 * ## Why the whole runtime is one function
 *
 * The same code must run as a module a Next app imports and as a script tag
 * on a page no bundler touches (a hosted forum, a status page). So the
 * runtime is ONE self-contained function, {@link createFirstTouchKit}, that
 * references nothing outside itself: the served script is that function's own
 * source text followed by a call to it. The constraint that keeps it working
 * is the same one `next-themes` lives under — no imports, no module-level
 * values, and no syntax a compiler would lower into a shared helper (object
 * spread, classes, `async`). `first-touch-script.spec.ts` runs the
 * stringified function in a bare context to hold that.
 */

/** Click identifiers whose PRESENCE the record keeps; their values never leave the URL. */
export const FIRST_TOUCH_CLICK_IDS = ['gclid', 'fbclid', 'msclkid'] as const
export type FirstTouchClickId = (typeof FIRST_TOUCH_CLICK_IDS)[number]

/** The `utm_*` parameters the record keeps, named without their prefix. */
export const FIRST_TOUCH_UTM_KEYS = [
  'source',
  'medium',
  'campaign',
  'content',
  'term',
] as const
export type FirstTouchUtmKey = (typeof FIRST_TOUCH_UTM_KEYS)[number]
export type FirstTouchUtm = Partial<Record<FirstTouchUtmKey, string>>

/** The cookie the record is kept in, on the surface's registrable domain. */
export const FIRST_TOUCH_COOKIE = 'aglyn_ft'
/** The query parameter a sealed hand-off rides on. */
export const FIRST_TOUCH_HANDOFF_PARAM = '_ft'

/** How a visit began, as the capture records it. */
export interface FirstTouch {
  /** Record format. A reader refuses any other value rather than guess. */
  v: 1
  /** When the visitor landed, epoch milliseconds. */
  at: number
  /** The host of the first page they landed on. */
  host: string
  /** That page's path, without its query string or fragment. */
  path: string
  /** The EXTERNAL host that sent them, or null when nothing external did. */
  ref: string | null
  /**
   * One of our own hosts they arrived from before any surface had recorded
   * them — the tell of a surface that does not include the capture yet.
   */
  via?: string
  /** The `utm_*` parameters the landing URL carried. */
  utm?: FirstTouchUtm
  /** Which click identifiers the landing URL carried. */
  click?: FirstTouchClickId[]
}

/** What {@link FirstTouchKit.buildFirstTouch} reads a landing from. */
export interface FirstTouchLanding {
  /** The URL the visitor landed on. */
  href: string
  /** `document.referrer` at that moment; empty when there was none. */
  referrer?: string | null
  /** The hosts this install serves itself — see {@link FirstTouchConfig.hosts}. */
  hosts: readonly string[]
  /** The time to stamp, epoch milliseconds. */
  now: number
}

/** How a surface configures the capture. */
export interface FirstTouchConfig {
  /**
   * The hosts this install serves itself. An entry is an exact host
   * (`example.com`) or a wildcard for every subdomain of one at any depth
   * (`*.example.com`, which does not match `example.com` itself). A leading
   * `!` EXCLUDES what the rest of the entry names, whatever else matches it:
   * `!*.sites.example.com` keeps customer sites served under the operator's
   * own domain external. A referrer on an included host is internal, and the
   * capture runs only on a page whose host is included.
   */
  hosts: readonly string[]
  /**
   * Whether this surface may keep the record on the device. `null` means the
   * visitor's consent is not resolved yet: the record is held in memory and
   * written the moment {@link FirstTouchRuntime.setStorage} grants it.
   * Omitted means true, the posture of a surface with no consent gate.
   */
  storage?: boolean | null
  /**
   * The platform endpoint that seals and opens hand-off tokens: absolute, or
   * a path on the current origin. Without it no link is decorated and no
   * token is adopted, and the cookie alone carries the record.
   */
  handoffUrl?: string | null
}

/** Where the record currently lives on this page. */
export type FirstTouchTier = 'cookie' | 'session' | 'memory'

/** The handle a booted capture returns. */
export interface FirstTouchRuntime {
  /** The first touch as this page knows it, or null. */
  read(): FirstTouch | null
  /** Grant, refuse or un-resolve device storage for this surface. */
  setStorage(allowed: boolean | null): void
  /** Where the record lives right now, or null when there is none. */
  tier(): FirstTouchTier | null
}

/** Everything the capture does, as one closure — see the file comment for why. */
export interface FirstTouchKit {
  /** A bare lowercase host, or '' when the value is not one. */
  normalizeHost(value: unknown): string
  /** Whether `host` is one of `hosts` — see {@link FirstTouchConfig.hosts}. */
  isFirstPartyHost(host: unknown, hosts: readonly string[]): boolean
  /** The touch a landing describes, or null when the URL is not a web page. */
  buildFirstTouch(landing: FirstTouchLanding): FirstTouch | null
  /**
   * Rebuild a record from an untrusted value, keeping only known fields, each
   * re-scrubbed; null when it is not a record. `now`, when given, refuses a
   * record stamped more than a day into the future.
   */
  sanitizeFirstTouch(value: unknown, now?: number): FirstTouch | null
  /** The first of two records: the earlier `at` wins, and a tie keeps `a`. */
  mergeFirstTouch(
    a: FirstTouch | null | undefined,
    b: FirstTouch | null | undefined,
  ): FirstTouch | null
  /** The cookie-safe text form of a record. */
  encodeFirstTouch(touch: FirstTouch): string
  /** A record from its cookie text, sanitized; null for anything else. */
  decodeFirstTouch(value: unknown): FirstTouch | null
  /** The record a `Cookie` header carries, for a server that receives one. */
  readFirstTouchCookie(cookieHeader: string | null | undefined): FirstTouch | null
  /** Start capturing on this page. Idempotent; a second call updates the config. */
  boot(config: FirstTouchConfig): FirstTouchRuntime
  /** The booted runtime's record, or whatever the device holds when none booted. */
  read(): FirstTouch | null
}

/**
 * Build the capture. Self-contained by construction: nothing in the body may
 * reference a value declared outside it (types are erased and do not count).
 */
export function createFirstTouchKit(): FirstTouchKit {
  const CLICK_IDS = ['gclid', 'fbclid', 'msclkid']
  const UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term']
  const COOKIE = 'aglyn_ft'
  const PROBE = 'aglyn_ft_probe'
  const SESSION_KEY = 'aglyn:first-touch'
  const GLOBAL_KEY = '__aglynFirstTouch'
  const PARAM = '_ft'
  // A visit worth attributing can take months between the first read and the
  // signup; the value is refreshed on every visit, so this bounds inactivity.
  const MAX_AGE_SECONDS = 180 * 24 * 60 * 60
  const MAX_VALUE = 100
  const MAX_PATH = 200
  const MAX_HOST = 253
  const MAX_TOKEN = 4096
  const FUTURE_SKEW_MS = 24 * 60 * 60 * 1000
  const TOKEN_MARGIN_MS = 60 * 1000
  const EMAIL_SHAPED = /[^\s@]+@[^\s@]+\.[^\s@]+/
  const HOST_SHAPE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/
  // Control characters are exactly what this pattern exists to find: a
  // `utm_*` value is refused its line breaks, NULs and escapes, not its text.
  // eslint-disable-next-line no-control-regex
  const CONTROL = /[\u0000-\u001f\u007f]/g

  const state = {
    booted: false,
    hosts: [] as string[],
    storage: true as boolean | null,
    handoffUrl: '' as string,
    touch: null as FirstTouch | null,
    tier: null as FirstTouchTier | null,
    domain: undefined as string | undefined,
    token: null as { value: string; exp: number } | null,
    sealing: false,
  }

  function normalizeHost(value: unknown): string {
    if (typeof value !== 'string') return ''
    let host = value.trim().toLowerCase()
    if (host.charAt(host.length - 1) === '.') host = host.slice(0, -1)
    if (!host || host.length > MAX_HOST || !HOST_SHAPE.test(host)) return ''
    return host
  }

  function normalizePattern(value: unknown): string {
    if (typeof value !== 'string') return ''
    let raw = value.trim().toLowerCase()
    const negated = raw.charAt(0) === '!'
    if (negated) raw = raw.slice(1).trim()
    const base = raw.indexOf('*.') === 0 ? normalizeHost(raw.slice(2)) : ''
    const pattern = base ? '*.' + base : raw.indexOf('*.') === 0 ? '' : normalizeHost(raw)
    return pattern && negated ? '!' + pattern : pattern
  }

  function patternMatches(host: string, pattern: string): boolean {
    if (pattern.indexOf('*.') !== 0) return host === pattern
    const suffix = pattern.slice(1)
    return host.length > suffix.length && host.slice(-suffix.length) === suffix
  }

  function normalizeHostList(hosts: unknown): string[] {
    const out: string[] = []
    if (!hosts || typeof (hosts as unknown[]).length !== 'number') return out
    const list = hosts as unknown[]
    for (let i = 0; i < list.length; i++) {
      const pattern = normalizePattern(list[i])
      if (pattern && out.indexOf(pattern) < 0) out.push(pattern)
    }
    return out
  }

  function isFirstPartyHost(host: unknown, hosts: readonly string[]): boolean {
    const bare = normalizeHost(host)
    if (!bare) return false
    const patterns = normalizeHostList(hosts)
    let included = false
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i]
      if (pattern.charAt(0) === '!') {
        if (patternMatches(bare, pattern.slice(1))) return false
      } else if (!included && patternMatches(bare, pattern)) {
        included = true
      }
    }
    return included
  }

  function scrub(value: unknown): string {
    if (typeof value !== 'string') return ''
    const clean = value.replace(CONTROL, '').trim()
    if (!clean || EMAIL_SHAPED.test(clean)) return ''
    return clean.slice(0, MAX_VALUE)
  }

  function scrubPath(value: unknown): string {
    if (typeof value !== 'string') return '/'
    let clean = value.replace(CONTROL, '')
    const cut = clean.search(/[?#]/)
    if (cut >= 0) clean = clean.slice(0, cut)
    if (clean.charAt(0) !== '/') clean = '/' + clean
    return clean.slice(0, MAX_PATH)
  }

  function parseUrl(value: unknown, base?: string): URL | null {
    if (typeof value !== 'string' || !value) return null
    try {
      const url = base ? new URL(value, base) : new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
    } catch {
      return null
    }
  }

  function readUtm(params: URLSearchParams): FirstTouchUtm | null {
    const utm: FirstTouchUtm = {}
    let found = false
    for (let i = 0; i < UTM_KEYS.length; i++) {
      const value = scrub(params.get('utm_' + UTM_KEYS[i]))
      if (value) {
        utm[UTM_KEYS[i] as FirstTouchUtmKey] = value
        found = true
      }
    }
    return found ? utm : null
  }

  function readClickIds(params: URLSearchParams): FirstTouchClickId[] {
    const present: FirstTouchClickId[] = []
    for (let i = 0; i < CLICK_IDS.length; i++) {
      const value = params.get(CLICK_IDS[i])
      if (value && value.trim()) present.push(CLICK_IDS[i] as FirstTouchClickId)
    }
    return present
  }

  function buildFirstTouch(landing: FirstTouchLanding): FirstTouch | null {
    if (!landing) return null
    const url = parseUrl(landing.href)
    const host = url ? normalizeHost(url.hostname) : ''
    if (!url || !host) return null
    const at = typeof landing.now === 'number' && landing.now > 0 ? landing.now : 0
    if (!at) return null
    const touch: FirstTouch = { v: 1, at: at, host: host, path: scrubPath(url.pathname), ref: null }
    const referrer = parseUrl(landing.referrer)
    const refHost = referrer ? normalizeHost(referrer.hostname) : ''
    if (refHost && refHost !== host) {
      if (isFirstPartyHost(refHost, landing.hosts)) touch.via = refHost
      else touch.ref = refHost
    }
    const utm = readUtm(url.searchParams)
    if (utm) touch.utm = utm
    const click = readClickIds(url.searchParams)
    if (click.length) touch.click = click
    return touch
  }

  function sanitizeFirstTouch(value: unknown, now?: number): FirstTouch | null {
    if (!value || typeof value !== 'object') return null
    const raw = value as Record<string, unknown>
    if (raw['v'] !== 1) return null
    const at = raw['at']
    if (typeof at !== 'number' || !isFinite(at) || at <= 0) return null
    if (typeof now === 'number' && at > now + FUTURE_SKEW_MS) return null
    const host = normalizeHost(raw['host'])
    if (!host) return null
    const touch: FirstTouch = {
      v: 1,
      at: Math.floor(at),
      host: host,
      path: scrubPath(raw['path']),
      ref: normalizeHost(raw['ref']) || null,
    }
    const via = normalizeHost(raw['via'])
    if (via) touch.via = via
    const rawUtm = raw['utm']
    if (rawUtm && typeof rawUtm === 'object') {
      const utm: FirstTouchUtm = {}
      let found = false
      for (let i = 0; i < UTM_KEYS.length; i++) {
        const utmValue = scrub((rawUtm as Record<string, unknown>)[UTM_KEYS[i]])
        if (utmValue) {
          utm[UTM_KEYS[i] as FirstTouchUtmKey] = utmValue
          found = true
        }
      }
      if (found) touch.utm = utm
    }
    const rawClick = raw['click']
    if (rawClick && typeof (rawClick as unknown[]).length === 'number') {
      const click: FirstTouchClickId[] = []
      for (let j = 0; j < CLICK_IDS.length; j++) {
        if ((rawClick as unknown[]).indexOf(CLICK_IDS[j]) >= 0) {
          click.push(CLICK_IDS[j] as FirstTouchClickId)
        }
      }
      if (click.length) touch.click = click
    }
    return touch
  }

  function mergeFirstTouch(
    a: FirstTouch | null | undefined,
    b: FirstTouch | null | undefined,
  ): FirstTouch | null {
    if (!a) return b || null
    if (!b) return a
    return b.at < a.at ? b : a
  }

  function encodeFirstTouch(touch: FirstTouch): string {
    return encodeURIComponent(JSON.stringify(touch))
  }

  function decodeFirstTouch(value: unknown): FirstTouch | null {
    if (typeof value !== 'string' || !value) return null
    try {
      return sanitizeFirstTouch(JSON.parse(decodeURIComponent(value)))
    } catch {
      return null
    }
  }

  function cookieValue(header: string | null | undefined, name: string): string {
    if (typeof header !== 'string' || !header) return ''
    const parts = header.split(';')
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim()
      if (part.indexOf(name + '=') === 0) return part.slice(name.length + 1)
    }
    return ''
  }

  function readFirstTouchCookie(cookieHeader: string | null | undefined): FirstTouch | null {
    return decodeFirstTouch(cookieValue(cookieHeader, COOKIE))
  }

  function hasDom(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
  }

  function secureSuffix(): string {
    return location.protocol === 'https:' ? '; Secure' : ''
  }

  function cookieDomain(): string {
    if (state.domain !== undefined) return state.domain
    const host = location.hostname
    let found = ''
    if (host && host.indexOf('.') > 0 && !/^[\d.]+$/.test(host)) {
      const labels = host.split('.')
      for (let i = labels.length - 2; i >= 0 && !found; i--) {
        const candidate = labels.slice(i).join('.')
        try {
          document.cookie =
            PROBE + '=1; Path=/; Domain=' + candidate + '; SameSite=Lax' + secureSuffix()
          if (cookieValue(document.cookie, PROBE) === '1') {
            found = candidate
            document.cookie =
              PROBE + '=; Path=/; Domain=' + candidate + '; Max-Age=0' + secureSuffix()
          }
        } catch {
          break
        }
      }
    }
    state.domain = found
    return found
  }

  function writeCookie(touch: FirstTouch): boolean {
    try {
      const domain = cookieDomain()
      const encoded = encodeFirstTouch(touch)
      document.cookie =
        COOKIE +
        '=' +
        encoded +
        '; Path=/' +
        (domain ? '; Domain=' + domain : '') +
        '; Max-Age=' +
        MAX_AGE_SECONDS +
        '; SameSite=Lax' +
        secureSuffix()
      return cookieValue(document.cookie, COOKIE) === encoded
    } catch {
      return false
    }
  }

  function sessionStore(): Storage | null {
    try {
      return window.sessionStorage || null
    } catch {
      return null
    }
  }

  function writeSession(touch: FirstTouch): boolean {
    const store = sessionStore()
    if (!store) return false
    try {
      store.setItem(SESSION_KEY, JSON.stringify(touch))
      return true
    } catch {
      return false
    }
  }

  function readSession(): FirstTouch | null {
    const store = sessionStore()
    if (!store) return null
    try {
      const raw = store.getItem(SESSION_KEY)
      return raw ? sanitizeFirstTouch(JSON.parse(raw)) : null
    } catch {
      return null
    }
  }

  function eraseStored(): void {
    try {
      const domain = cookieDomain()
      document.cookie = COOKIE + '=; Path=/; Max-Age=0' + secureSuffix()
      if (domain) {
        document.cookie =
          COOKIE + '=; Path=/; Domain=' + domain + '; Max-Age=0' + secureSuffix()
      }
    } catch {
      // A cookie the browser will not let us touch is one it did not keep.
    }
    const store = sessionStore()
    if (store) {
      try {
        store.removeItem(SESSION_KEY)
      } catch {
        // Same: an unreadable store holds nothing to erase.
      }
    }
  }

  function exposed(): FirstTouch | null {
    try {
      return sanitizeFirstTouch((window as unknown as Record<string, unknown>)[GLOBAL_KEY])
    } catch {
      return null
    }
  }

  function expose(touch: FirstTouch | null): void {
    try {
      ;(window as unknown as Record<string, unknown>)[GLOBAL_KEY] = touch
    } catch {
      // A frozen window costs a second reader on this page, never the capture.
    }
  }

  function readCookie(): FirstTouch | null {
    try {
      return decodeFirstTouch(cookieValue(document.cookie, COOKIE))
    } catch {
      return null
    }
  }

  function loadStored(): FirstTouch | null {
    return mergeFirstTouch(mergeFirstTouch(readCookie(), readSession()), exposed())
  }

  function save(): void {
    const touch = state.touch
    expose(touch)
    if (!touch) {
      state.tier = null
      return
    }
    if (state.storage !== true) state.tier = 'memory'
    else if (writeCookie(touch)) state.tier = 'cookie'
    else if (writeSession(touch)) state.tier = 'session'
    else state.tier = 'memory'
  }

  function adopt(touch: FirstTouch | null): void {
    const next = mergeFirstTouch(state.touch, touch)
    if (next !== state.touch) {
      state.touch = next
      state.token = null
    }
    save()
  }

  function takeHandoffToken(): string {
    try {
      const params = new URLSearchParams(location.search)
      const token = params.get(PARAM) || ''
      if (!token) return ''
      params.delete(PARAM)
      const search = params.toString()
      history.replaceState(
        history.state,
        '',
        location.pathname + (search ? '?' + search : '') + location.hash,
      )
      return token.length <= MAX_TOKEN ? token : ''
    } catch {
      return ''
    }
  }

  function post(body: unknown): Promise<Record<string, unknown> | null> {
    if (!state.handoffUrl || typeof fetch !== 'function') return Promise.resolve(null)
    return fetch(state.handoffUrl, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      credentials: 'omit',
      keepalive: true,
    })
      .then(function (response): Promise<Record<string, unknown>> | null {
        return response.ok ? response.json() : null
      })
      .catch(function (): null {
        return null
      })
  }

  function tokenIsFresh(): boolean {
    return Boolean(state.token && Date.now() < state.token.exp - TOKEN_MARGIN_MS)
  }

  function requestToken(): void {
    if (!state.touch || state.sealing || tokenIsFresh()) return
    state.sealing = true
    const sealed = state.touch
    post({ seal: sealed }).then(function (result) {
      state.sealing = false
      if (
        result &&
        typeof result['token'] === 'string' &&
        typeof result['exp'] === 'number' &&
        state.touch === sealed
      ) {
        state.token = { value: result['token'] as string, exp: result['exp'] as number }
      }
    })
  }

  function underCookieDomain(host: string): boolean {
    const domain = state.domain
    if (!domain) return false
    return host === domain || host.slice(-(domain.length + 1)) === '.' + domain
  }

  function handoffTarget(node: unknown): { anchor: Element; url: URL } | null {
    const element = node as Element | null
    if (!element || typeof element.closest !== 'function') return null
    const anchor = element.closest('a[href]')
    if (!anchor) return null
    const url = parseUrl(anchor.getAttribute('href') || '', location.href)
    if (!url) return null
    const host = normalizeHost(url.hostname)
    if (!host || host === normalizeHost(location.hostname)) return null
    if (!isFirstPartyHost(host, state.hosts)) return null
    if (state.tier === 'cookie' && underCookieDomain(host)) return null
    return { anchor: anchor, url: url }
  }

  function installDecoration(): void {
    const onIntent = function (event: Event): void {
      try {
        if (handoffTarget(event.target)) requestToken()
      } catch {
        // Attribution never costs a navigation.
      }
    }
    const onActivate = function (event: Event): void {
      try {
        const target = handoffTarget(event.target)
        if (!target) return
        if (!tokenIsFresh()) {
          requestToken()
          return
        }
        target.url.searchParams.set(PARAM, (state.token as { value: string }).value)
        target.anchor.setAttribute('href', target.url.toString())
      } catch {
        // Same: a link that throws here would be a link that does not work.
      }
    }
    document.addEventListener('pointerover', onIntent, true)
    document.addEventListener('focusin', onIntent, true)
    document.addEventListener('pointerdown', onActivate, true)
    document.addEventListener('click', onActivate, true)
    const links = document.links
    for (let i = 0; i < links.length; i++) {
      if (handoffTarget(links[i])) {
        requestToken()
        break
      }
    }
  }

  function configure(config: FirstTouchConfig): void {
    const input = config || ({} as FirstTouchConfig)
    state.hosts = normalizeHostList(input.hosts)
    state.storage =
      input.storage === false ? false : input.storage === null ? null : true
    const url = typeof input.handoffUrl === 'string' ? input.handoffUrl.trim() : ''
    state.handoffUrl =
      url.charAt(0) === '/' && url.charAt(1) !== '/' ? url : parseUrl(url) ? url : ''
  }

  const runtime: FirstTouchRuntime = {
    read: function () {
      return state.touch
    },
    setStorage: function (allowed) {
      const next = allowed === true ? true : allowed === false ? false : null
      const granted = next === true && state.storage !== true
      state.storage = next
      if (!hasDom()) return
      if (next === false) {
        eraseStored()
        state.tier = state.touch ? 'memory' : null
        return
      }
      if (granted) {
        state.touch = mergeFirstTouch(loadStored(), state.touch)
        save()
      }
    },
    tier: function () {
      return state.tier
    },
  }

  function boot(config: FirstTouchConfig): FirstTouchRuntime {
    const hadHandoff = Boolean(state.handoffUrl)
    configure(config)
    if (!hasDom()) return runtime
    if (state.booted) {
      if (!hadHandoff && state.handoffUrl) installDecoration()
      return runtime
    }
    // Only a host the install names as its own captures. A copy of the tag
    // pasted onto anybody else's page records nothing and decorates nothing.
    if (!isFirstPartyHost(location.hostname, state.hosts)) return runtime
    state.booted = true
    const token = takeHandoffToken()
    const current = buildFirstTouch({
      href: location.href,
      referrer: document.referrer,
      hosts: state.hosts,
      now: Date.now(),
    })
    state.touch = mergeFirstTouch(loadStored(), current)
    save()
    if (token && state.handoffUrl) {
      post({ open: token }).then(function (result) {
        adopt(sanitizeFirstTouch(result && result['touch'], Date.now()))
      })
    }
    if (state.handoffUrl) installDecoration()
    return runtime
  }

  function read(): FirstTouch | null {
    if (state.touch) return state.touch
    return hasDom() ? loadStored() : null
  }

  return {
    normalizeHost: normalizeHost,
    isFirstPartyHost: isFirstPartyHost,
    buildFirstTouch: buildFirstTouch,
    sanitizeFirstTouch: sanitizeFirstTouch,
    mergeFirstTouch: mergeFirstTouch,
    encodeFirstTouch: encodeFirstTouch,
    decodeFirstTouch: decodeFirstTouch,
    readFirstTouchCookie: readFirstTouchCookie,
    boot: boot,
    read: read,
  }
}

/**
 * The page's one capture. A bundle that imports this module shares it, so a
 * surface that boots it and a form that reads it see the same record.
 */
const kit = createFirstTouchKit()

export const normalizeFirstTouchHost = kit.normalizeHost
export const isFirstPartyHost = kit.isFirstPartyHost
export const buildFirstTouch = kit.buildFirstTouch
export const sanitizeFirstTouch = kit.sanitizeFirstTouch
export const mergeFirstTouch = kit.mergeFirstTouch
export const encodeFirstTouch = kit.encodeFirstTouch
export const decodeFirstTouch = kit.decodeFirstTouch
export const readFirstTouchCookie = kit.readFirstTouchCookie
export const bootFirstTouch = kit.boot
export const readFirstTouch = kit.read
