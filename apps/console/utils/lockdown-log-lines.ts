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

/*
 * THE LINES THE LOCKDOWN PAGE KEEPS UNDER "ACTIONS TAKEN IN THIS SESSION" (AGL-1571).
 *
 * A lock or lift that reached the server leaves one line for the act and one for each step it reported
 * beside it (the billing cancel, the membership renewals, the payouts, what a plugin held, the owner
 * email, the workspaces an account owned), each verified or NOT CONFIRMED: a lock that landed and a pause
 * that did not are two facts. The page and the staff apps keep the same lines; the route sends them as
 * `logLines` on every lock, lift and resend, and the page builds them from the same answer with these.
 */

export interface LockdownLogLine {
  text: string
  confirmed: boolean
}

/**
 * The site-money steps an org or host lock or lift reported (AGL-3364):
 * membership renewals paused or resumed, and the seller's payouts paused or
 * restored. One line each, each with its own verified/NOT CONFIRMED chip —
 * a lock that landed and a pause that did not are two facts.
 */
export function siteMoneyLogLines(
  payload: Record<string, any>,
): Array<{ text: string; confirmed: boolean }> {
  const lines: Array<{ text: string; confirmed: boolean }> = []
  const problems = (step: Record<string, any>) => [
    ...((step['lookupErrors'] as string[]) ?? []),
    ...((step['subscriptions'] as Array<Record<string, any>>) ?? [])
      .filter((entry) => !entry['confirmed'])
      .map((entry) => `${entry['id']}: ${entry['error'] ?? entry['outcome']}`),
    ...(step['error'] ? [String(step['error'])] : []),
  ]
  const count = (step: Record<string, any>, outcome: string) =>
    ((step['subscriptions'] as Array<Record<string, any>>) ?? []).filter(
      (entry) => entry['outcome'] === outcome,
    ).length
  const pause = payload['renewalsPause'] as Record<string, any> | undefined
  if (pause) {
    lines.push(
      pause['confirmed'] === true
        ? {
            text:
              `Paused ${count(pause, 'paused')} membership renewal(s) — nothing canceled or refunded, customers not told` +
              (count(pause, 'held') ? `; ${count(pause, 'held')} already held by another lock` : '') +
              (count(pause, 'already-paused')
                ? `; ${count(pause, 'already-paused')} already paused by the merchant, left alone`
                : ''),
            confirmed: true,
          }
        : {
            text: `Membership renewal pause NOT confirmed — the lock stands. ${problems(pause).join('; ')}`,
            confirmed: false,
          },
    )
  }
  const resume = payload['renewalsResume'] as Record<string, any> | undefined
  if (resume) {
    lines.push(
      resume['confirmed'] === true
        ? {
            text:
              `Resumed ${count(resume, 'resumed')} membership renewal(s) this lock paused` +
              (count(resume, 'still-held')
                ? `; ${count(resume, 'still-held')} still held by another lock`
                : ''),
            confirmed: true,
          }
        : {
            text: `Membership renewal resume NOT confirmed — some stay paused. ${problems(resume).join('; ')}`,
            confirmed: false,
          },
    )
  }
  // One line per connected account the lock paused (AGL-3365): the
  // storefront's, then any a plugin pays the workspace through.
  const pausedAccounts = [
    payload['payoutsPause'],
    ...((payload['payoutsPauseOthers'] as unknown[]) ?? []),
  ].filter(Boolean) as Array<Record<string, any>>
  for (const payouts of pausedAccounts) {
    const account =
      (payouts['accountId'] ?? 'no account') +
      (payouts['label'] ? ` (${payouts['label']})` : '')
    lines.push(
      payouts['outcome'] === 'not-controllable'
        ? {
            text: `Payouts for ${account}: not controllable (Standard account) — pause them in the Stripe Dashboard`,
            confirmed: false,
          }
        : payouts['confirmed'] === true
          ? {
              text:
                payouts['outcome'] === 'no-account'
                  ? 'Payouts: the seller has no connected account — nothing pays out'
                  : payouts['outcome'] === 'held'
                    ? `Payouts for ${account} already held manual by another lock`
                    : `Payouts for ${account} set to manual (was ${payouts['schedule']?.['interval'] ?? 'unknown'}; saved for the lift)`,
              confirmed: true,
            }
          : {
              text: `Payout pause for ${account} NOT confirmed — the lock stands. ${payouts['error'] ?? ''}`.trim(),
              confirmed: false,
            },
    )
  }
  const restoredAccounts = [
    payload['payoutsRestore'],
    ...((payload['payoutsRestoreOthers'] as unknown[]) ?? []),
  ].filter(Boolean) as Array<Record<string, any>>
  for (const restore of restoredAccounts) {
    const account =
      (restore['accountId'] ?? 'the account') +
      (restore['label'] ? ` (${restore['label']})` : '')
    lines.push(
      restore['confirmed'] === true
        ? {
            text:
              restore['outcome'] === 'still-held'
                ? `Payouts for ${account} stay manual — another lock still holds them`
                : `Payouts for ${account} restored to ${restore['schedule']?.['interval'] ?? 'the saved schedule'}`,
            confirmed: true,
          }
        : {
            text: `Payout restore for ${account} NOT confirmed — payouts may still be manual. ${restore['error'] ?? ''}`.trim(),
            confirmed: false,
          },
    )
  }
  // What the workspace owns inside plugins (AGL-3365): the marketplace's
  // listings, hidden on the lock and restored on the lift.
  for (const participant of (payload['orgLockParticipants'] as Array<Record<string, any>>) ?? []) {
    lines.push({
      text: `${participant['pluginId'] ?? 'Plugins'}: ${participant['summary'] ?? ''}`,
      confirmed: participant['confirmed'] === true,
    })
  }
  return lines
}

