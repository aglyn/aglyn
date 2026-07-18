/**
 * @license
 * Copyright 2022 Aglyn LLC
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
'use client'

import * as Aglyn from '@aglyn/aglyn'
import DOMPurify from 'dompurify'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import type { SiteRuntimeProps } from '@aglyn/aglyn'
import * as MarketingModel from '../model'
import type {
  AnnouncementBarData,
  ClientAutomation,
  PopupData,
  ScreenExperiment,
} from '../model/site-contract'

/**
 * Overlay metrics beacon (AGL-200): fire-and-forget, never blocks UX.
 * With an `overlayId` (marketing-hub docs, AGL-271) the collector also
 * increments that overlay's own stats counters.
 */
function sendOverlayBeacon(
  hostId: string | undefined,
  overlay: string,
  overlayId?: string,
) {
  if (!hostId) return
  try {
    navigator.sendBeacon(
      '/api/analytics/collect',
      JSON.stringify({ hostId, overlay, ...(overlayId ? { overlayId } : {}) }),
    )
  } catch {
    // Beacons are best-effort.
  }
  // GA mirror (wave v8): sites with Analytics configured see overlay
  // engagement in their own property; no-op without gtag.
  try {
    ;(window as any).gtag?.('event', 'aglyn_overlay', {
      overlay_action: overlay,
      ...(overlayId ? { overlay_id: overlayId } : {}),
    })
  } catch {
    // GA is best-effort too.
  }
}

/**
 * Site-wide announcement bar (AGL-195). Dismissal is per content-hash in
 * localStorage (no cookies): editing the text re-shows the bar for
 * everyone who hid the old one.
 */
/**
 * Experiments runner (AGL-253): deterministic per-visitor assignment for
 * the screen's experiments. The first active experiment wins (one per
 * screen); its variant tree — composed server-side per variant version —
 * swaps in via canvas.setNodes on hydration. Exposures beacon on
 * assignment; the conversion listener matches the experiment's goal and
 * beacons once per pageview.
 */
