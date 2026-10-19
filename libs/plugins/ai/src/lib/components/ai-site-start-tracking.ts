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

'use client'

import { trackEvent, type AnalyticsEventName, type AnalyticsEventParams } from '@aglyn/aglyn/app-utils/analytics-events'
import { useEffect, useRef } from 'react'
import {
  AI_SITE_START_STEPS,
  aiSiteStartStepIndex,
  type AiSiteStartErrorCode,
  type AiSiteStartField,
  type AiSiteStartStep,
} from '../model/ai-site-start-steps'

/**
 * Where people get lost in the guided start (AGL-3898), as the console's own
 * product analytics: each step drawn, left forward or back and how long it
 * took, the step the start was abandoned on, the field a step refused on,
 * and the signs of a struggle — one field changed again and again, a step
 * left idle, fast repeated clicks on one spot (rage) and clicks on words, a
 * picture or an icon in the form that do nothing (dead). A click on empty
 * space or on a popup's backdrop is not a dead click (2026-10-18).
 *
 * Every event goes through `trackEvent`, the one door the console's GA4
 * taxonomy has, so it is consent-gated exactly as every other console event
 * is (`firebase-app.layout.tsx` registers the transport, or the refusal that
 * drops it) and its params are sanitized there too. What is sent is only ever
 * a step id, a field id, a closed error code, a closed area id, a count or a
 * duration: never anything typed, picked or named.
 *
 * The detector is a plain object over a clock and a timer so its rules are
 * tested with fake timers; {@link useAiSiteStartTracking} binds it to the
 * dialog.
 */

/** No input on a step for this long is a struggle. */
export const AI_SITE_START_IDLE_MS = 30_000
/** This many clicks on one spot… */
export const AI_SITE_START_RAGE_CLICKS = 3
/** …within this long… */
export const AI_SITE_START_RAGE_WINDOW_MS = 700
/** …and within this distance of the first, is rage. */
export const AI_SITE_START_RAGE_RADIUS_PX = 30
/** One field changed this many times is a struggle. */
export const AI_SITE_START_STRUGGLE_EDITS = 3
/** At most this many dead clicks are reported on one visit to a step. */
export const AI_SITE_START_DEAD_CLICKS_PER_STEP = 3

/** Why the start was left without a site started. */
export type AiSiteStartAbandonReason = 'skip' | 'close' | 'unload' | 'route'

type Send = <K extends AnalyticsEventName>(name: K, params: AnalyticsEventParams[K]) => void

export interface AiSiteStartTrackerOptions {
  send?: Send
  now?: () => number
  /** Whether the page is out of sight, when an idle step is not a struggle. */
  hidden?: () => boolean
}

/** A click as the detector reads it: where, and what it landed on. */
export interface AiSiteStartClick {
  x: number
  y: number
  /** Whether it landed on something that acts on a click. */
  interactive: boolean
  /** The closed id of the part of the form it landed in. */
  area: string
  /**
   * Whether it landed on nothing a person could mistake for a control: empty
   * space, a popup's backdrop (the click that closes a menu or a help
   * popover), or anything outside the form's named parts. A blank click is
   * never a dead click.
   */
  blank?: boolean
}

export interface AiSiteStartTracker {
  /** A step was drawn. */
  view(step: AiSiteStartStep): void
  /** The person went forward from the step on screen. */
  complete(): void
  /** The person went back from the step on screen. */
  back(): void
  /** A step refused to go forward on a field. */
  fieldError(field: AiSiteStartField, code: AiSiteStartErrorCode): void
  /** A text answer changed; counted as one edit when the field is left. */
  fieldChanged(field: AiSiteStartField): void
  /** A text answer was left. */
  fieldLeft(field: AiSiteStartField): void
  /** A choice was picked: input, but not an edit (comparing cards is not a struggle). */
  fieldPicked(field: AiSiteStartField): void
  /** The step's "More details" was opened (AGL-3979). */
  moreDetails(): void
  /**
   * The site was asked for with these optional extras given (AGL-3979): one
   * event a field, naming the step that asks it, never what was typed.
   */
  detailsGiven(fields: ReadonlyArray<{ step: AiSiteStartStep; field: AiSiteStartField }>): void
  /** Any input on the step, which puts off the idle signal. */
  activity(): void
  /** A click anywhere in the dialog. */
  click(click: AiSiteStartClick): void
  /** The start was left without a site started; reported once. */
  abandon(reason: AiSiteStartAbandonReason): void
  /** A site was started (or the starter chosen): nothing after it is an abandonment. */
  finish(): void
  /** Stops the idle timer. */
  dispose(): void
}

