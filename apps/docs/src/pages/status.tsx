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
 * Public status page (AGL-1102).
 *
 * Lives in the DOCS site on purpose. `aglyn-docs` is a separate Vercel project
 * from the console and the tenant runtime, so a console outage does not take
 * the page reporting it down with it — which is the whole job. A status page
 * served by the thing it reports on is decoration.
 *
 * It reads the live `/api/health` endpoints from the browser, so what you see
 * is the state right now rather than a cached summary. That needs CORS on
 * those endpoints; without it the browser blocks the read and every service
 * renders as unreachable on a perfectly healthy day.
 *
 * WHAT IT DOES NOT SHOW: uptime history or a percentage. Nothing stores
 * samples yet, and a page that invented "99.9%" from a single successful fetch
 * would be worse than one that admits it does not know. AGL-1148 covers the
 * external monitor and the commitment.
 */

import Layout from '@theme/Layout'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import { useCallback, useEffect, useMemo, useState } from 'react'

interface Target {
  name: string
  label: string
  description: string
  base: string
}

/**
 * WHAT THIS PAGE PROBES IS CONFIGURATION (AGL-2124).
 *
 * The two targets were Aglyn's own production origins, so a self-hosted docs
 * build live-probed OUR infrastructure and reported OUR uptime as the
 * operator's — a status page confidently wrong about somebody else's product.
 *
 * `DOCS_STATUS_TARGETS` is a comma-separated list of
 * `name|label|origin|description`. UNSET means the page probes NOTHING and
 * says so, which is the same posture it already takes about uptime history:
 * admitting it does not know beats inventing a number.
 */
function parseTargets(raw: unknown): Target[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, label, base, description] = entry
        .split('|')
        .map((part) => part.trim())
      return { name, label: label || name, base, description: description || '' }
    })
    .filter((target) => Boolean(target.name && target.base))
}

type Verdict = 'checking' | 'operational' | 'degraded' | 'unreachable'

interface Reading {
  verdict: Verdict
  ms?: number
  detail?: string
}

const COLOURS: Record<Verdict, string> = {
  checking: '#9aa0a6',
  operational: '#1a9c53',
  degraded: '#d98324',
  unreachable: '#c5342b',
}

const WORDS: Record<Verdict, string> = {
  checking: 'Checking…',
  operational: 'Operational',
  degraded: 'Degraded',
  unreachable: 'Unreachable',
}

