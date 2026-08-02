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
import { useCallback, useEffect, useState } from 'react'

interface Target {
  name: string
  label: string
  description: string
  base: string
}

const TARGETS: Target[] = [
  {
    name: 'console',
    label: 'Console',
    description: 'Sign-in, editing, billing and everything at app.aglyn.com.',
    base: 'https://app.aglyn.com',
  },
  {
    name: 'tenant',
    label: 'Published sites',
    description: 'The runtime that serves every published site and storefront.',
    base: 'https://demo.aglyn.com',
  },
]

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
  const [readings, setReadings] = useState<Record<string, Reading>>(
    Object.fromEntries(TARGETS.map((t) => [t.name, { verdict: 'checking' as Verdict }])),
  )
  const [checkedAt, setCheckedAt] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const results = await Promise.all(
      TARGETS.map(async (target) => [target.name, await check(target)] as const),
    )
    setReadings(Object.fromEntries(results))
    setCheckedAt(new Date().toLocaleTimeString())
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 60_000)
    return () => clearInterval(timer)
  }, [refresh])

  const verdicts = TARGETS.map((t) => readings[t.name]?.verdict)
  const allGood = verdicts.every((v) => v === 'operational')
  const anyChecking = verdicts.some((v) => v === 'checking')

  return (
    <Layout title="Status" description="Live status of the Aglyn console and published sites.">
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '3rem 1rem' }}>
        <h1 style={{ marginBottom: '0.25rem' }}>Status</h1>
        <p style={{ color: 'var(--ifm-color-emphasis-700)', marginTop: 0 }}>
          {anyChecking
            ? 'Checking each service from your browser…'
            : allGood
              ? 'All services are responding normally.'
              : 'One or more services are not responding normally.'}
        </p>

        <div style={{ display: 'grid', gap: '1rem', marginTop: '2rem' }}>
          {TARGETS.map((target) => {
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