/**
 * The owners' email a lock or lift reported (AGL-3368), as a line of its own
 * with its own verified/NOT CONFIRMED chip — a lock can never skip its email
 * silently. Unticked "Email the owners" reads as a deliberate, verified
 * "not sent", never as silence.
 */
function ownerNoticeLine(
  notice: Record<string, any> | undefined,
  label: string,
): { text: string; confirmed: boolean } | null {
  if (!notice) return null
  const emailed = Number(notice['emailed'] ?? 0)
  const recipients = Number(notice['recipients'] ?? 0)
  const failed = Number(notice['emailFailed'] ?? 0)
  if (notice['error']) {
    return { text: `Owner email for ${label} FAILED — ${notice['error']}`, confirmed: false }
  }
  if (emailed === 0) {
    return {
      text: `Owner email for ${label} NOT sent — ${notice['skipped'] ?? 'nobody was emailed'}`,
      confirmed: notice['confirmed'] === true,
    }
  }
  return {
    text:
      `Emailed ${label}'s owners the ${String(notice['kind'] ?? 'lock')} notice — ${emailed} of ${recipients}` +
      (failed ? `, ${failed} FAILED` : ''),
    confirmed: notice['confirmed'] === true,
  }
}

/**
 * The billing steps a lock reported (AGL-3359), as log lines of their own.
 *
 * Separate lines, never folded into the lock's: a lock that landed and a
 * cancel that did not are two facts, and the log must show the first as
 * verified and the second as NOT CONFIRMED rather than blur them into one.
 */
