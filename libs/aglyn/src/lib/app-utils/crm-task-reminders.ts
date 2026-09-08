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
 * A task's reminder at its own time (AGL-2659).
 *
 * The daily digest says once a morning what is late and what is due today;
 * nothing said "the 3:00 call is at 3:00". A task now carries `remindAtMs`
 * — the due time unless a person moved it, `null` for none — and an hourly
 * route reads every open task whose reminder has come due and tells the
 * assignee once, in the console and by mail. Every judgment here is pure so
 * the three writers of the field (the task routes, the REST resource, the
 * drawer) and the route that reads it agree on what a reminder is.
 *
 * ## Which reminder a save leaves
 *
 * A caller that SAYS what the reminder is gets what it said. A caller that
 * says nothing gets the rule: a new task's reminder is its due time, and an
 * edit that moves the due date moves a reminder that still sat on the old
 * due time — the reminder was never a choice of its own, so it follows —
 * while a reminder somebody set to a time of their own stays where they put
 * it. The one thing an edit never does is invent a reminder for a task that
 * has none.
 */

import type { CrmTask } from './crm'

/**
 * The most due reminders one org's sweep reads per run.
 *
 * NEWEST FIRST, which is the whole reason a ceiling is safe here. A sent
 * reminder keeps its `remindAtMs` — the drawer shows when it fired — so the
 * range "reminders up to now" holds every reminder an open task ever had,
 * and a window of the OLDEST five hundred would fill with ones already sent
 * and never reach a new one. The newest five hundred always begin with what
 * fell due since the last run; the sent ones sit behind them.
 */
export const CRM_TASK_REMINDER_CEILING = 500

/** The two fields the rule reads off a stored task, or off nothing on create. */
export interface CrmTaskReminderState {
  dueAtMs: number | null
  remindAtMs: number | null
}

/**
 * The reminder a save leaves on the task — see the module comment.
 *
 * `remindAtMs` is what the caller SAID: a time, `null` for "no reminder",
 * `undefined` for nothing said. `previous` is the stored task, or `null`
 * when the task is being created. A stored task from before reminders
 * existed carries no `remindAtMs` at all; it reads as `null` here — no
 * reminder — rather than as one that follows the due date, because a task
 * nobody ever set a reminder on should not start reminding the day its
 * title is corrected.
 */
export function crmTaskReminderAfterEdit(input: {
  dueAtMs: number | null
  remindAtMs?: number | null
  previous: CrmTaskReminderState | null
}): number | null {
  const { dueAtMs, remindAtMs, previous } = input
  if (remindAtMs !== undefined) return remindAtMs
  if (!previous) return dueAtMs
  const followed =
    typeof previous.remindAtMs === 'number' && previous.remindAtMs === previous.dueAtMs
  if (followed && dueAtMs !== previous.dueAtMs) return dueAtMs
  return previous.remindAtMs ?? null
}

/** Whether a task's reminder is still owed: set, and not yet handled. */
export function crmTaskReminderPending(
  task: Pick<CrmTask, 'remindAtMs' | 'reminderSentAtMs'>,
): boolean {
  return typeof task.remindAtMs === 'number' && task.reminderSentAtMs === undefined
}

/**
 * Whether the runner owes this task a reminder now: open, pending, and the
 * reminder's time has come. The query reads the first and third off the
 * index; the second is a fact about a field's absence, which a query cannot
 * select on, so the runner asks it here over the page it read.
 */
export function crmTaskReminderDue(
  task: Pick<CrmTask, 'status' | 'remindAtMs' | 'reminderSentAtMs'>,
  nowMs: number,
): boolean {
  return (
    task.status === 'open' &&
    crmTaskReminderPending(task) &&
    (task.remindAtMs as number) <= nowMs
  )
}

