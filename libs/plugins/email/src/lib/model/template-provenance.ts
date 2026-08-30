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
 * WHOSE TEMPLATE IS THIS, AND IS IT STILL ANY GOOD.
 *
 * An email template is a besigner document, and the org reading it is not
 * necessarily the org that wrote it: a template can be installed from a
 * marketplace listing, in which case its content is versioned by somebody
 * else and can be updated, rejected or withdrawn by a party outside this
 * workspace. A surface that assumes every template is locally authored and
 * permanently valid reads an installed one as if the org owned it.
 *
 * ## Provenance is not re-derived here
 *
 * {@link resolveProvenance} in core is the ONE reader of where an installed
 * artifact came from, and it already tolerates every shape the install routes
 * have written. This module asks it and adds nothing to it; a second reading
 * of `installedFrom` would be a second answer to the same question.
 *
 * ## Standing is a fact about the LISTING, not about the install
 *
 * Whether a publisher has withdrawn a template, or had it rejected on
 * re-review, is recorded on the marketplace listing. This page does not read
 * listings — that would be a marketplace read on every template opened, for a
 * fact that is usually "fine" — so an installed template's standing is
 * `unread` unless the install path stamped an answer onto the document.
 *
 * `unread` is deliberately not `ok`. The difference is the whole reason this
 * type has four states rather than a boolean: "we checked and it is fine" and
 * "we did not check" lead a reader to the same action only when they are
 * lucky, and a template that was killed upstream is exactly the unlucky case.
 */

/*
 * The MODULE, not the barrel. `@aglyn/aglyn` re-exports the app-utils index,
 * which reaches `enabled-plugins-context` and therefore React — and this
 * model is imported by `email-events.ts`, which runs in the plugin API route's
 * SERVER graph. Through the barrel that is a client-only module pulled into a
 * server bundle, which `app-router-graph.spec.ts` refuses.
 */
import {
  resolveProvenance,
  type ResolvedProvenance,
} from '@aglyn/aglyn/app-utils/marketplace-provenance'

/** Where a template's content comes from. */
export type TemplateOrigin = 'local' | 'installed'

/**
 * How this template stands with whoever publishes it.
 *
 * The three non-`local` values are read from what the install path stamped;
 * none of them is computed here, because computing any of them means reading
 * the listing.
 */
export type TemplateStanding =
  /** Authored in this org. There is no publisher to stand with. */
  | 'local'
  /** Installed, and the publisher's current standing has not been read. */
  | 'unread'
  /** Installed, and recorded as still offered by its publisher. */
  | 'offered'
  /** Installed, and recorded as withdrawn, killed or rejected upstream. */
  | 'withdrawn'

export interface TemplateProvenance {
  origin: TemplateOrigin
  standing: TemplateStanding
  /** The core resolver's answer, verbatim. Null for a local template. */
  installed: ResolvedProvenance | null
  /**
   * One line for the reader, or null when there is nothing worth saying.
   *
   * A local template gets `null`: "you wrote this" is the default assumption
   * and repeating it on every page is noise. Everything else says what is
   * known and, where it matters, what is not.
   */
  note: string | null
  /**
   * This template should not be sent without checking with its publisher
   * first. Only ever true for `withdrawn`, and the surface renders it as a
   * warning rather than hiding the template: a message already scheduled
   * against it is a fact the reader has to be able to see.
   */
  warn: boolean
}

/** The stamped standing values this reads, mapped to the states above. */
const STAMPED_STANDING: Record<string, TemplateStanding> = {
  offered: 'offered',
  listed: 'offered',
  verified: 'offered',
  withdrawn: 'withdrawn',
  rejected: 'withdrawn',
  killed: 'withdrawn',
  revoked: 'withdrawn',
}

/**
 * Reads a template screen document's provenance and standing.
 *
 * Takes the document rather than ids so it costs nothing: everything here is
 * already on the screen document the detail page reads to render anything at
 * all. A template with no install stamp is local, which is the correct
 * reading — every template predating the marketplace was authored here.
 */
export function templateProvenance(
  screen:
    | (Record<string, unknown> & {
        installedFrom?: { standing?: unknown } | null
      })
    | null
    | undefined,
): TemplateProvenance {
  const installed = resolveProvenance(screen as any, 'emailTemplate')
  if (installed.state === 'unknown' || !installed.listingId) {
    return {
      origin: 'local',
      standing: 'local',
      installed: null,
      note: null,
      warn: false,
    }
  }

  const stamped = String(screen?.installedFrom?.standing ?? '')
  const standing: TemplateStanding = STAMPED_STANDING[stamped] ?? 'unread'
  const version = installed.version ? ` version ${installed.version}` : ''
  return {
    origin: 'installed',
    standing,
    installed,
    note:
      standing === 'withdrawn'
        ? `Installed from a marketplace listing${version}, which its ` +
          'publisher no longer offers. It still sends exactly as it is here, ' +
          'but it will not receive updates and cannot be reinstalled.'
        : standing === 'offered'
          ? `Installed from a marketplace listing${version}. Its content is ` +
            'versioned by its publisher, so an update can change what this ' +
            'template looks like.'
          : `Installed from a marketplace listing${version}. Whether its ` +
            'publisher still offers it has not been checked here — this page ' +
            'reads the template, not the listing.',
    warn: standing === 'withdrawn',
  }
}