async function check(target: Target): Promise<Reading> {
  const startedAt = Date.now()
  try {
    const response = await fetch(`${target.base}/api/health`, {
      // Belt and braces: the endpoint sends `no-store`, and asking the browser
      // not to reuse a stored copy costs nothing. A status page reading from
      // cache is the failure mode that makes one useless.
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    const ms = Date.now() - startedAt
    const body = await response.json().catch(() => null)
    if (response.ok && body?.status === 'ok') return { verdict: 'operational', ms }
    const failed = Object.entries(body?.checks ?? {})
      .filter(([, value]) => !(value as { ok?: boolean })?.ok)
      .map(([key]) => key)
    return {
      verdict: 'degraded',
      ms,
      detail: failed.length ? `${failed.join(', ')} unavailable` : `HTTP ${response.status}`,
    }
  } catch (error) {
    // A blocked CORS read, a DNS failure and a real outage all land here and
    // are genuinely indistinguishable from a browser. Say "unreachable from
    // your browser" rather than "down" — claiming an outage we cannot see is
    // how a status page loses its credibility.
    return {
      verdict: 'unreachable',
      ms: Date.now() - startedAt,
      detail:
        (error as { name?: string })?.name === 'TimeoutError'
          ? 'no response within 10s'
          : 'could not be reached from your browser',
    }
  }
}

export default function StatusPage(): JSX.Element {
  const { siteConfig } = useDocusaurusContext()
  // Memoized: `parseTargets` builds a new array every call, and an unstable
  // identity here would make `refresh` unstable, which would tear down and
  // rebuild the 60s interval on every render.
  const targets = useMemo(
    () => parseTargets(siteConfig.customFields?.['statusTargets']),
    [siteConfig.customFields],
  )
  const [readings, setReadings] = useState<Record<string, Reading>>(
    Object.fromEntries(
      targets.map((t) => [t.name, { verdict: 'checking' as Verdict }]),
    ),
  )
  const [checkedAt, setCheckedAt] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const results = await Promise.all(
      targets.map(async (target) => [target.name, await check(target)] as const),
    )
    setReadings(Object.fromEntries(results))
    setCheckedAt(new Date().toLocaleTimeString())
  }, [targets])

  useEffect(() => {
    if (!targets.length) return undefined
    void refresh()
    const timer = setInterval(() => void refresh(), 60_000)
    return () => clearInterval(timer)
  }, [refresh, targets.length])

  const verdicts = targets.map((t) => readings[t.name]?.verdict)
  const allGood = verdicts.every((v) => v === 'operational')
  const anyChecking = verdicts.some((v) => v === 'checking')

  return (
    <Layout title="Status" description="Live status of the Aglyn console and published sites.">
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '3rem 1rem' }}>
        <h1 style={{ marginBottom: '0.25rem' }}>Status</h1>
        <p style={{ color: 'var(--ifm-color-emphasis-700)', marginTop: 0 }}>
          {/* AGL-2124: no configured targets means this build probes nothing.
              Saying so is the honest answer — the alternative was probing
              Aglyn's infrastructure and calling the result the operator's. */}
          {targets.length === 0
            ? 'No services are configured for this documentation build to check. ' +
              'Set DOCS_STATUS_TARGETS to monitor your own deployment.'
            : anyChecking
              ? 'Checking each service from your browser…'
              : allGood
                ? 'All services are responding normally.'
                : 'One or more services are not responding normally.'}
        </p>

        <div style={{ display: 'grid', gap: '1rem', marginTop: '2rem' }}>
          {targets.map((target) => {
            const reading = readings[target.name] ?? { verdict: 'checking' as Verdict }
            return (
              <div
                key={target.name}
                style={{
                  border: '1px solid var(--ifm-color-emphasis-300)',
                  borderRadius: 8,
                  padding: '1rem 1.25rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span
                    aria-hidden
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: COLOURS[reading.verdict],
                      flex: '0 0 auto',
                    }}
                  />
                  <strong style={{ flex: 1 }}>{target.label}</strong>
                  <span style={{ color: COLOURS[reading.verdict], fontWeight: 600 }}>
                    {WORDS[reading.verdict]}
                  </span>
                </div>
                <p
                  style={{
                    margin: '0.5rem 0 0 1.6rem',
                    color: 'var(--ifm-color-emphasis-700)',
                    fontSize: '0.9rem',
                  }}
                >
                  {target.description}
                  {reading.detail ? ` — ${reading.detail}` : ''}
                  {reading.ms != null && reading.verdict === 'operational'
                    ? ` Responded in ${reading.ms}ms.`
                    : ''}
                </p>
              </div>
            )
          })}
        </div>

        <p style={{ marginTop: '1.5rem', fontSize: '0.85rem', color: 'var(--ifm-color-emphasis-600)' }}>
          {checkedAt ? `Last checked ${checkedAt}. ` : ''}
          Rechecks every minute.{' '}
          <button
            type="button"
            onClick={() => void refresh()}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'var(--ifm-link-color)',
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            Check now
          </button>
        </p>

        {/*
          Said plainly rather than buried. A status page that implies more
          certainty than it has is the kind nobody trusts the second time.
        */}
        <hr style={{ margin: '2.5rem 0 1.5rem' }} />
        <h2 style={{ fontSize: '1.1rem' }}>What this page does and does not tell you</h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--ifm-color-emphasis-700)' }}>
          Each service is checked <strong>live from your browser</strong> when this page
          loads, and each check reaches a real dependency rather than only asking whether
          the server answered. This page is served from a different deployment than the
          services it reports on, so it stays up when they do not.
        </p>
        <p style={{ fontSize: '0.9rem', color: 'var(--ifm-color-emphasis-700)' }}>
          It does <strong>not</strong> show uptime history or an availability percentage.
          We do not publish a number we cannot yet measure over time. If a service shows
          as unreachable while everything else on your network works, that is worth
          reporting to us — from your browser, a real outage and a local network problem
          look the same.
        </p>
      </main>
    </Layout>
  )
}
