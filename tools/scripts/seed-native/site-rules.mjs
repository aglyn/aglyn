/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The demo site's Automation (AGL-3670), so the Aglyn app's Automation
 * screens show every state they draw: functions and variables a workflow
 * calls, workflows with and without a trigger, actions switched on and off
 * (one still holding a placeholder, one on an in-page event the Test button
 * runs, one element interaction that is only counted), inbound and outbound
 * webhooks, org automations placed on every site and on chosen sites (one
 * paused here), run history with each result and each kind of trigger, and
 * this month's run counters.
 */

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

export async function seedAutomation({ put, uid, orgId, hostId, now }) {
  const at = (minutesAgo) => new Date(now.getTime() - minutesAgo * MINUTE)
  const created = new Date(now.getTime() - 20 * DAY)

  await put(`hosts/${hostId}/functions/fn-double`, {
    name: 'double',
    parameters: [{ name: 'x', type: 'number', required: true }],
    variables: [{ name: 'out', type: 'number' }],
    operations: [{ if: { left: '1', comparator: '==', right: '1' }, then: [{ set: 'out', expression: 'x * 2' }], otherwise: [] }],
    returnValue: 'out',
    createdAt: created,
  })
  await put(`hosts/${hostId}/functions/fn-quote`, {
    name: 'quote',
    parameters: [
      { name: 'guests', type: 'number', required: true },
      { name: 'weekend', type: 'boolean' },
    ],
    variables: [{ name: 'total', type: 'number' }],
    operations: [
      {
        if: { left: 'weekend', comparator: '==', right: 'true' },
        then: [{ set: 'total', expression: 'guests * base_price * 1.2' }],
        otherwise: [{ set: 'total', expression: 'guests * base_price' }],
      },
    ],
    returnValue: 'total',
    createdAt: created,
  })
  await put(`hosts/${hostId}/variables/var-base`, { name: 'base_price', type: 'number', value: '18', createdAt: created })

  const workflows = [
    ['wf-quote', 'Party quote', [{ functionId: 'fn-quote', functionName: 'quote', args: ['guests', 'false'], resultName: 'price' }, { functionId: 'fn-double', functionName: 'double', args: ['price'] }], 'price', null],
    ['wf-lead', 'Score a lead', [{ functionId: 'fn-double', functionName: 'double', args: ['10'], resultName: 'score' }, { type: 'notifyAdmins', title: 'A lead scored' }], '', { event: 'lead', filter: 'email' }],
    ['wf-booking', 'Booking follow-up', [{ type: 'sendEmail', subject: 'See you soon', body: 'Hi {{firstName|there}}, we look forward to your visit.' }], '', { event: 'booking' }],
  ]
  for (const [id, name, steps, returnValue, trigger] of workflows) {
    await put(`hosts/${hostId}/workflows/${id}`, { name, steps, returnValue, trigger, createdAt: created, updatedAt: at(3 * 24 * 60), createdBy: uid })
  }
  await put(`hosts/${hostId}/workflows/wf-gone`, { name: 'Old pipeline', steps: [], trigger: null, createdAt: created, deletedAt: at(60) })

  const trigger = (event, extra = {}) => ({
    event,
    oncePerVisitor: false,
    oncePerSession: false,
    cooldownMinutes: null,
    everyTime: false,
    condition: null,
    conditions: null,
    combinator: null,
    ...extra,
  })
  const actions = [
    [
      'act-welcome',
      'Welcome new subscribers',
      trigger('formSubmission', { conditions: [{ field: 'subscribe', op: 'notEmpty' }], combinator: 'and' }),
      [
        { type: 'sendEmail', subject: 'Welcome to Demo Site', body: 'Hi {{firstName|there}}, thanks for signing up.', transactional: true },
        { type: 'wait', delayMinutes: 1440 },
        { type: 'addContactTag', tag: 'subscriber' },
      ],
      true,
    ],
    ['act-booking', 'Tell the team about bookings', trigger('booking'), [{ type: 'notifyAdmins', title: 'New booking' }, { type: 'runWorkflow', workflowId: 'wf-booking', workflowName: 'Booking follow-up' }], true],
    ['act-pricing', 'Pricing page nudge', trigger('scrollDepth', { threshold: 60, pathPattern: '/pricing', oncePerSession: true }), [{ type: 'siteAlert', message: 'Questions? Chat with us.', severity: 'info' }], true],
    ['act-draft', 'Lead hand-off (draft)', trigger('lead'), [{ type: 'enrollList', listId: '', listName: '[your newsletter list]' }], false],
    ['act-leaf', 'Open the menu', trigger('elementClick', { selector: '[data-aglyn="leaf:menu-button"]' }), [{ type: 'toggleMenu' }], true],
  ]
  for (const [id, name, actionTrigger, steps, enabled] of actions) {
    await put(`hosts/${hostId}/actions/${id}`, { name, trigger: actionTrigger, steps, enabled, createdAt: created, updatedAt: at(2 * 24 * 60) })
  }

  await put(`hosts/${hostId}/webhooks/hook-crm`, {
    name: 'Send leads to our CRM',
    direction: 'outbound',
    url: 'https://hooks.example.com/aglyn/leads',
    secret: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718',
    enabled: true,
    createdAt: created,
  })
  await put(`hosts/${hostId}/webhooks/hook-quote`, {
    name: 'Quote requests',
    direction: 'inbound',
    workflowName: 'Party quote',
    secret: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a6978',
    enabled: true,
    createdAt: created,
  })

  const orgAutomations = [
    ['org-welcome', 'Welcome every new lead', { event: 'lead', conditions: null, combinator: null }, [{ type: 'sendEmail', subject: 'Thanks for reaching out', body: 'We will be in touch within a day.' }, { type: 'createCrmTask', title: 'Call the new lead', kind: 'call', priority: 'normal', dueInDays: 1 }], true, ['org'], [hostId]],
    ['org-won', 'Celebrate won deals', { event: 'dealWon', conditions: null, combinator: null }, [{ type: 'notifyAdmins', title: 'A deal was won' }], false, [`host:${hostId}`], []],
  ]
  for (const [id, name, orgTrigger, steps, enabled, visibleTo, pausedHostIds] of orgAutomations) {
    await put(`orgs/${orgId}/automations/${id}`, {
      name,
      trigger: orgTrigger,
      steps,
      enabled,
      visibleTo,
      pausedHostIds,
      deletedAt: null,
      createdAt: created,
      createdBy: uid,
      updatedAt: at(5 * 24 * 60),
      updatedBy: uid,
    })
  }

  const runs = [
    ['run-1', 'act-welcome', 'Welcome new subscribers', 'formSubmission', 'succeeded', 'Sent email · tagged subscriber', 12, { kind: 'visitor', email: 'ana@example.com' }, 340],
    ['run-2', 'act-welcome', 'Welcome new subscribers', 'formSubmission', 'skipped', 'Skipped: subscribe is empty', 95, { kind: 'visitor' }, 20],
    ['run-3', 'act-welcome', 'Welcome new subscribers', 'formSubmission', 'failed', 'Email bounced: mailbox full', 60 * 26, { kind: 'visitor', email: 'old@example.com' }, 910],
    ['run-4', 'act-booking', 'Tell the team about bookings', 'booking', 'succeeded', 'Notified 2 admins · ran Booking follow-up', 45, { kind: 'visitor', email: 'mary@example.com' }, 180],
    ['run-5', 'wf-lead', 'Score a lead', 'lead', 'succeeded', 'Notified 2 admins', 30, { kind: 'apiKey', apiKeyName: 'Zapier' }, 75],
    ['run-6', 'wf-quote', 'Party quote', 'webhook', 'succeeded', 'Returned 432', 200, { kind: 'webhook', name: 'Quote requests' }, 12],
    ['run-7', 'org-welcome', 'Welcome every new lead', 'lead', 'succeeded', 'Sent email · created a task', 15, { kind: 'member', email: 'priya.shah@example.test' }, 260],
  ]
  for (const [id, targetId, name, event, result, summary, minutesAgo, triggeredBy, durationMs] of runs) {
    const words = summary.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    await put(`hosts/${hostId}/activity/${id}`, {
      actorId: null,
      actorEmail: null,
      triggeredBy,
      action: `Action ran on ${event}`,
      result,
      trigger: event,
      summary,
      summaryTokens: [...new Set(words)],
      status: result === 'failed' ? 'error' : 'ok',
      durationMs,
      target: { type: targetId.startsWith('org-') ? 'orgAutomation' : 'workflow', id: targetId, name },
      searchTokens: [...new Set(name.toLowerCase().split(/\s+/))],
      createdAt: at(minutesAgo),
    })
  }

  const month = now.toISOString().slice(0, 7)
  await put(`orgs/${orgId}/counters/workflowRuns`, { [month]: 312 })
  await put(`orgs/${orgId}/counters/actionRuns`, { [month]: 1480 })

  return `${workflows.length} workflows, ${actions.length} actions, 2 webhooks, ${orgAutomations.length} org automations, ${runs.length} runs`
}
