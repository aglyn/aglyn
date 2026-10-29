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

// The cases, verdicts and refusals of `prove-site-import-edge.mjs` (AGL-4085),
// pure so `site-import-edge-proof.test.mjs` can hold them without a network.
//
// The rule being proved is "Site import crawler bypass" on aglyn-tenant
// (`firewall-posture.mjs`): the bot challenge is lifted for a request with
// the `x-aglyn-import` secret AND a user agent starting `AglynBot/`, and for
// nothing less. One request that passes proves only half of that, so the
// proof is the pass AND every near miss still challenged:
//
//   secret + AglynBot                      → passes
//   AglynBot, no secret                    → challenged
//   AglynBot + a wrong secret, same length → challenged
//   secret + curl's user agent             → challenged
//   secret + a browser naming AglynBot     → challenged (the `^` anchor)
//   neither (a stranger)                   → challenged
//
// plus a CONTROL first: AglynBot on `/robots.txt`, which the crawler metadata
// bypass admits with no secret. If that is challenged, custom bypasses are not
// admitting anything from this network (Attack Challenge Mode answers ahead
// of every custom rule, measured 2026-09-19), and nothing below can be read
// either way, so the run says it cannot prove rather than reporting a fail.

/** The header the rule matches. */
export const EDGE_HEADER = 'x-aglyn-import'

/** What the crawler says it is (`AGLYN_BOT_USER_AGENT` in site-import-crawl.ts). */
export const AGLYN_BOT_USER_AGENT = 'AglynBot/1.0 (+https://docs.aglyn.com/ai/bring-my-site)'

export const CURL_USER_AGENT = 'curl/8.7.1'
export const BROWSER_NAMING_AGLYNBOT = 'Mozilla/5.0 (compatible; AglynBot/1.0)'

export const DEFAULT_PROOF_URL = 'https://aglyn.com/'

/** The same floor the crawler and the posture check hold the secret to. */
export const MIN_TOKEN_LENGTH = 32

/**
 * Why the secret cannot be used, or null. It is never echoed: a refusal names
 * the problem, never the value.
 */
export function tokenProblem(token) {
  const value = String(token ?? '').trim()
  if (!value) return 'SITE_IMPORT_EDGE_TOKEN is not set'
  if (value.length < MIN_TOKEN_LENGTH) return `SITE_IMPORT_EDGE_TOKEN is shorter than ${MIN_TOKEN_LENGTH} characters`
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return 'SITE_IMPORT_EDGE_TOKEN holds characters other than A-Z, a-z, 0-9, _ and -'
  return null
}

/**
 * Why a target cannot be proved against, or null. Only hosts the tenant
 * project serves for Aglyn itself: the secret goes nowhere else, from this
 * script either.
 */
export function targetProblem(raw) {
  let url
  try {
    url = new URL(String(raw ?? ''))
  } catch {
    return `not a URL: ${raw}`
  }
  if (url.protocol !== 'https:') return 'only https'
  if (url.port && url.port !== '443') return 'only the default port'
  if (url.username || url.password) return 'no credentials in the URL'
  const host = url.hostname.toLowerCase()
  const ours = host === 'aglyn.com' || /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.aglyn\.app$/.test(host)
  if (!ours) return `${host} is not a host the tenant project serves for Aglyn (aglyn.com or one <name>.aglyn.app)`
  return null
}

/** A secret of the same length and alphabet that is certainly not the secret. */
export function wrongTokenFor(token, random = Math.random) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const length = String(token).length
  for (;;) {
    let out = ''
    for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(random() * alphabet.length)]
    if (out !== token) return out
  }
}

/**
 * The control and the cases, in order. `headers` carries the secret for the
 * cases that send it; a caller prints only `name` and `expect`.
 *
 * @returns {{ id: string, name: string, path: 'target' | 'robots', expect: 'pass' | 'challenge', control?: boolean, headers: Record<string, string> }[]}
 */