/** A due reminder as the runner carries it: the fields a line and a link need. */
export interface CrmReminderTask
  extends Pick<CrmTask, 'title' | 'kind' | 'contactId' | 'companyId' | 'dealId'> {
  id: string
  dueAtMs: number | null
  remindAtMs: number
  assigneeUid: string
  /** The site the task was created on, or `''` for the organization's own. */
  hostId: string
}

/**
 * The console path a reminder opens: the record the task is for, in the
 * hub, or the tasks list when it is for nobody in particular — the same
 * page the assignment notification opens, in the `/{hostDocId}/rest` shape
 * every host notification uses and the `/org/rest` shape the console
 * rewrites onto the organization's own hub for a task with no site.
 */
export function crmTaskReminderLink(
  hostId: string | null,
  task: Pick<CrmTask, 'contactId' | 'companyId' | 'dealId'>,
): string {
  const base = hostId ? `/${hostId}/crm` : '/org/crm'
  if (task.contactId) return `${base}/contacts/${encodeURIComponent(task.contactId)}`
  if (task.dealId) return `${base}/deals/${encodeURIComponent(task.dealId)}`
  if (task.companyId) return `${base}/companies/${encodeURIComponent(task.companyId)}`
  return `${base}/tasks`
}

/** `Wed, Sep 9, 3:00 PM` in a named zone — the words a reminder says a time with. */
export function crmTaskReminderWhen(ms: number, timeZone: string): string {
  return new Date(ms).toLocaleString('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * The one line the console notification is: the title and when the task is
 * due. A reminder set on a task with no due date says only the title —
 * the person chose the time; the task itself has none.
 */
export function composeCrmTaskReminderBody(
  task: Pick<CrmReminderTask, 'title' | 'dueAtMs'>,
  timeZone: string,
): string {
  return typeof task.dueAtMs === 'number'
    ? `${task.title} · due ${crmTaskReminderWhen(task.dueAtMs, timeZone)}`
    : task.title
}

/**
 * One mail per member per run, so five tasks due at nine o'clock are one
 * message and not five. The subject names the task when there is one.
 */
export function composeCrmTaskReminderSubject(
  tasks: ReadonlyArray<Pick<CrmReminderTask, 'title'>>,
): string {
  if (tasks.length === 1) return `Reminder: ${tasks[0].title}`
  return `Reminder: ${tasks.length} tasks are due`
}

/** What the reminder email needs from the route besides the tasks. */
export interface CrmTaskReminderEmailInput {
  tasks: readonly CrmReminderTask[]
  timeZone: string
  /** The product name the mail reads as — the org's brand when white-labeled. */
  productName: string
  /** The console page a task opens on, absolute. */
  taskUrl: (task: CrmReminderTask) => string
  /** Account settings → Notifications, where the category can be muted. */
  settingsUrl: string
  /** The brand's support line, already prefixed, or empty. */
  supportLine?: string
}

/**
 * The plain-text email. Text rather than a designed template for the
 * reason the digest gives: the body is a list, and `sendEmail` synthesizes
 * the HTML part that makes its links live. Soonest due first, each task on
 * its own line with its link under it, and the way out last.
 */
export function composeCrmTaskReminderEmailText(input: CrmTaskReminderEmailInput): string {
  const { tasks, timeZone, productName } = input
  const ordered = [...tasks].sort(
    (a, b) => (a.dueAtMs ?? a.remindAtMs) - (b.dueAtMs ?? b.remindAtMs),
  )
  const lines: string[] = [
    ordered.length === 1
      ? `A reminder from ${productName}: this task is due.`
      : `A reminder from ${productName}: ${ordered.length} tasks are due.`,
    '',
  ]
  for (const task of ordered) {
    lines.push(`- ${composeCrmTaskReminderBody(task, timeZone)}`)
    lines.push(`  ${input.taskUrl(task)}`)
  }
  lines.push(
    '',
    'You get task reminders because the Forms & bookings category is on in ' +
      `your notification settings: ${input.settingsUrl}`,
  )
  return lines.join('\n') + (input.supportLine ?? '')
}