function ExperimentsRunner(props: {
  hostId?: string
  experiments: ScreenExperiment[]
}) {
  const { hostId, experiments } = props

  useEffect(() => {
    if (!hostId || !experiments.length) return undefined
    const experiment = experiments[0]
    let visitorId = ''
    try {
      visitorId = localStorage.getItem('aglyn:visitor') ?? ''
      if (!visitorId) {
        visitorId = `v-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
        localStorage.setItem('aglyn:visitor', visitorId)
      }
    } catch {
      return undefined // No storage (privacy mode) — serve the default.
    }
    const variant = MarketingModel.assignExperimentVariant(
      // Wire-typed props (AGL-418); the plugin narrows its own enum.
      { status: experiment.status as never, variants: experiment.variants,
        ...(experiment.winnerVariantId
          ? { winnerVariantId: experiment.winnerVariantId }
          : {}),
        // End dates (AGL-273): past-end experiments serve the default.
        ...(experiment.endAtMs ? { endAtMs: experiment.endAtMs } : {}) },
      experiment.id,
      visitorId,
    )
    if (!variant) return undefined
    const payload = experiment.payloads[variant.id]
    if (payload) Aglyn.canvas.setNodes(payload as any)

    const beacon = (kind: 'exposure' | 'conversion') => {
      void fetch('/api/experiments/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId,
          experimentId: experiment.id,
          variantId: variant.id,
          kind,
        }),
        keepalive: true,
      }).catch(() => undefined)
      // GA mirror (wave v8): exposure/conversion events land in the
      // site's own Analytics property when configured.
      try {
        ;(window as any).gtag?.('event', 'aglyn_experiment', {
          experiment_id: experiment.id,
          variant_id: variant.id,
          experiment_action: kind,
        })
      } catch {
        // GA is best-effort.
      }
    }
    // Finished experiments serve the winner without counting stats.
    if (experiment.status !== 'running') return undefined
    beacon('exposure')

    // Goal listener — client-observable goals only; server-side goals
    // (bookings etc.) count through their own pipelines in a follow-up.
    const cleanups: Array<() => void> = []
    let converted = false
    const convert = () => {
      if (converted) return
      converted = true
      beacon('conversion')
    }
    const goal = experiment.goal?.event ?? 'formSubmission'
    if (goal === 'formSubmission') {
      const onSubmit = () => convert()
      document.addEventListener('submit', onSubmit, true)
      cleanups.push(() => document.removeEventListener('submit', onSubmit, true))
    } else if (goal === 'elementClick') {
      const selector = experiment.goal?.filter?.trim() || 'a, button'
      const onClick = (event: MouseEvent) => {
        const target = event.target as Element | null
        if (target?.closest?.(selector)) convert()
      }
      document.addEventListener('click', onClick, true)
      cleanups.push(() => document.removeEventListener('click', onClick, true))
    } else if (goal === 'scrollDepth') {
      const onScroll = () => {
        const doc = document.documentElement
        const max = doc.scrollHeight - window.innerHeight
        if (max <= 0 || (window.scrollY / max) * 100 >= 50) {
          convert()
          window.removeEventListener('scroll', onScroll)
        }
      }
      window.addEventListener('scroll', onScroll, { passive: true })
      cleanups.push(() => window.removeEventListener('scroll', onScroll))
    } else if (goal === 'timeOnPage') {
      const timer = setTimeout(convert, 30_000)
      cleanups.push(() => clearTimeout(timer))
    }
    return () => {
      for (const cleanup of cleanups) cleanup()
    }
    // Experiments are static per pageview (ISR props).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, experiments.length && experiments[0]?.id])

  return null
}

/**
 * Site-event automations engine (AGL-256/257): arms the page's triggers
 * (scroll depth, element visibility/clicks, exit intent, dwell time),
 * runs each fired action's CLIENT steps in the browser, and dispatches
 * actions with server steps to /api/events/dispatch. Every trigger fires
 * at most once per pageview.
 */
function AutomationsEngine(props: {
  hostId?: string
  automations: ClientAutomation[]
  /** Host routing map (screen id → slug) for rename-safe redirects. */
  screens?: Record<string, string>
  onShowOverlay: (overlayId: string) => void
}) {
  const { hostId, automations, screens, onShowOverlay } = props
  const showOverlayRef = useRef(onShowOverlay)
  showOverlayRef.current = onShowOverlay

  useEffect(() => {
    if (!hostId || !automations.length) return undefined
    const fired = new Set<string>()
    const cleanups: Array<() => void> = []

    const showToast = (
      message: string,
      severity: 'info' | 'success' | 'warning' | 'error',
    ) => {
      const toast = document.createElement('div')
      toast.textContent = message
      toast.setAttribute('role', 'status')
      Object.assign(toast.style, {
        position: 'fixed',
        bottom: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: '2147483000',
        padding: '10px 16px',
        borderRadius: '8px',
        fontSize: '14px',
        fontFamily: 'system-ui, sans-serif',
        color: '#fff',
        backgroundColor:
          severity === 'error'
            ? '#c62828'
            : severity === 'warning'
              ? '#e65100'
              : severity === 'success'
                ? '#2e7d32'
                : 'rgba(0, 0, 0, 0.85)',
        maxWidth: '90vw',
      })
      document.body.appendChild(toast)
      setTimeout(() => toast.remove(), 6000)
    }

    const runClientSteps = (automation: ClientAutomation) => {
      for (const step of automation.steps) {
        try {
          if (
            step.type === 'addClass' ||
            step.type === 'removeClass' ||
            step.type === 'toggleClass'
          ) {
            document.querySelectorAll(step.selector).forEach((element) => {
              if (step.type === 'addClass') {
                element.classList.add(step.className)
              } else if (step.type === 'removeClass') {
                element.classList.remove(step.className)
              } else {
                element.classList.toggle(step.className)
              }
            })
          } else if (step.type === 'stickyNav') {
            const target = document.querySelector(
              step.selector?.trim() || 'header, nav',
            )
            if (target instanceof HTMLElement) {
              target.style.position = 'sticky'
              target.style.top = '0'
              target.style.zIndex = '1100'
            }
          } else if (step.type === 'showHtml') {
            const container = document.createElement('div')
            // Sanitize (AGL-504): unlike runJs, showHtml is NOT dropped by the
            // JS entitlement gate, so raw innerHTML would let any automations-
            // tier author execute event-handler attributes (<img onerror>).
            container.innerHTML = DOMPurify.sanitize(step.html, {
              USE_PROFILES: { html: true },
              FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base'],
              FORBID_ATTR: ['srcdoc', 'formaction'],
              ALLOW_DATA_ATTR: false,
            })
            document.body.appendChild(container)
          } else if (step.type === 'runJs') {
            // Business-gated server-side (dropped from props otherwise);
            // the site owner's own code running on their own page.
            // eslint-disable-next-line no-new-func
            new Function(step.code)()
          } else if (step.type === 'redirect') {
            // Screen targets resolve through the routing map (AGL-339) so
            // slug renames never break the interaction; url is the manual
            // fallback.
            const screenSlug =
              (step as any).screenId != null
                ? screens?.[(step as any).screenId]
                : undefined
            const destination =
              screenSlug != null
                ? Aglyn.screenRoutePathToUrl(screenSlug)
                : step.url
            if (destination) window.location.assign(destination)
          } else if (step.type === 'trackGaEvent') {
            ;(window as any).gtag?.('event', step.eventName, step.params ?? {})
          } else if (step.type === 'siteAlert') {
            showToast(
              String(step.message ?? '').slice(0, 300),
              step.severity ?? 'info',
            )
          } else if (step.type === 'showOverlay') {
            if (step.overlayId) showOverlayRef.current(step.overlayId)
          }
        } catch (error) {
          console.error('automation step failed', error)
        }
      }
    }

    const fire = (automation: ClientAutomation) => {
      if (fired.has(automation.id)) return
      fired.add(automation.id)
      // Once per visitor (AGL-266): a persisted flag outlives the pageview.
      if (automation.oncePerVisitor) {
        const key = `aglyn:auto:${automation.id}`
        try {
          if (localStorage.getItem(key)) return
          localStorage.setItem(key, '1')
        } catch {
          // Storage unavailable — degrade to once per pageview.
        }
      } else if (automation.oncePerSession) {
        // Once per session (AGL-274): survives navigation, not the tab.
        const key = `aglyn:auto:${automation.id}`
        try {
          if (sessionStorage.getItem(key)) return
          sessionStorage.setItem(key, '1')
        } catch {
          // Storage unavailable — degrade to once per pageview.
        }
      } else if (automation.cooldownMinutes) {
        // Cooldown (AGL-274): a timestamp gates re-fires for the visitor.
        const key = `aglyn:auto:${automation.id}:at`
        try {
          const last = Number(localStorage.getItem(key) ?? 0)
          if (
            last &&
            Date.now() - last < automation.cooldownMinutes * 60_000
          ) {
            return
          }
          localStorage.setItem(key, String(Date.now()))
        } catch {
          // Storage unavailable — degrade to once per pageview.
        }
      }
      runClientSteps(automation)
      if (automation.hasServerSteps) {
        void fetch('/api/events/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hostId,
            actionId: automation.id,
            event: automation.event,
            payload: { path: window.location.pathname },
          }),
          keepalive: true,
        }).catch(() => undefined)
      }
    }

    for (const automation of automations) {
      const { event, selector, threshold } = automation
      if (event === 'pageVisit') {
        fire(automation)
      } else if (event === 'timeOnPage') {
        const timer = setTimeout(
          () => fire(automation),
          Math.max(1, threshold ?? 5) * 1000,
        )
        cleanups.push(() => clearTimeout(timer))
      } else if (event === 'scrollDepth') {
        const onScroll = () => {
          const doc = document.documentElement
          const max = doc.scrollHeight - window.innerHeight
          const percent = max > 0 ? (window.scrollY / max) * 100 : 100
          if (percent >= Math.min(100, Math.max(1, threshold ?? 50))) {
            fire(automation)
            window.removeEventListener('scroll', onScroll)
          }
        }
        window.addEventListener('scroll', onScroll, { passive: true })
        cleanups.push(() => window.removeEventListener('scroll', onScroll))
      } else if (event === 'elementVisible' || event === 'scrollToElement') {
        if (!selector) continue
        const targets = document.querySelectorAll(selector)
        if (!targets.length) continue
        const observer = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            fire(automation)
            observer.disconnect()
          }
        })
        targets.forEach((target) => observer.observe(target))
        cleanups.push(() => observer.disconnect())
      } else if (event === 'elementClick') {
        if (!selector) continue
        const onClick = (mouseEvent: MouseEvent) => {
          const target = mouseEvent.target as Element | null
          if (target?.closest?.(selector)) fire(automation)
        }
        document.addEventListener('click', onClick, true)
        cleanups.push(() =>
          document.removeEventListener('click', onClick, true),
        )
      } else if (event === 'exitIntent') {
        const onLeave = (mouseEvent: MouseEvent) => {
          if (mouseEvent.clientY <= 0) fire(automation)
        }
        document.addEventListener('mouseleave', onLeave)
        cleanups.push(() => document.removeEventListener('mouseleave', onLeave))
      }
    }
    return () => {
      for (const cleanup of cleanups) cleanup()
    }
    // Automations are static per pageview (ISR props).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hostId,
    screens,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(automations.map((automation) => automation.id)),
  ])

  return null
}

function AnnouncementBar(props: {
  bar: AnnouncementBarData
  hostId?: string
}) {
  const { bar, hostId } = props
  const storageKey = `aglyn-abar-${bar.contentHash}`
  const [hidden, setHidden] = useState(true)
  useEffect(() => {
    try {
      setHidden(Boolean(window.localStorage.getItem(storageKey)))
    } catch {
      setHidden(false)
    }
  }, [storageKey])
  // Impression (AGL-271): once per pageview, only when actually shown.
  useEffect(() => {
    if (!hidden) sendOverlayBeacon(hostId, 'barImpression', bar.overlayId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden])
  if (hidden) return null
  const style: CSSProperties = {
    position: 'relative',
    zIndex: 1300,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '8px 40px 8px 16px',
    fontSize: 14,
    fontFamily: 'system-ui, sans-serif',
    textAlign: 'center',
    color: bar.textColor || '#fff',
    backgroundColor: bar.backgroundColor || '#111827',
  }
  const text = bar.href ? (
    <a
      href={bar.href}
      onClick={() => sendOverlayBeacon(hostId, 'barClick', bar.overlayId)}
      style={{ color: 'inherit', textDecoration: 'underline' }}
    >
      {bar.text}
    </a>
  ) : (
    <span>{bar.text}</span>
  )
  return (
    <div role="region" aria-label="Announcement" style={style}>
      {text}
      {bar.dismissible ? (
        <button
          type="button"
          aria-label="Dismiss announcement"
          onClick={() => {
            try {
              window.localStorage.setItem(storageKey, '1')
            } catch {
              // Storage may be unavailable (private mode); hide anyway.
            }
            sendOverlayBeacon(hostId, 'barDismiss', bar.overlayId)
            setHidden(true)
          }}
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            fontSize: 16,
            lineHeight: 1,
            cursor: 'pointer',
            padding: 6,
          }}
        >
          {'✕'}
        </button>
      ) : null}
    </div>
  )
}

/**
 * Promotional popup (AGL-196). Client owns: schedule-window re-check (the
 * page is ISR-cached), trigger timing (delay/scroll/exit), and frequency
 * capping via a per-content-hash localStorage stamp (no cookies). ESC and
 * backdrop close; reduced-motion preferences skip the entrance ease.
 */
function PopupOverlay(props: {
  popup: PopupData
  hostId?: string
}) {
  const { popup, hostId } = props
  const storageKey = `aglyn-popup-${popup.contentHash}`
  const [open, setOpen] = useState(false)
  // Email capture (AGL-200): submits into the forms pipeline (inbox +
  // contacts); success suppresses the popup for ~10 years.
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (open) sendOverlayBeacon(hostId, 'popupImpression', popup.overlayId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hostId])

  useEffect(() => {
    const now = Date.now()
    if (popup.startAtMs && now < popup.startAtMs) return
    if (popup.endAtMs && now > popup.endAtMs) return
    try {
      const stamp = Number(window.localStorage.getItem(storageKey) ?? 0)
      if (stamp && now - stamp < popup.frequencyDays * 86400000) return
    } catch {
      // Storage unavailable: show at most per-pageview.
    }
    let cleanup: (() => void) | undefined
    if (popup.trigger === 'scroll') {
      const threshold = Math.min(100, Math.max(0, popup.triggerValue)) / 100
      const onScroll = () => {
        const height =
          document.documentElement.scrollHeight - window.innerHeight
        if (height <= 0 || window.scrollY / height >= threshold) {
          setOpen(true)
        }
      }
      window.addEventListener('scroll', onScroll, { passive: true })
      cleanup = () => window.removeEventListener('scroll', onScroll)
    } else if (popup.trigger === 'exit') {
      const onLeave = (event: MouseEvent) => {
        if (event.clientY <= 0) setOpen(true)
      }
      document.addEventListener('mouseout', onLeave)
      cleanup = () => document.removeEventListener('mouseout', onLeave)
    } else {
      const timer = window.setTimeout(
        () => setOpen(true),
        Math.max(0, popup.triggerValue) * 1000,
      )
      cleanup = () => window.clearTimeout(timer)
    }
    return cleanup
  }, [popup, storageKey])

  const close = (kind: 'popupDismiss' | 'popupClick' = 'popupDismiss') => {
    try {
      window.localStorage.setItem(storageKey, String(Date.now()))
    } catch {
      // Private mode etc. — closing still works for this pageview.
    }
    sendOverlayBeacon(hostId, kind, popup.overlayId)
    setOpen(false)
  }

  const handleEmailSubmit = async () => {
    const value = email.trim()
    if (!value || submitted) return
    try {
      await fetch('/api/forms/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId,
          formName: 'Popup',
          fields: { email: value },
          path: window.location.pathname,
          website: '',
        }),
      })
    } catch {
      // Best-effort — still thank the visitor.
    }
    setSubmitted(true)
    try {
      // Far-future stamp: a successful capture never re-prompts.
      window.localStorage.setItem(
        storageKey,
        String(Date.now() + 315360000000),
      )
    } catch {
      // Ignore.
    }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null
  return (
    <div
      onClick={() => close()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={popup.headline || 'Announcement'}
        onClick={(event) => event.stopPropagation()}
        style={{
          maxWidth: 420,
          width: '100%',
          background: '#fff',
          color: '#111827',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.35)',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
        }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={() => close()}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            border: 'none',
            background: 'rgba(255, 255, 255, 0.85)',
            borderRadius: '50%',
            width: 28,
            height: 28,
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          {'✕'}
        </button>
        {popup.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={popup.imageUrl}
            alt=""
            style={{
              width: '100%',
              maxHeight: 200,
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : null}
        <div style={{ padding: 24, textAlign: 'center' }}>
          {popup.headline ? (
            <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>
              {popup.headline}
            </h2>
          ) : null}
          <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>
            {popup.body}
          </p>
          {popup.collectEmail ? (
            <div style={{ marginTop: 16 }}>
              {submitted ? (
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                  {'Thanks — you are on the list!'}
                </p>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void handleEmailSubmit()
                  }}
                  style={{ display: 'flex', gap: 8, justifyContent: 'center' }}
                >
                  <input
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    style={{
                      flex: 1,
                      maxWidth: 240,
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid #d1d5db',
                      fontSize: 14,
                    }}
                  />
                  <button
                    type="submit"
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: 'none',
                      background: '#111827',
                      color: '#fff',
                      fontSize: 14,
                      cursor: 'pointer',
                    }}
                  >
                    {'Sign up'}
                  </button>
                </form>
              )}
            </div>
          ) : null}
          {popup.ctaHref && popup.ctaLabel ? (
            <a
              href={popup.ctaHref}
              onClick={() => close('popupClick')}
              style={{
                display: 'inline-block',
                marginTop: 16,
                padding: '10px 24px',
                borderRadius: 8,
                background: '#111827',
                color: '#fff',
                textDecoration: 'none',
                fontSize: 14,
              }}
            >
              {popup.ctaLabel}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  )
}


/**
 * The marketing plugin's site runtime (AGL-419), relocated verbatim from
 * the tenant catch-all: announcement bar + popup rendering (AGL-195/200),
 * the experiments runner (AGL-253), the site-event automations engine
 * (AGL-256/257), and automation-triggered overlays. Reads back exactly the
 * page-props slices its server enricher wrote (site-contract shapes).
 */
export function MarketingSiteRuntime({ hostId, screens, page }: SiteRuntimeProps) {
  const [automationOverlay, setAutomationOverlay] = useState<any>(null)
  const announcementBar = page['announcementBar'] as AnnouncementBarData | null
  const popup = page['popup'] as PopupData | null
  const experiments = (page['experiments'] ?? []) as ScreenExperiment[]
  const clientAutomations = (page['clientAutomations'] ?? []) as ClientAutomation[]
  const automationOverlays = page['automationOverlays'] as Record<string, any> | null

  return (
    <>
      {announcementBar ? (
        <AnnouncementBar bar={announcementBar} hostId={hostId} />
      ) : null}
      {popup ? <PopupOverlay popup={popup} hostId={hostId} /> : null}
      {/* Screen/section experiments (AGL-253). */}
      {experiments.length ? (
        <ExperimentsRunner hostId={hostId} experiments={experiments} />
      ) : null}
      {/* Site-event automations (AGL-256/257). */}
      {clientAutomations.length ? (
        <AutomationsEngine
          hostId={hostId}
          automations={clientAutomations}
          screens={screens}
          onShowOverlay={(overlayId) => {
            const overlay = automationOverlays?.[overlayId]
            if (overlay) setAutomationOverlay({ id: overlayId, ...overlay })
          }}
        />
      ) : null}
      {automationOverlay?.kind === 'bar' && automationOverlay.bar?.text ? (
        <AnnouncementBar
          bar={{
            ...automationOverlay.bar,
            text: String(automationOverlay.bar.text),
            dismissible: automationOverlay.bar.dismissible !== false,
            contentHash: `automation-${automationOverlay.id}`,
          }}
          hostId={hostId}
        />
      ) : null}
      {automationOverlay?.kind === 'popup' && automationOverlay.popup?.body ? (
        <PopupOverlay
          popup={{
            ...automationOverlay.popup,
            body: String(automationOverlay.popup.body),
            trigger: 'delay',
            triggerValue: 0,
            frequencyDays: Math.max(
              1,
              Number(automationOverlay.popup.frequencyDays ?? 1),
            ),
            contentHash: `automation-${automationOverlay.id}`,
          }}
          hostId={hostId}
        />
      ) : null}
    </>
  )
}
