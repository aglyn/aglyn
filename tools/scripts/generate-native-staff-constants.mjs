#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE WORDS AND RULES THE STAFF SCREENS READ FROM THE CONSOLE (AGL-3667).
 *
 *   node tools/scripts/generate-native-staff-constants.mjs           # write
 *   node tools/scripts/generate-native-staff-constants.mjs --check   # drift guard
 *
 * A staff screen shows what the console's page says about a probe, and asks
 * for the phrase the console's route insists on before a destructive job
 * runs. Those live in console modules (`@aglyn/aglyn/app-utils/console/platform-health`,
 * `@aglyn/aglyn/app-utils/console/maintenance-jobs`), so this generator READS them and writes only
 * their values into `libs/native/screens/staff.screens.json`: the probe
 * texts as the `constants` of `core.staff.health`, the lock and cancellation
 * reasons a route insists on as the `constants` of the screens that offer
 * them, the plugin review checklist, rejection reasons and status texts as the
 * `constants` of `core.staff.pluginReview`, and the whole `core.staff.maintenance` screen, one block group per job. A reworded
 * consequence or a new confirmation phrase cannot drift from the route that
 * enforces it. Values cross, never code.
 */

import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const ROOT = join(import.meta.dirname, '../..')
const CHECK = process.argv.includes('--check')
const SPEC = 'libs/native/screens/staff.screens.json'

