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

// NO `'use client'` here, and it is a lint rule rather than a preference
// (AGL-52): a directive inside `@aglyn/aglyn` makes the bundler split a
// duplicate module graph, and the second canvas/emitter singleton renders the
// tenant site blank. Every component that mounts this one carries the
// directive itself, which is where the client boundary belongs.
//
// Deep app-utils modules, never the `@aglyn/aglyn` barrel (AGL-1550): this
// file is reached from `site-analytics.tsx`, whose import closure
// `site-analytics-independence.spec.ts` walks and which must stay independent
// of the site-plugin gate.
import {
  ADVERTISING_TAG_ATTRIBUTE,
  type ResolvedAdvertisingTag,
  restoreAdvertisingTags,
  revokeAdvertisingTags,
} from './advertising-tags'
import { VISITOR_CONSENT_CHANGED_EVENT } from './visitor-consent'
import Script from 'next/script'
import { Fragment, useEffect, useRef, type ReactElement } from 'react'

/**
 * The MOUNT and the WITHDRAWAL for consent-gated advertising tags, with no
 * opinion about where the verdict came from.
 *
 * ## Why this is a shared component and not a second copy per surface
 *
 * Aglyn runs advertising tags on three first-party surfaces and they resolve
 * consent through three different mechanisms: the tenant runtime reads a host
 * document and a per-host record, the console reads the platform record its
 * own posture machinery wrote, and the docs site reads the registrable-domain
 * mirror of that record. Those are genuinely different questions.
 *
 * What is NOT different is what happens once the answer is known: mount an
 * inline boot and a library per vendor, and — the half that is easy to forget
 * and impossible to retrofit — stop them the moment the answer changes. A
 * second copy of that half is how one surface comes to keep firing after
 * consent is withdrawn on another, because the copy that was not updated
 * still looks exactly like the one that was.
 *
 * So the verdict is a PROP and the machinery is shared. Each surface answers
 * its own question with its own resolver; none of them owns a teardown.
 *
 * ## Why it renders even when the answer is no
 *
 * Because the withdrawal path needs a listener. A visitor who accepts and then
 * turns advertising off must stop being tracked in THAT pageview, and by then
 * the vendor library has executed — React dropping the `<Script>` does not
 * unload it (AGL-1608). So this component stays mounted whenever the surface
 * participates at all, and subscribes to
 * {@link VISITOR_CONSENT_CHANGED_EVENT}; the teardown runs from the event,
 * synchronously with the visitor's click, rather than waiting on a re-render.
 *
 * Both paths run and they agree, which is deliberate: the render gate is what
 * keeps the tag out of a fresh pageview, the listener is what removes one that
 * is already there, and neither can do the other's job.
 */
export interface AdvertisingTagMountsProps {
  /**
   * Whether this surface participates in the gate AT ALL.
   *
   * False installs nothing — no listener, no scripts. That is the clause that
   * keeps the tenant runtime's teardown off a customer's site: we did not load
   * their pixel, we do not know what basis it runs on, and reaching into their
   * page to kill it would be its own breach. `revokeAdvertisingTags` is
   * additionally attribute-scoped, so there are two independent scopes.
   */
  readonly active: boolean
  /** The verdict for THIS render: the tags that may exist right now. */
  readonly tags: readonly ResolvedAdvertisingTag[]
  /**
   * Re-read the verdict from live state, for the withdrawal listener.
   *
   * A callback rather than the `tags` prop, because the listener fires from
   * the visitor's own click in the same tick as the record is written — the
   * props for the current render are by definition the state before it.
   */
  readonly resolve: () => readonly ResolvedAdvertisingTag[]
  /**
   * The request's CSP nonce, stamped onto BOTH elements of every pair.
   *
   * A surface that enforces a nonce'd `script-src` refuses an inline script
   * that does not carry it, and the boot half of every pair is inline. Next's
   * `<Script>` stamps a nonce only when one reaches it: the automatic path
   * reads `HeadManagerContext`, and the App Router's client provider carries
   * no nonce at all — so a pair mounted after hydration, which is the only
   * time this component ever mounts one, is unnonced unless the caller hands
   * the value down. An explicit prop wins inside `next/script`
   * (`restProps.nonce || nonce`), which is what makes this the one door.
   *
   * The failure without it is silent and lopsided: the library beside the
   * boot has a `src` the policy allows, so the vendor's code loads and runs
   * against an account nobody configured, and the conversions this surface
   * sends are lost with nothing in the page but a CSP violation.
   *
   * Absent on a surface that sends no `script-src`: nothing is stamped, and
   * nothing is refused.
   */
  readonly nonce?: string
  /**
   * Libraries the HOST PAGE mounts itself, named by the needle a vendor
   * declares in `sharesLibrary` (AGL-2681).
   *
   * {@link sharedLibraryPresent} reads the document at render time, and that
   * is the right instrument for a loader some other party put there. It is
   * the wrong one for a loader the SAME render is about to create. On the
   * tenant the GA pair and this component both wait on `consent.ready`, so
   * the first render that may emit either emits both — GA's `<Script>` is not
   * in the document yet when this component looks, the check honestly says
   * "absent", and the visitor downloads `gtag.js` twice: once as ours with
   * `?id=AW-…`, once as gtag's own destination fetch for the `config` that
   * follows. Measured on `aglyn.com/solutions/small-business` with
   * advertising granted: two 147 KiB loaders for one account.
   *
   * A page that KNOWS it renders the library says so here, from the same
   * condition that renders it, and the document check stays as the fallback
   * for loaders it does not know about. Naming the needle rather than passing
   * a boolean keeps the declaration per library: a page that mounts gtag has
   * said nothing about the Meta pixel.
   */
  readonly sharedLibraries?: readonly string[]
}

