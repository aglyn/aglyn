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

import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Button } from '@mui/material'
import { useCallback, useEffect, useRef } from 'react'

/**
 * Wraps a reload so it can happen at most once (AGL-1055).
 *
 * `controllerchange` can fire more than once, and reloading on each gives a
 * page that reloads forever — the classic bug in this exact code, and the
 * reason this is a named unit rather than a boolean buried in a callback: it
 * is the part worth testing on its own, and `window.location.reload` cannot be
 * intercepted under jsdom.
 */
export function createReloadOnce(
  reload: () => void = () => window.location.reload(),
): () => void {
  let done = false
  return () => {
    if (done) return
    done = true
    reload()
  }
}

/** Scope `/`, so the worker can later cover the whole origin (AGL-1053). */
export const SERVICE_WORKER_URL = '/sw.js'

/**
 * Registers the console's service worker and offers its updates (AGL-1053,
 * AGL-1055).
 *
 * Renders nothing. Mounted once from the root layout so registration happens
 * on any entry point rather than only the pages someone remembered to wire.
 *
 * ## Production only, and not for convenience
 *
 * Under `next dev` a service worker mostly gets in the way: chunks are served
 * unhashed and regenerated constantly, so a worker that caches anything serves
 * yesterday's build, and even one that does not adds a lifecycle to every
 * reload. Worse, it OUTLIVES the dev server — a worker registered on
 * `localhost:4200` stays registered against whatever the next project to use
 * that port is. Hence the guard, and hence the teardown steps in
 * `docs/E2E_LOCAL.md`.
 *
 * Verified against a production build for the same reason: registration, scope
 * and update behaviour all differ under dev, so a dev-only smoke test proves
 * nothing about what ships.
 *
 * Failure is deliberately quiet. Registration is an enhancement — an
 * unsupported browser, a private window, or a blocked request must leave the
 * console working exactly as it does today, which is also the property that
 * makes this baseline safe to land ahead of anything that depends on it.
 */
export function ServiceWorkerRegistrar() {
  const { enqueueSnackbar, closeSnackbar } = useSnackbar()
  // Exactly-once reload guard. `controllerchange` can fire more than once,
  // and reloading on each is the classic reload LOOP in this exact code —
  // the page reloads, registers, sees a controller change, reloads again.
  const reloadOnce = useRef(createReloadOnce())
  const prompted = useRef(false)

  /** Promote the waiting worker, then reload once it takes over. */
  const acceptUpdate = useCallback((waiting: ServiceWorker) => {
    // The reload is driven by `controllerchange`, not by a timer: the new
    // worker must be in control before the page reloads, or the reload just
    // re-renders the old build and the prompt comes straight back.
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => reloadOnce.current(),
      { once: true },
    )
    waiting.postMessage({ type: 'SKIP_WAITING' })
  }, [])

  const offerUpdate = useCallback(
    (waiting: ServiceWorker) => {
      if (prompted.current) return
      prompted.current = true
      enqueueSnackbar('A new version of the console is available.', {
        variant: 'info',
        // Never auto-hides and never steals focus: the point is that the old
        // build KEEPS WORKING. Someone mid-edit should be able to ignore this
        // indefinitely and finish what they were doing.
        persist: true,
        action: (snackbarId) => (
          <Button
            size="small"
            color="inherit"
            onClick={() => {
              closeSnackbar(snackbarId)
              acceptUpdate(waiting)
            }}
          >
            {'Reload'}
          </Button>
        ),
      })
    },
    [enqueueSnackbar, closeSnackbar, acceptUpdate],
  )

  /**
   * Safety net for an update that slipped through anyway (AGL-1055).
   *
   * A page that has been open across a deploy can lazy-load a route chunk from
   * the build it started on and find it gone — `ChunkLoadError`, mid-task,
   * with no explanation. The prompt above is the polite path; this is the one
   * that catches the case where nobody took it.
   *
   * Deliberately NOT a root error boundary. The console has none today, so
   * adding one here would change what every client error renders as, app-wide,
   * to fix one specific failure. A chunk failure surfaces as an unhandled
   * rejection, so listening for it costs nothing and changes nothing else.
   */
  useEffect(() => {
    const isChunkError = (value: unknown): boolean => {
      const error = value as { name?: string; message?: string } | null
      const text = `${error?.name ?? ''} ${error?.message ?? ''}`
      return /ChunkLoadError|Loading chunk .* failed|Importing a module script failed/i.test(
        text,
      )
    }
    const offerReload = () => {
      if (prompted.current) return
      prompted.current = true
      enqueueSnackbar(
        'This page is running an older version of the console and could not ' +
          'load part of it.',
        {
          variant: 'warning',
          persist: true,
          action: () => (
            <Button
              size="small"
              color="inherit"
              onClick={() => reloadOnce.current()}
            >
              {'Reload'}
            </Button>
          ),
        },
      )
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isChunkError(event.reason)) offerReload()
    }
    const onError = (event: ErrorEvent) => {
      if (isChunkError(event.error)) offerReload()
    }
    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('error', onError)
    return () => {
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('error', onError)
    }
  }, [enqueueSnackbar])

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }
    let cancelled = false
    // After `load` so registration never competes with the first paint for
    // bandwidth — the worker does nothing yet, so it has nothing to be early
    // for.
    const register = () => {
      if (cancelled) return
      navigator.serviceWorker
        .register(SERVICE_WORKER_URL, { scope: '/' })
        .then((registration) => {
          if (cancelled) return
          // Already waiting when we arrived — a build shipped while this tab
          // was closed, or on a previous page of this session.
          //
          // Gated on `controller` for the same reason as the `updatefound`
          // path below: with no controller this page is not being served by a
          // worker at all, so there is no current version for the waiting one
          // to replace and nothing to interrupt anyone about. Without this the
          // first-ever install prompts, which is how people learn to dismiss
          // the notice without reading it.
          if (registration.waiting && navigator.serviceWorker.controller) {
            offerUpdate(registration.waiting)
          }
          registration.addEventListener('updatefound', () => {
            const installing = registration.installing
            if (!installing) return
            installing.addEventListener('statechange', () => {
              // `installed` WITH an existing controller means an update.
              // Without a controller it is the first-ever install, which is
              // not something to interrupt anyone about.
              if (
                installing.state === 'installed' &&
                navigator.serviceWorker.controller
              ) {
                offerUpdate(installing)
              }
            })
          })
        })
        .catch((error) => {
          // Named so a registration failure is greppable rather than silent —
          // the whole point of AGL-1053 is that later issues can assume this
          // works.
          console.warn(
            '[sw] registration failed',
            (error as { message?: string })?.message ?? error,
          )
        })
    }
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
    return () => {
      cancelled = true
      window.removeEventListener('load', register)
    }
  }, [offerUpdate])

  return null
}

export default ServiceWorkerRegistrar
