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
 * runs. Those live in console modules (`utils/platform-health.ts`,
 * `utils/maintenance-jobs.ts`), so this generator READS them and writes only
 * their values into `libs/native/screens/staff.screens.json`: the probe
 * texts as the `constants` of `core.staff.health`, and the whole
 * `core.staff.maintenance` screen, one block group per job. A reworded
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
  const { createJiti } = require('jiti')
  const jiti = createJiti(join(ROOT, 'package.json'), { interopDefault: true, fsCache: false, alias: aliases() })
  const health = await jiti.import(join(ROOT, 'apps/console/utils/platform-health.ts'))
  const maintenance = await jiti.import(join(ROOT, 'apps/console/utils/maintenance-jobs.ts'))
  return {
    probes: Object.fromEntries(
      health.HEALTH_PROBES.map(({ id, label, path, auth, meaning, remedy }) => [id, { label, path, auth, meaning, remedy }]),
    ),
    reasonMin: maintenance.MAINTENANCE_REASON_MIN,
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
      {
        type: 'notice',
        tone: 'success',
        title: job.label,
        text: `Scheduled \u00b7 {${check}.schedule} \u00b7 last report {${check}.lastBeatAgeMinutes|'never'} min ago`,
        when: `${check}.ok`,
      },
      {
        type: 'notice',
        tone: 'error',
        title: job.label,
        text: `NOT RUNNING {${check}.code|'no reading'} \u00b7 {${check}.schedule} \u00b7 last report {${check}.lastBeatAgeMinutes|'never'} min ago`,
        when: `${check} && !${check}.ok`,
      },
      { type: 'notice', tone: job.destructive ? 'error' : 'warning', text: `${job.what}\n\n${job.consequence}` },
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
            success: 'What a real run would do',
            report: RUN_REPORT,
          },
          {
            id: `${job.id}.run`,
            label: 'Run for real',
            icon: 'play.fill|play_arrow',
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
replace('core.staff.health', (screen) => ({ ...screen, constants: { probes: sources.probes } }))
replace('core.staff.maintenance', () => maintenanceScreen(sources.jobs, sources.reasonMin))

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