/**
 * Is a library matching `needle` already in the document?
 *
 * Read at RENDER time rather than in an effect: the decision is whether to
 * emit a `<Script>` at all, and by the time an effect could answer, Next has
 * already appended it. `document` is guarded because this component renders on
 * the server too, where nothing is mounted and the honest answer is "no" — the
 * client render then re-evaluates with the real document.
 *
 * Blind to a loader the current render is creating alongside this one — see
 * `sharedLibraries` on the props for the case that needs the page to say so.
 */
export function sharedLibraryPresent(needle: string): boolean {
  if (typeof document === 'undefined') return false
  try {
    return Boolean(document.querySelector(`script[src*="${needle}"]`))
  } catch {
    // A hostile or absent DOM: assume nothing is mounted, which mounts our
    // own copy — the cost is a duplicate fetch, never a missing tag.
    return false
  }
}

export default function AdvertisingTagMounts({
  active,
  tags,
  resolve,
  nonce,
  sharedLibraries,
}: AdvertisingTagMountsProps): ReactElement | null {
  /** Declared by the page, or found in the document: either means "ride it". */
  const libraryProvided = (needle: string): boolean =>
    (sharedLibraries?.includes(needle) ?? false) || sharedLibraryPresent(needle)
  /*
   * The resolver is held in a ref rather than listed as an effect dependency.
   *
   * Every caller passes a closure over its own live consent state, so the
   * function identity changes on every render; depending on it would tear the
   * listener down and re-install it each time, and a withdrawal that landed in
   * that window would find no subscriber. The ref makes the subscription's
   * lifetime `active`, which is the only thing that genuinely changes it,
   * while the callback it invokes is always the newest one.
   */
  const resolveRef = useRef(resolve)
  resolveRef.current = resolve

  useEffect(() => {
    if (!active) return undefined
    const sync = () => {
      if (resolveRef.current().length === 0) {
        revokeAdvertisingTags()
      } else {
        // Symmetric: a visitor who withdrew and changed their mind inside one
        // pageview would otherwise stay un-tracked until they navigated,
        // because a re-rendered `<Script>` cannot re-execute a library the
        // browser already ran.
        restoreAdvertisingTags()
      }
    }
    window.addEventListener(VISITOR_CONSENT_CHANGED_EVENT, sync)
    return () => window.removeEventListener(VISITOR_CONSENT_CHANGED_EVENT, sync)
  }, [active])

  if (!active || tags.length === 0) return null

  return (
    <>
      {tags.map(({ vendor, accountId }) => (
        // A PAIR per vendor, inline boot first and library second — the same
        // shape as the GA `ga-init` / `ga-src` pair, and for the same reason:
        // the boot defines the vendor's queue shim and declares the consent
        // state, so nothing the library later drains was queued under a state
        // nobody chose. Both elements carry the teardown's scope marker; only
        // elements carrying it are ever revoked, removed or cookie-swept.
        <Fragment key={vendor.id}>
          <Script
            id={`ad-tag-${vendor.id}-init`}
            strategy="afterInteractive"
            nonce={nonce}
            {...{ [ADVERTISING_TAG_ATTRIBUTE]: vendor.id }}
          >
            {vendor.bootSnippet ? vendor.bootSnippet(accountId) : ''}
          </Script>
          {/* Skipped when another loader already brought this library in
              (AGL-1152). Google Ads shares `gtag.js` with the GA4 measurement
              id and with a GTM container, so a surface with both configured
              would fetch it twice and define `gtag()` twice — and the boot
              above would be the second voice in a consent conversation the
              first one already had. One library, several `config` calls, is
              how gtag carries several products. The page's own declaration is
              consulted first (AGL-2681): the document cannot yet show a loader
              this same render is creating. */}
          {vendor.sharesLibrary && libraryProvided(vendor.sharesLibrary) ? null : (
            <Script
              id={`ad-tag-${vendor.id}-src`}
              strategy="afterInteractive"
              nonce={nonce}
              {...{ [ADVERTISING_TAG_ATTRIBUTE]: vendor.id }}
              // `scriptSrcFor` where the vendor has one: gtag reads the
              // container out of the loader's query, so the copy we bring
              // ourselves has to name the account. See `scriptSrcFor`.
              src={
                vendor.scriptSrcFor
                  ? vendor.scriptSrcFor(accountId)
                  : vendor.scriptSrc
              }
            />
          )}
        </Fragment>
      ))}
    </>
  )
}
