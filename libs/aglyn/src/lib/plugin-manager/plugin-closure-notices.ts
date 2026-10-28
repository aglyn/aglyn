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
 * WHAT A PERSON SHOULD KNOW BEFORE A WORKSPACE IS DELETED OR AN ACCOUNT IS
 * CLOSED, said by the plugins whose records the closure acts on (AGL-4038).
 *
 * Its siblings do the closure: `plugin-org-erasure` and `plugin-user-erasure`
 * let a plugin finish its share when a workspace is erased or an account is
 * closed — cancel what it holds, refund what it took. This one says so
 * BEFORE the person confirms. A plugin that will act on a closure registers
 * a NOTICE SOURCE, and the console's delete-workspace and close-account
 * screens ask every source and print what they answer above the confirm.
 *
 * The platform owns the question and the screen: who is asking, which
 * closure, where the notices are drawn. What a plugin holds, what the
 * closure will do to it, and the words the person reads, are the plugin's.
 * A notice is information, never a gate: the platform does not hold a
 * closure back on any answer, and a plugin that would refuse a closure has
 * no way to through this contract.
 *
 * ## Not answered is said, not hidden
 *
 * A source that throws, or answers something that cannot be printed, is
 * listed in `unavailable` by plugin id, and the screen says some details
 * could not be checked — so a missing warning never reads as "nothing to
 * warn about". A process where no source is registered at all runs the
 * app's boot step once more first (`plugin-declarations-repair`), as the
 * erasures do.
 *
 * Logic only: the contract, the registry and the reader. The screens that
 * draw a notice are the console's.
 */

import { runPluginDeclarationsRepair } from './plugin-declarations-repair'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/** The closure being asked about. */
export type ClosureSubject =
  /** A workspace about to be deleted, with every site in it. */
  | { kind: 'workspace'; orgId: string }
  /** A person's own account about to be closed. */
  | { kind: 'account'; uid: string }

/** One thing a notice lists: an order, a booking, a subscription. */
export interface ClosureNoticeItem {
  /** Stable within the notice. */
  id: string
  /** The line a person recognizes it by: an order number, a name. */
  primary: string
  /** What it is: the items in it, its dates. */
  secondary?: string
  /** An amount, already formatted for the person reading it. */
  amount?: string
}

/** What one plugin says about one closure. */
export interface ClosureNotice {
  /** Stable, and unique for the plugin. */
  id: string
  /** `warning` when the closure will change something the person paid for or relies on. */
  severity: 'warning' | 'info'
  /** One line: what will happen. */
  title: string
  /** The rest of it: what happens to each item, and when. */
  body: string
  /** What it applies to. A notice with nothing to list is not answered. */
  items: ClosureNoticeItem[]
}

/** A notice as the reader answers it, with the plugin that said it. */
export type ClosureNoticeAnswer = ClosureNotice & { pluginId: string }

export interface ClosureNoticeSource {
  /** The notices for one closure; none when it changes nothing of the plugin's. May throw. */
  notices(subject: ClosureSubject): Promise<readonly ClosureNotice[]>
}

/** Every plugin may answer; one source per plugin. */
export const CLOSURE_NOTICE_SOURCES = definePluginServiceContract<ClosureNoticeSource>(
  'core.closure-notices',
  { multiple: true },
)

/**
 * Installs a plugin's notice source. Owner = the loader's marker inside a
 * register fn, else `options.pluginId`. Registering again replaces the
 * plugin's earlier source.
 */
export function registerClosureNoticeSource(
  source: ClosureNoticeSource,
  options?: { pluginId?: string },
): void {
  if (typeof source?.notices !== 'function') {
    throw new Error('a closure notice source needs a notices function')
  }
  registerPluginService(CLOSURE_NOTICE_SOURCES, source, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** The plugins with a registered source, in the order they answer. */
export function listClosureNoticeSources(): string[] {
  return resolvePluginServices(CLOSURE_NOTICE_SOURCES).map((entry) => entry.pluginId)
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

/** Whether a notice can be printed: words, a severity, and items that each have a line. */
export function isPrintableClosureNotice(notice: unknown): notice is ClosureNotice {
  const candidate = notice as ClosureNotice | null | undefined
  if (!candidate || typeof candidate !== 'object') return false
  if (!isText(candidate.id) || !isText(candidate.title) || !isText(candidate.body)) return false
  if (candidate.severity !== 'warning' && candidate.severity !== 'info') return false
  if (!Array.isArray(candidate.items) || candidate.items.length === 0) return false
  return candidate.items.every(
    (item) =>
      isText(item?.id) &&
      isText(item?.primary) &&
      (item.secondary === undefined || typeof item.secondary === 'string') &&
      (item.amount === undefined || typeof item.amount === 'string'),
  )
}

/** What every source answered for one closure. */
export interface ClosureNoticesRead {
  /** Warnings first, then in the order the sources answered. */
  notices: ClosureNoticeAnswer[]
  /** Plugins whose answer could not be read: the screen says details are missing. */
  unavailable: string[]
}

/**
 * Asks every source about one closure. NEVER THROWS: a source that threw or
 * answered something unprintable is listed in `unavailable`, and the rest
 * are answered. With no source registered, runs the app's boot step once
 * and asks again.
 */
export async function readClosureNotices(subject: ClosureSubject): Promise<ClosureNoticesRead> {
  let registered = resolvePluginServices(CLOSURE_NOTICE_SOURCES)
  if (!registered.length) {
    const repaired = await runPluginDeclarationsRepair().catch(() => false)
    if (repaired) registered = resolvePluginServices(CLOSURE_NOTICE_SOURCES)
  }
  const answers = await Promise.all(
    registered.map(async ({ pluginId, impl }) => {
      try {
        const notices = await impl.notices(subject)
        if (!Array.isArray(notices) || !notices.every(isPrintableClosureNotice)) {
          console.error(`[closure-notices] "${pluginId}" answered a notice that cannot be printed`)
          return { pluginId, notices: null }
        }
        return { pluginId, notices: notices.map((notice) => ({ ...notice, pluginId })) }
      } catch (error) {
        console.error(`[closure-notices] "${pluginId}" could not answer`, error)
        return { pluginId, notices: null }
      }
    }),
  )
  const notices = answers.flatMap((answer) => answer.notices ?? [])
  return {
    notices: [
      ...notices.filter((notice) => notice.severity === 'warning'),
      ...notices.filter((notice) => notice.severity !== 'warning'),
    ],
    unavailable: answers.filter((answer) => answer.notices === null).map((answer) => answer.pluginId),
  }
}