function aliases() {
  const paths = JSON.parse(readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8')).compilerOptions.paths
  const alias = {}
  for (const [key, [target]] of Object.entries(paths)) {
    if (key.endsWith('/*')) alias[key.slice(0, -2)] = join(ROOT, target.replace(/\/\*$/, ''))
    else if (!(`${key}/*` in paths)) alias[key] = join(ROOT, target)
  }
  return alias
}

/** What the console modules say: the probes the Health screen reads as `const`, and the jobs the Maintenance screen is drawn from. */
export async function staffSources() {
  // The platform address is the default one, whatever this machine's environment says.
  delete process.env.NEXT_PUBLIC_TENANT_DOMAIN
  const { createJiti } = require('jiti')
  const jiti = createJiti(join(ROOT, 'package.json'), { interopDefault: true, fsCache: false, alias: aliases() })
  const health = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/console/platform-health.ts'))
  const maintenance = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/console/maintenance-jobs.ts'))
  const lockdown = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/lockdown.ts'))
  const cancel = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/console/subscription-cancel.ts'))
  const options = (codes, labels) => codes.map((value) => ({ value, label: labels[value] }))
  // The AI plugin declares the AI levers the Locks screen lists beside the core ones.
  await jiti.import(join(ROOT, 'libs/plugins/ai/src/lib/declarations.ts'))
  const emails = await jiti.import(join(ROOT, 'libs/shared/util/email/src/lib/system-email-catalog.ts'))
  const suppression = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/console/email-suppression-filters.ts'))
  const plans = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/plan-entitlements.ts'))
  const revenue = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/console/revenue-view.ts'))
  const overrides = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/console/org-override-fields.ts'))
  const domain = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/console/domain-status.ts'))
  const leaving = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/console/staff-leaving-notice.ts'))
  const apex = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/tenant-apex.ts'))
  const identity = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/console/staff-identity-source.ts'))
  const passwordPolicy = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/password-policy.ts'))
  const passwordGenerator = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/console/password-generator.ts'))
  const taxFiling = await jiti.import(join(ROOT, 'apps/console/utils/tax-filing-config.ts'))
  const quarantine = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/media-quarantine.ts'))
  const samples = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/console/system-email-sample-sources.ts'))
  const impersonation = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/console/impersonation-reason.ts'))
  const takedown = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/media-takedown-reach.ts'))
  const denyList = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/console/media-quarantine-list-query.ts'))
  const gateways = await jiti.import(join(ROOT, 'libs/shared/util/email/src/lib/mail-gateway.ts'))
  const auditQuery = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/console/admin-audit-list-query.ts'))
  const organizations = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/organizations.ts'))
  const overrideReasons = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/org-override-reason.ts'))
  const abuse = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/abuse-report.ts'))
  const model = (file) => jiti.import(join(ROOT, `libs/plugins/marketplace/src/lib/model/${file}.ts`))
  const checklist = await model('plugin-review-checklist')
  const rejections = await model('plugin-rejection-categories')
  const statuses = await model('plugin-review-status')
  const attestation = await model('publisher-attestation')
  return {
    audit: {
      scopes: auditQuery.ADMIN_AUDIT_KNOWN_SCOPES.map((value) => ({ value, label: value })),
      targetKinds: auditQuery.ADMIN_AUDIT_KNOWN_TARGET_KINDS.map((value) => ({ value, label: value })),
    },
    quarantine: {
      reasons: quarantine.MEDIA_QUARANTINE_REASONS.map((value) => ({ value, label: quarantine.MEDIA_QUARANTINE_REASON_LABELS[value] })),
      reasonLabels: quarantine.MEDIA_QUARANTINE_REASON_LABELS,
      messageMax: quarantine.MEDIA_QUARANTINE_MESSAGE_MAX,
      noteMax: quarantine.MEDIA_QUARANTINE_NOTE_MAX,
      // What disabling a file will and will not do, as the page words it from the headers the CDN actually sends.
      reach: { lines: takedown.mediaTakedownReachLines(), unreachable: takedown.mediaTakedownUnreachableLine() },
      keyReach: denyList.QUARANTINE_KEY_REACH,
      kinds: denyList.LISTED_KIND_LABEL,
      states: denyList.ROW_STATE_LABEL,
    },
    settings: { taxSources: taxFiling.TAX_FILING_SOURCE_LABEL },
    user: {
      identitySources: identity.IDENTITY_SOURCE_LABEL,
      userTypes: {
        manager: organizations.CONSOLE_USER_TYPE_LABELS.manager,
        collaborator: organizations.CONSOLE_USER_TYPE_LABELS.collaborator,
      },
      password: {
        minLength: passwordPolicy.PASSWORD_MIN_LENGTH,
        alphabet: passwordGenerator.PASSWORD_GENERATOR_ALPHABET,
        length: passwordGenerator.PASSWORD_GENERATOR_LENGTH,
      },
      impersonation: { minReason: impersonation.IMPERSONATION_MIN_REASON_LENGTH },
    },
    site: {
      tenantApex: apex.TENANT_APEX,
      // What the console's domain card says for each verdict the hosting platform can give.
      domain: {
        verdicts: ['serving', 'certificate-pending', 'ownership-pending', 'dns-misconfigured', 'not-attached', 'skipped', 'unknown'].map(
          (state) => {
            const chip = domain.domainChipFor('@', { state }, false)
            const note = domain.staffDomainNoteFor({ state })
            return {
              state,
              label: chip.label.replace(/^@( — )?/, ''),
              tone: chip.color,
              severity: note?.severity ?? '',
              note: note?.text ?? '',
            }
          },
        ),
      },
      // The leaving-notice line, both ways it reads, as value templates over a site row.
      leavingNotice: {
        on: leaving.staffLeavingNoticeLabel(0, () => '{item.org.leavingNoticeUntil:datetime}').replace(/^Leaving notice: /, ''),
        off: leaving.staffLeavingNoticeLabel(null).replace(/^Leaving notice: /, ''),
      },
    },
    emails: {
      templates: emails.SYSTEM_EMAIL_TEMPLATES.map(({ key, name, description, deliveredBy }) => ({
        key,
        name,
        description,
        deliveredBy,
        editable: emails.isSystemEmailEditable({ deliveredBy }),
      })),
      // What the console's test drawer asks for: each merge value a template takes, with its sample, a field each.
      tokens: Object.fromEntries(
        emails.SYSTEM_EMAIL_TEMPLATES.filter((template) => emails.isSystemEmailEditable(template)).map((template) => [
          template.key,
          template.mergeTokens.map(({ name, description, sample }) => ({ name, description, sample })),
        ]),
      ),
    },
    suppressions: {
      reasons: Object.entries(suppression.SUPPRESSION_REASON_LABELS).map(([value, { label }]) => ({ value, label })),
    },
    override: {
      quotas: overrides.QUOTA_FIELDS,
      features: overrides.FLAG_FIELDS,
      releaseFlags: overrides.RELEASE_FLAG_FIELDS,
      plans: Object.entries(plans.PLAN_LABELS).map(([value, label]) => ({ value, label })),
      reasons: options(overrideReasons.ORG_OVERRIDE_REASON_CODES, overrideReasons.ORG_OVERRIDE_REASON_LABELS),
      noteMax: overrideReasons.ORG_OVERRIDE_NOTE_MAX,
    },
    margin: {
      plans: Object.entries(plans.PLAN_LABELS).map(([value, label]) => ({ value, label })),
      scopeNote: plans.MARGIN_SCOPE_NOTE,
    },
    revenue: {
      orgStates: revenue.ORG_STATE_LABELS,
      // The words the console prints for each way contracted and settled can differ; the amounts come from the route.
      causes: revenue
        .gapCauses({ gap: { causes: {} } })
        .map(({ id, label, action, periodScoped }) => ({ id, label, action, periodScoped, field: `${id}Cents` })),
      subscriptionsNote: revenue.earnedLines({ settled: { subscriptions: {} } })[0].note,
    },
    abuse: {
      categories: abuse.ABUSE_REPORT_CATEGORIES.map(({ id, label, severity }) => ({ value: id, label, severity })),
    },
    lockdown: {
      platformId: lockdown.PLATFORM_LOCKDOWN_DOC_ID,
      platformPhrase: lockdown.PLATFORM_LOCK_CONFIRM_PHRASE,
      reasons: options(lockdown.LOCKDOWN_REASON_CODES, lockdown.LOCKDOWN_REASON_LABELS),
      enforcements: options(lockdown.LOCKDOWN_ENFORCEMENTS, lockdown.LOCKDOWN_ENFORCEMENT_LABELS),
      features: lockdown.listLockdownFeatures().map(({ key, label, staffBypass }) => ({
        key,
        label,
        staffBypass: staffBypass === true,
        lockId: lockdown.featureLockdownDocId(key),
      })),
    },
    pluginReview: {
      checklist: checklist.PLUGIN_REVIEW_CHECKLIST.map(({ id, label, detail, required, realmOnly }) => ({
        id,
        label,
        detail,
        required,
        realmOnly: realmOnly === true,
      })),
      rejectionCategories: rejections.PLUGIN_REJECTION_CATEGORIES.map(({ id, label, guidance, requiresComment }) => ({
        value: id,
        label,
        guidance,
        requiresComment: requiresComment === true,
      })),
      statuses: statuses.REVIEW_STATUS_MEANINGS,
      attestation: Object.fromEntries(attestation.PUBLISHER_ATTESTATION.map(({ id, label }) => [id, label])),
    },
    lockReasons: options(lockdown.LOCKDOWN_REASON_CODES, lockdown.LOCKDOWN_REASON_LABELS),
    cancelReasons: options(cancel.SUBSCRIPTION_CANCEL_REASON_CODES, cancel.SUBSCRIPTION_CANCEL_REASON_LABELS),
    gatewayLabels: gateways.MAIL_GATEWAY_LABELS,
    gatewayOptions: gateways.MAIL_GATEWAYS.filter((gateway) => gateway !== 'none').map((value) => ({ value, label: gateways.MAIL_GATEWAY_LABELS[value] })),
    probes: Object.fromEntries(
      health.HEALTH_PROBES.map(({ id, label, path, auth, meaning, remedy }) => [id, { label, path, auth, meaning, remedy }]),
    ),
    reasonMin: maintenance.MAINTENANCE_REASON_MIN,
    // What a workspace, a site and a person fill into a system email test: the form field for each merge token, and the
    // field of the record it reads.
    sampleFills: Object.fromEntries(
      Object.entries(samples.SAMPLE_SOURCE_FILLS).map(([kind, tokens]) => [
        kind,
        Object.fromEntries(Object.entries(tokens).map(([token, field]) => [`token.${token}`, `{item.${field}}`])),
      ]),
    ),
    impersonation: { minReason: impersonation.IMPERSONATION_MIN_REASON_LENGTH },
    jobs: maintenance.MAINTENANCE_JOBS.map(({ id, label, path, destructive, confirmPhrase, what, consequence, previewShows }) => ({
      id,
      label,
      path,
      destructive,
      confirmPhrase,
      what,
      consequence,
      previewShows,
    })),
  }
}

/** A route's answer as lines: the console's `summarize`, line for line, each shown when the route sent the number. */
const SENT = (key) => `response.${key} != ''`
const RUN_REPORT = [
  ['archived', 'audit rows'],
  ['batches', 'batches'],
  ['scanned', 'objects scanned'],
  ['orphans', 'orphaned objects'],
  ['deleted', 'objects deleted'],
  ['bytesReclaimable', 'bytes reclaimable'],
  ['kept', 'objects kept'],
  ['tooNew', 'objects too new to reap'],
  ['skipped', 'versions already current'],
  ['downloaded', 'versions downloaded'],
  ['deferredByCap', 'deferred by the per-run cap'],
]
  .map(([key, words]) => ({ text: `{response.${key}:number} ${words}`, when: SENT(key) }))
  .concat([
    { text: '{response.needsStaff:count} LIVE version(s) now fail the verifier', when: 'response.needsStaff' },
    { text: 'no live version fails the verifier', when: `!response.needsStaff && ${SENT('downloaded')}` },
    { text: '{response.erasureDue:count} erasure(s) past the hold', when: 'response.erasureDue' },
  ])

/** A job id as a key the session can hold (`audit-archive` is `auditArchive`). */
const armKey = (id) => id.replace(/[-.](\w)/g, (_, letter) => letter.toUpperCase())

/**
 * The Maintenance page (`/admin/maintenance`), one block group per job in the console's list: the
 * schedule verdict from the crons probe, what the job does and costs, a preview (a bare GET is the
 * dry run) and the guarded real run, which takes a reason and, for the two jobs that destroy data,
 * the phrase typed exactly. The route enforces both again.
 */
export function maintenanceScreen(jobs, reasonMin) {
  const blocks = [
    {
      type: 'notice',
      tone: 'info',
      text:
        'These jobs run on a schedule. The point of this page is seeing whether the schedule is still working: ' +
        'a job that stopped running looks exactly like one with nothing to do. Running one by hand is for when ' +
        'something cannot wait, and every run by hand is recorded in the audit log. Scope drift and pending ' +
        'erasures have their own cards on Health.',
    },
  ]
  for (const job of jobs) {
    const check = `data.crons.checks.${job.id}`
    blocks.push(
      { type: 'notice', tone: 'warning', title: job.label, text: 'No schedule reading for this job. The crons probe did not report it.', when: `!${check}` },
      // The last report is a number of minutes only when the job has reported; one that never has says so in words, as
      // the console's health facts do. `!= ''` holds for any reading, 0 minutes included; `== ''` only where there is none.
      {
        type: 'notice',
        tone: 'success',
        title: job.label,
        text: `Scheduled \u00b7 {${check}.schedule} \u00b7 last ran {${check}.lastBeatAgeMinutes} min ago`,
        when: `${check}.ok && ${check}.lastBeatAgeMinutes != ''`,
      },
      {
        type: 'notice',
        tone: 'success',
        title: job.label,
        text: `Scheduled \u00b7 {${check}.schedule} \u00b7 it has never reported a run`,
        when: `${check}.ok && ${check}.lastBeatAgeMinutes == ''`,
      },
      {
        type: 'notice',
        tone: 'error',
        title: job.label,
        text: `NOT RUNNING {${check}.code|'no reading'} \u00b7 {${check}.schedule} \u00b7 last ran {${check}.lastBeatAgeMinutes} min ago`,
        when: `${check} && !${check}.ok && ${check}.lastBeatAgeMinutes != ''`,
      },
      {
        type: 'notice',
        tone: 'error',
        title: job.label,
        text: `NOT RUNNING {${check}.code|'no reading'} \u00b7 {${check}.schedule} \u00b7 it has never reported a run`,
        when: `${check} && !${check}.ok && ${check}.lastBeatAgeMinutes == ''`,
      },
      { type: 'notice', tone: job.destructive ? 'error' : 'warning', text: `${job.what}\n\n${job.consequence}` },
      // The console's card keeps the real run locked until a preview has been read in this session (AGL-1949):
      // the preview arms it, a preview that failed disarms it, and running spends the look it was armed by.
      {
        type: 'notice',
        tone: 'info',
        text: 'Preview first \u2014 the real run stays locked until you have read what it would do.',
        when: `!session.armed.${armKey(job.id)}`,
      },
      {
        type: 'actions',
        footer: `Preview first. ${job.previewShows} The real run needs a reason of at least ${reasonMin} characters${
          job.confirmPhrase ? ' and the phrase typed exactly' : ''
        }.`,
        items: [
          {
            id: `${job.id}.preview`,
            label: 'Preview (dry run)',
            icon: 'eye|visibility',
            method: 'GET',
            url: job.path,
            reload: false,
            arm: armKey(job.id),
            success: 'What a real run would do',
            report: RUN_REPORT,
          },
          {
            id: `${job.id}.run`,
            label: 'Run for real',
            icon: 'play.fill|play_arrow',
            when: `session.armed.${armKey(job.id)}`,
            disarm: armKey(job.id),
            destructive: job.destructive,
            confirm: job.consequence,
            url: job.path,
            prompt: job.confirmPhrase
              ? [
                  {
                    key: 'confirm',
                    label: 'Confirmation phrase',
                    kind: 'text',
                    required: true,
                    help: `Type ${job.confirmPhrase} exactly, case and spacing included. The server refuses the run without it.`,
                    mustMatch: job.confirmPhrase,
                  },
                ]
              : [],
            reason: true,
            body: { dryRun: false, reason: '{form.reason}', ...(job.confirmPhrase ? { confirm: '{form.confirm}' } : {}) },
            reload: false,
            success: 'Run complete',
            report: RUN_REPORT,
          },
        ],
      },
    )
  }
  return {
    id: 'core.staff.maintenance',
    title: 'Maintenance',
    subtitle: 'Scheduled jobs and running one by hand',
    icon: 'hammer|construction',
    scope: 'staff',
    group: 'staff',
    order: 15,
    requires: 'staff.is',
    links: ['/admin/maintenance'],
    load: { crons: { url: '/api/health/crons', optional: true, accept: [503] } },
    blocks,
  }
}

/** A feature key as words: `abTesting` is "Ab testing" (the console shows the key; this is for reading). */
const keyWords = (key) => {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * The override screen (`admin/orgs/{id}`'s "Override" dialog): the plan, a staff comp, every quota, every feature
 * and every release flag, one input each, with what the organization holds now. The route (`/api/admin/org-override`)
 * replaces the lot, an empty quota or an "inherit" meaning "delete the override", so the whole set is always sent.
 */
export function orgOverrideScreen(override) {
  const tri = [
    { value: '', label: 'Inherit the plan' },
    { value: 'true', label: 'On' },
    { value: 'false', label: 'Off' },
  ]
  const fields = [
    {
      key: 'reason',
      label: 'Reason',
      kind: 'select',
      required: true,
      options: override.reasons,
      help: 'Overrides change what a customer is billed against. The audit row is append-only, so the reason cannot be added later.',
    },
    { key: 'note', label: `Note (required for Other, up to ${override.noteMax} characters)`, kind: 'multiline' },
    {
      key: 'plan',
      label: 'Stored plan',
      kind: 'select',
      initial: '{item.plan}',
      options: [{ value: '', label: 'No plan (reads as Free)' }, ...override.plans],
      help: 'Where a live subscription decides the plan this is edited as it always was. Without one a plan has to be a staff comp, below.',
    },
    { key: 'changeComp', label: 'Change the staff comp', kind: 'toggle', help: 'A comp grants a plan with no subscription behind it. Only for a workspace with no live subscription.' },
    {
      key: 'compPlan',
      label: 'Comp plan (blank removes the comp)',
      kind: 'select',
      initial: '{item.entitlements.planComp.plan}',
      when: 'form.changeComp',
      options: [{ value: '', label: 'No comp' }, ...override.plans.filter((plan) => plan.value !== 'free')],
    },
    {
      key: 'compUncapped',
      label: 'The comp lifts every cap',
      kind: 'toggle',
      initial: '{item.entitlements.planComp.uncapped}',
      when: 'form.changeComp && form.compPlan',
    },
    ...override.quotas.map(({ key, label }) => ({
      key: `quota.${key}`,
      label: `Limit: ${label}`,
      kind: 'number',
      initial: `{item.entitlements.${key}}`,
      help: 'Empty inherits the plan default. 0 is a real limit of none.',
    })),
    ...override.features.map((key) => ({
      key: `feature.${key}`,
      label: `Feature: ${keyWords(key)}`,
      kind: 'select',
      initial: `{item.entitlements.features.${key}}`,
      options: tri,
    })),
    ...override.releaseFlags.map(({ key, label, defaultEnabled }) => ({
      key: `release.${key}`,
      label: `Early access: ${label}`,
      kind: 'select',
      initial: `{item.releaseFlags.${key}}`,
      when: 'staff.super',
      options: tri,
      help: `Super staff only. Off by default for everyone: ${defaultEnabled ? 'no' : 'yes'}.`,
    })),
  ]
  return {
    id: 'core.staff.orgOverride',
    title: 'Override {data.detail.org.name|params.orgId}',
    label: 'Override',
    subtitle: 'Plan, comp, limits and switches for one workspace',
    icon: 'slider.horizontal.3|tune',
    scope: 'staff',
    requires: 'staff.is',
    load: { detail: '/api/admin/org-detail?orgId={params.orgId}' },
    blocks: [
      {
        type: 'notice',
        tone: 'warning',
        text:
          'Every field below is sent, with what the workspace holds now, because the route replaces the whole set: an empty limit or "Inherit the plan" deletes that override. Billing and super staff only; early access is super only. Every save is audited with your reason.',
      },
      {
        type: 'form',
        id: 'override',
        object: 'data.detail.org',
        when: 'staff.role == super,billing',
        fields,
        submit: {
          label: 'Save the override',
          url: '/api/admin/org-override',
          body: {
            orgId: '{params.orgId}',
            plan: '{form.plan}',
            quotas: { $collect: { prefix: 'quota.', as: 'number' } },
            features: { $collect: { prefix: 'feature.', as: 'flag' } },
            releaseFlags: { $collect: { prefix: 'release.', as: 'flag' } },
            reason: '{form.reason}',
            note: '{form.note}',
            comp: {
              $if: {
                when: 'form.changeComp',
                then: { $if: { when: 'form.compPlan', then: { plan: '{form.compPlan}', uncapped: '{form.compUncapped}' }, else: '$null' } },
              },
            },
          },
          success: 'Saved, and audited',
          report: [{ text: '{response.planEffect.summary}', when: 'response.planEffect.summary' }],
          reload: true,
        },
      },
    ],
  }
}

const current = readFileSync(join(ROOT, SPEC), 'utf8')
const spec = JSON.parse(current)
const sources = await staffSources()
const replace = (id, change) => {
  const at = spec.screens.findIndex((entry) => entry.id === id)
  if (at < 0) {
    console.error(`${SPEC} has no screen ${id}, which this generator fills.`)
    process.exit(1)
  }
  spec.screens[at] = change(spec.screens[at])
}
replace('core.staff.health', (screen) => ({
  ...screen,
  constants: { probes: sources.probes, gatewayLabels: sources.gatewayLabels, gatewayOptions: sources.gatewayOptions },
}))
replace('core.staff.emails', (screen) => ({
  ...screen,
  constants: sources.emails,
  // The "Populate from" picker fills the merge tokens the console's test drawer does.
  blocks: screen.blocks.map((block) => ({
    ...block,
    actions: block.actions?.map((action) => ({
      ...action,
      prompt: action.prompt?.map((field) =>
        field.kind === 'lookup'
          ? { ...field, groups: field.groups.map((group) => ({ ...group, fill: sources.sampleFills[group.id] })) }
          : field,
      ),
    })),
  })),
}))
replace('core.staff.emailSuppressions', (screen) => ({ ...screen, constants: sources.suppressions }))
replace('core.staff.orgs', (screen) => ({ ...screen, constants: sources.margin }))
replace('core.staff.margin', (screen) => ({ ...screen, constants: sources.margin }))
replace('core.staff.revenue', (screen) => ({ ...screen, constants: sources.revenue }))
replace('core.staff.abuse', (screen) => ({ ...screen, constants: sources.abuse }))
replace('core.staff.lockdown', (screen) => ({ ...screen, constants: sources.lockdown }))
replace('core.staff.org', (screen) => ({ ...screen, constants: { lockReasons: sources.lockReasons, cancelReasons: sources.cancelReasons, impersonation: sources.impersonation } }))
replace('core.staff.pluginReview', (screen) => ({ ...screen, constants: sources.pluginReview }))
replace('core.staff.site', (screen) => ({
  ...screen,
  constants: { lockReasons: sources.lockReasons, tenantApex: sources.site.tenantApex, domain: sources.site.domain },
  blocks: screen.blocks.map((block) => ({
    ...block,
    ...(block.rows
      ? {
          rows: block.rows.map((row) =>
            row.label === 'Leaving notice'
              ? { ...row, value: row.when === 'item.org.leavingNoticeUntil' ? sources.site.leavingNotice.on : sources.site.leavingNotice.off }
              : row,
          ),
        }
      : {}),
  })),
}))
replace('core.staff.audit', (screen) => ({ ...screen, constants: sources.audit }))
replace('core.staff.quarantine', (screen) => ({ ...screen, constants: sources.quarantine }))
replace('core.staff.user', (screen) => ({ ...screen, constants: sources.user }))
replace('core.staff.settings', (screen) => ({ ...screen, constants: sources.settings }))
replace('core.staff.maintenance', () => maintenanceScreen(sources.jobs, sources.reasonMin))
replace('core.staff.orgOverride', () => orgOverrideScreen(sources.override))

const next = `${JSON.stringify(spec, null, 2)}\n`
if (next === current) {
  console.log(`ok ${SPEC}`)
} else if (CHECK) {
  console.error(`stale ${SPEC}: run node tools/scripts/generate-native-staff-constants.mjs`)
  process.exit(1)
} else {
  writeFileSync(join(ROOT, SPEC), next)
  console.log(`wrote ${SPEC}`)
}