export function createAiSiteStartTracker(options: AiSiteStartTrackerOptions = {}): AiSiteStartTracker {
  const send: Send = options.send ?? ((name, params) => trackEvent(name, params))
  const now = options.now ?? (() => Date.now())
  const hidden = options.hidden ?? (() => typeof document !== 'undefined' && document.visibilityState === 'hidden')
  const opened = now()
  let step: AiSiteStartStep | null = null
  let enteredAt = opened
  let done = false
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let idleReported = false
  let deadClicks = 0
  let burst: { x: number; y: number; at: number; count: number; reported: boolean } | null = null
  const edits = new Map<AiSiteStartField, number>()
  const dirty = new Set<AiSiteStartField>()
  const struggled = new Set<AiSiteStartField>()

  const index = () => (step ? aiSiteStartStepIndex(step) : 0)
  const spent = () => Math.max(0, Math.round(now() - enteredAt))
  const stopIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
  }
  const armIdle = () => {
    stopIdle()
    if (done || !step || idleReported) return
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (done || !step || idleReported || hidden()) return
      idleReported = true
      send('site_start_struggle', { step, signal: 'idle', duration_ms: AI_SITE_START_IDLE_MS })
    }, AI_SITE_START_IDLE_MS)
  }
  const edited = (field: AiSiteStartField) => {
    if (!step) return
    const count = (edits.get(field) ?? 0) + 1
    edits.set(field, count)
    if (count >= AI_SITE_START_STRUGGLE_EDITS && !struggled.has(field)) {
      struggled.add(field)
      send('site_start_struggle', { step, signal: 'edits', field, count })
    }
  }

  return {
    view(next) {
      if (done) return
      step = next
      enteredAt = now()
      idleReported = false
      deadClicks = 0
      burst = null
      send('site_start_step_viewed', { step: next, step_index: aiSiteStartStepIndex(next), step_count: AI_SITE_START_STEPS.length })
      armIdle()
    },
    complete() {
      if (done || !step) return
      send('site_start_step_completed', { step, step_index: index(), duration_ms: spent() })
    },
    back() {
      if (done || !step) return
      send('site_start_step_back', { step, step_index: index(), duration_ms: spent() })
    },
    fieldError(field, code) {
      if (done || !step) return
      send('site_start_field_error', { step, field, error: code })
    },
    fieldChanged(field) {
      dirty.add(field)
    },
    fieldLeft(field) {
      if (!dirty.delete(field)) return
      edited(field)
    },
    fieldPicked() {
      // Picking card after card is how a person compares styles or kinds; it
      // read as "one answer changed again and again" (2026-10-18) and is not.
      // Only a typed answer rewritten is a struggle.
      armIdle()
    },
    moreDetails() {
      if (done || !step) return
      send('site_start_more_details', { step })
      armIdle()
    },
    detailsGiven(fields) {
      if (done) return
      for (const { step: at, field } of fields) send('site_start_detail_given', { step: at, field })
    },
    activity() {
      armIdle()
    },
    click(click) {
      if (done || !step) return
      const at = now()
      const near =
        burst &&
        at - burst.at <= AI_SITE_START_RAGE_WINDOW_MS &&
        Math.hypot(click.x - burst.x, click.y - burst.y) <= AI_SITE_START_RAGE_RADIUS_PX
      if (near && burst) {
        burst.count += 1
        if (burst.count >= AI_SITE_START_RAGE_CLICKS && !burst.reported) {
          burst.reported = true
          send('site_start_rage_click', { step, area: click.area, clicks: burst.count })
        }
      } else {
        burst = { x: click.x, y: click.y, at, count: 1, reported: false }
      }
      if (!click.interactive && !click.blank && deadClicks < AI_SITE_START_DEAD_CLICKS_PER_STEP) {
        deadClicks += 1
        send('site_start_dead_click', { step, area: click.area })
      }
      armIdle()
    },
    abandon(reason) {
      if (done) return
      done = true
      stopIdle()
      const at = step ?? AI_SITE_START_STEPS[0]
      send('site_start_abandoned', {
        step: at,
        step_index: aiSiteStartStepIndex(at),
        reason,
        duration_ms: spent(),
        total_ms: Math.max(0, Math.round(now() - opened)),
      })
    },
    finish() {
      done = true
      stopIdle()
    },
    dispose() {
      stopIdle()
    },
  }
}