export function proofCases(token, wrong) {
  return [
    {
      id: 'control',
      name: 'control: AglynBot on /robots.txt, no secret (the crawler metadata bypass)',
      path: 'robots',
      expect: 'pass',
      control: true,
      headers: { 'user-agent': AGLYN_BOT_USER_AGENT },
    },
    {
      id: 'secret-and-agent',
      name: 'the secret + AglynBot',
      path: 'target',
      expect: 'pass',
      headers: { 'user-agent': AGLYN_BOT_USER_AGENT, [EDGE_HEADER]: token },
    },
    {
      id: 'agent-only',
      name: 'AglynBot, no secret',
      path: 'target',
      expect: 'challenge',
      headers: { 'user-agent': AGLYN_BOT_USER_AGENT },
    },
    {
      id: 'wrong-secret',
      name: 'AglynBot + a wrong secret of the same length',
      path: 'target',
      expect: 'challenge',
      headers: { 'user-agent': AGLYN_BOT_USER_AGENT, [EDGE_HEADER]: wrong },
    },
    {
      id: 'secret-other-agent',
      name: "the secret + curl's user agent",
      path: 'target',
      expect: 'challenge',
      headers: { 'user-agent': CURL_USER_AGENT, [EDGE_HEADER]: token },
    },
    {
      id: 'secret-unanchored-agent',
      name: 'the secret + a browser user agent naming AglynBot later in the string',
      path: 'target',
      expect: 'challenge',
      headers: { 'user-agent': BROWSER_NAMING_AGLYNBOT, [EDGE_HEADER]: token },
    },
    {
      id: 'stranger',
      name: "neither: curl's user agent, no secret",
      path: 'target',
      expect: 'challenge',
      headers: { 'user-agent': CURL_USER_AGENT },
    },
  ]
}

/**
 * What one answer was. A challenge is a 429 the edge marks
 * `x-vercel-mitigated: challenge`; a pass is any answer below 400 that the
 * edge did not mitigate. Anything else (a 403 deny, a 5xx, no answer) is
 * neither, and fails whichever case asked.
 */
export function classify({ status, mitigated }) {
  const mark = String(mitigated ?? '').trim().toLowerCase()
  if (status === 429 && mark === 'challenge') return 'challenged'
  if (typeof status === 'number' && status > 0 && status < 400 && !mark) return 'passed'
  return 'other'
}

/**
 * The verdict over every answer.
 *
 * @param {{ id: string, name: string, expect: string, control?: boolean, status: number, mitigated: string | null, error?: string }[]} results
 * @returns {{ exitCode: 0 | 1 | 2, lines: string[] }}  0 proved, 1 the rule is wrong, 2 cannot prove from here
 */
export function verdict(results) {
  const lines = []
  let failed = 0
  let blind = false
  for (const result of results) {
    const seen = result.error ? 'other' : classify(result)
    const wanted = result.expect === 'pass' ? 'passed' : 'challenged'
    const ok = seen === wanted
    const answer = result.error
      ? `no answer (${result.error})`
      : `${result.status}${result.mitigated ? ` x-vercel-mitigated: ${result.mitigated}` : ''}`
    lines.push(`${ok ? 'OK  ' : result.control ? 'BLND' : 'FAIL'} ${result.name}: ${answer}; expected ${wanted}`)
    if (ok) continue
    if (result.control) blind = true
    else failed += 1
  }
  lines.push('')
  if (blind) {
    lines.push(
      'Cannot prove from here: the control was not admitted, so custom bypass rules are not ' +
        'reaching requests from this network (Attack Challenge Mode, or a block ahead of the ' +
        'custom rules). Nothing above says whether the site import rule works.',
    )
    return { exitCode: 2, lines }
  }
  if (failed) {
    lines.push(
      `${failed} case(s) did not answer as the rule requires. If "the secret + AglynBot" was ` +
        'challenged, the rule is missing, inactive, or its value is not SITE_IMPORT_EDGE_TOKEN. ' +
        'If a near miss passed, the rule is wider than declared: run npm run check:firewall-posture.',
    )
    return { exitCode: 1, lines }
  }
  lines.push('Proved: the secret with AglynBot passes, and every near miss is still challenged.')
  return { exitCode: 0, lines }
}