export function billingLogLines(
  payload: Record<string, any>,
): Array<{ text: string; confirmed: boolean }> {
  const cancelLine = (
    cancel: Record<string, any> | undefined,
    label: string,
  ): { text: string; confirmed: boolean } | null => {
    if (!cancel) return null
    const problems = [
      ...((cancel['lookupErrors'] as string[]) ?? []),
      ...((cancel['subscriptions'] as Array<Record<string, any>>) ?? [])
        .filter((step) => !step['confirmed'])
        .map((step) => `${step['id']}: ${step['error'] ?? step['outcome']}`),
    ]
    const found = ((cancel['subscriptions'] as unknown[]) ?? []).length
    return cancel['confirmed'] === true
      ? {
          text: found
            ? `Cancelled billing for ${label} — ${cancel['changed'] ?? 0} of ${found} subscription(s) changed, no refund`
            : `Billing for ${label}: nothing was billing`,
          confirmed: true,
        }
      : {
          text: `Billing cancel for ${label} NOT confirmed — the lock stands. ${problems.join('; ')}`,
          confirmed: false,
        }
  }
  const lines: Array<{ text: string; confirmed: boolean } | null> = []
  if (payload['subscriptionCancel']) {
    lines.push(
      cancelLine(
        payload['subscriptionCancel'],
        `workspace ${payload['subscriptionCancel']['orgId'] ?? ''}`.trim(),
      ),
    )
  }
  lines.push(...siteMoneyLogLines(payload))
  lines.push(
    ownerNoticeLine(
      payload['ownerNotice'],
      `${payload['ownerNotice']?.['scope'] ?? 'target'} ${payload['ownerNotice']?.['targetId'] ?? ''}`.trim(),
    ),
  )
  const owned = payload['ownedWorkspaces'] as Record<string, any> | undefined
  if (owned) {
    if (owned['error']) {
      lines.push({ text: String(owned['error']), confirmed: false })
    }
    const workspaces = (owned['workspaces'] as Array<Record<string, any>>) ?? []
    if (!owned['error'] && workspaces.length === 0) {
      lines.push({
        text: 'This account owns no workspaces — nothing else to lock or cancel',
        confirmed: true,
      })
    }
    for (const workspace of workspaces) {
      const label = `owned workspace ${workspace['slug'] ?? workspace['orgId']}`
      lines.push({
        text: workspace['lockError']
          ? `Locking ${label} failed: ${workspace['lockError']}`
          : workspace['alreadyLocked']
            ? `${label} was already locked — left as it was`
            : `Locked ${label}`,
        confirmed: workspace['confirmed'] === true,
      })
      lines.push(cancelLine(workspace['subscriptionCancel'], label))
      lines.push(ownerNoticeLine(workspace['ownerNotice'], label))
    }
    if (owned['truncated']) {
      lines.push({
        text: 'This account owns more workspaces than one lock handles — lock the rest by org id',
        confirmed: false,
      })
    }
  }
  return lines.filter(Boolean) as Array<{ text: string; confirmed: boolean }>
}


/**
 * The lines one lock or lift leaves: the act, then the steps it reported, in the order they happened (the page
 * shows the newest on top).
 */
export function lockLogLines(
  body: Record<string, unknown>,
  payload: Record<string, any>,
): LockdownLogLine[] {
  const what = `${body['action'] === 'lock' ? 'Locked' : 'Unlocked'} ${body['scope']}${
    body['targetId'] ? ` ${body['targetId']}` : ''
  }`
  return [{ text: what, confirmed: payload['confirmed'] !== false }, ...billingLogLines(payload)]
}

/**
 * The lines a resend of owner notices leaves: each target the resend refused, then each recipient's outcome.
 * `formatTime` words the moment an earlier send happened, in the reader's own locale.
 */
export function resendLogLines(
  payload: Record<string, any>,
  formatTime: (ms: number) => string,
): LockdownLogLine[] {
  return [
    ...((payload['targets'] as Array<Record<string, any>>) ?? [])
      .filter((target) => target['error'])
      .map((target) => ({
        text: `Resend for ${target['scope']} ${target['targetId']}: ${target['error']}`,
        confirmed: false,
      })),
    ...((payload['recipients'] as Array<Record<string, any>>) ?? []).map((recipient) => ({
      text:
        recipient['outcome'] === 'sent'
          ? `Owner notice sent to ${recipient['email']} for ${(recipient['sentLockKeys'] as string[]).length} lock(s)`
          : recipient['outcome'] === 'already-sent'
            ? `Owner notice for ${recipient['email']} already sent at ${formatTime(
                Number(recipient['alreadySentAtMs'] ?? 0),
              )} — tick "Send again" to resend`
            : `Owner notice to ${recipient['email']} FAILED — ${recipient['error'] ?? 'unknown'}`,
      confirmed: recipient['outcome'] !== 'failed',
    })),
  ]
}