/** What clicking acts on: a click on anything else in the form is a dead click. */
const INTERACTIVE = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  '[role="button"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="link"]',
  '[role="combobox"]',
  '[role="menuitem"]',
  '[role="slider"]',
  '[contenteditable="true"]',
  '.MuiInputBase-root',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** The attribute naming the part of the form an element is in (a closed id, never content). */
export const AI_SITE_START_AREA_ATTRIBUTE = 'data-start-area'

/** A popup's backdrop (a menu's, a select's, a help popover's): a click on it closes the popup. */
const BACKDROP = '.MuiBackdrop-root'

/**
 * Whether an element is something a person sees and might click: its own
 * words, a picture or an icon. A bare layout box (the space around and
 * between things) is not.
 */
function isContent(element: Element): boolean {
  if (element.closest('img, svg, picture, video, canvas')) return true
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 3 && (node.textContent ?? '').trim()) return true
  }
  return false
}

/** A DOM click, as the detector reads it. */
export function aiSiteStartClickOf(event: { clientX: number; clientY: number; target: EventTarget | null }): AiSiteStartClick {
  const target = event.target instanceof Element ? event.target : null
  const named = target?.closest(`[${AI_SITE_START_AREA_ATTRIBUTE}]`) ?? null
  const area = named?.getAttribute(AI_SITE_START_AREA_ATTRIBUTE) ?? 'form'
  const blank = !target || !named || Boolean(target.closest(BACKDROP)) || !isContent(target)
  return { x: event.clientX, y: event.clientY, interactive: Boolean(target?.closest(INTERACTIVE)), area, blank }
}

/**
 * The tracker for one open guided start: views each step as it is drawn, and
 * reports the start abandoned when the tab goes away or the page changes
 * under it. A start that is finished ({@link AiSiteStartTracker.finish}) or
 * already abandoned reports nothing more.
 *
 * The unmount report waits a tick, so a development double mount (React's
 * StrictMode runs an effect's cleanup and then the effect again) is not read
 * as the person leaving.
 */
export function useAiSiteStartTracking(step: AiSiteStartStep | null, active: boolean): AiSiteStartTracker {
  const ref = useRef<AiSiteStartTracker | null>(null)
  if (!ref.current) ref.current = createAiSiteStartTracker()
  const tracker = ref.current
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (active && step) tracker.view(step)
  }, [active, step, tracker])

  useEffect(() => {
    if (!active) return
    if (leaving.current) clearTimeout(leaving.current)
    leaving.current = null
    const onPageHide = () => tracker.abandon('unload')
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      leaving.current = setTimeout(() => {
        tracker.abandon('route')
        tracker.dispose()
      }, 0)
    }
  }, [active, tracker])

  return tracker
}
