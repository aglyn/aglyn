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
 * Public status page (AGL-1102, AGL-2124, AGL-2411).
 *
 * Lives in the DOCS site on purpose. `aglyn-docs` is a separate Vercel project
 * from the console and the tenant runtime, so a console outage does not take
 * the page reporting it down with it — which is the whole job. A status page
 * served by the thing it reports on is decoration.
 *
 * It reads the live `/api/health` endpoints from the browser, so what you see
 * is the state right now rather than a cached summary. That needs CORS on
 * those endpoints; without it the browser blocks the read and every service
 * renders as unreadable on a perfectly healthy day.
 *
 * ALL OF THE JUDGEMENT LIVES IN `../status-model`, which is unit tested. This
 * file is layout: it cannot be tested here (it imports `@theme/Layout` and
 * `@docusaurus/useDocusaurusContext`, neither of which exists outside a
 * Docusaurus build), so it must not be where the rules live. The rule that
 * matters most is that `operational` has exactly one source — a 200 carrying
 * our own `{"status":"ok"}` — and that everything else this page cannot read
 * is `unknown` rather than green.
 *
 * WHAT IT DOES NOT SHOW: uptime history or a percentage. Nothing stores
 * samples yet, and a page that invented "99.9%" from a single successful fetch
 * would be worse than one that admits it does not know. AGL-1148 covers the
 * external monitor and the commitment.
 */

import Layout from '@theme/Layout'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react'

import {
  initialReadings,
  overallStatus,
  parseTargets,
  probeTarget,
  targetHost,
  OVERALL_SUMMARY,
  VERDICT_COLOURS,
  VERDICT_WORDS,
  type Reading,
  type Verdict,
} from '../status-model'

/** How often an open tab re-reads every target. */
const REFRESH_MS = 60_000

export default function StatusPage(): ReactElement {
  const { siteConfig } = useDocusaurusContext()
  // Memoized: `parseTargets` builds a new array every call, and an unstable
  // identity here would make `refresh` unstable, which would tear down and
  // rebuild the refresh interval on every render.
  const targets = useMemo(
    () => parseTargets(siteConfig.customFields?.['statusTargets']),
    [siteConfig.customFields],
  )
  const [readings, setReadings] = useState<Record<string, Reading>>(() =>
    initialReadings(targets),
  )
  const [checkedAt, setCheckedAt] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const results = await Promise.all(
      targets.map(
        async (target) =>
          [target.name, await probeTarget(target)] as const,
      ),
    )
    setReadings(Object.fromEntries(results))
    setCheckedAt(new Date().toLocaleTimeString())
  }, [targets])

  useEffect(() => {
    if (!targets.length) return undefined
    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh, targets.length])

  const overall = overallStatus(targets, readings)

  return (
    <Layout title="Status" description="Live status of the Aglyn console and published sites.">
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '3rem 1rem' }}>
        <h1 style={{ marginBottom: '0.25rem' }}>Status</h1>
        <p
          data-status-overall={overall}
          style={{ color: 'var(--ifm-color-emphasis-700)', marginTop: 0 }}
        >
          {OVERALL_SUMMARY[overall]}
        </p>

        <div style={{ display: 'grid', gap: '1rem', marginTop: '2rem' }}>
          {targets.map((target) => {
            const reading = readings[target.name] ?? {
              verdict: 'checking' as Verdict,
            }
            return (
              <div
                key={target.name}
                data-status-target={target.name}
                data-status-verdict={reading.verdict}
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
                      background: VERDICT_COLOURS[reading.verdict],
                      flex: '0 0 auto',
                    }}
                  />
                  <strong style={{ flex: 1 }}>{target.label}</strong>
                  <span style={{ color: VERDICT_COLOURS[reading.verdict], fontWeight: 600 }}>
                    {VERDICT_WORDS[reading.verdict]}
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
                    ? ` · answered in ${reading.ms}ms`
                    : ''}
                </p>
                {/* Whose infrastructure this card is about, said out loud. A
                    build that inherited someone else's targets should be
                    obvious to the reader, not a thing they have to infer. */}
                <p
                  style={{
                    margin: '0.25rem 0 0 1.6rem',
                    color: 'var(--ifm-color-emphasis-600)',
                    fontSize: '0.8rem',
                  }}
                >
                  {targetHost(target)}
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
          loads and every minute after that. Each check reaches a real dependency —
          the data store, or an actual page render — rather than only asking whether
          the server answered. A service is shown as operational only when it returns
          its own health report saying so; anything this page cannot read is reported
          as <strong>no reading</strong>, never as healthy.
        </p>
        <p style={{ fontSize: '0.9rem', color: 'var(--ifm-color-emphasis-700)' }}>
          It covers the surfaces you use. Internal subsystems — scheduled jobs,
          backups, billing and abuse controls — are monitored separately and
          continuously, and are not shown here; they can be degraded while
          everything on this page is green, and that is on purpose, because
          nothing on that list changes whether your site is serving.
        </p>
        <p style={{ fontSize: '0.9rem', color: 'var(--ifm-color-emphasis-700)' }}>
          It does <strong>not</strong> show uptime history or an availability percentage.
          We do not publish a number we cannot yet measure over time. It is also not an
          independent monitor: this page is served from a different deployment than the
          services it reports on, but not from a different provider, so an outage broad
          enough to take out the whole platform could take this page with it. If it does
          not load at all, assume that is a real signal.
        </p>
        <p style={{ fontSize: '0.9rem', color: 'var(--ifm-color-emphasis-700)' }}>
          If a service shows <strong>no reading</strong> while everything else on your
          network works, that is worth reporting to us — from your browser, a real
          outage and a local network problem look the same.
        </p>
      </main>
    </Layout>
  )
}
