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

import { SCHEDULED_JOBS } from '@aglyn/aglyn/server'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * AGL-2134 — a cron is wired in THREE places and any one of them can be
 * forgotten.
 *
 * `campaigns/process-scheduled` had been correct and unreachable since
 * AGL-272: a `schedule` entry, a `case` arm mapping that cron string to a
 * route, and a `workflow_dispatch` option are three separate edits in one
 * file, and it had none of them. The failure is silent in the worst way —
 * the console shows the customer a `Scheduled` chip, and the send never
 * happens.
 *
 * So the assertion is not "campaigns is listed". It is the invariant that
 * every schedule resolves to a route and every route can also be run by
 * hand — which fails on the NEXT half-wired cron too. Removing any one of
 * the three edits AGL-2134 made fails a different test below.
 */
describe('scheduled-crons.yml wiring', () => {
  const repoRoot = join(__dirname, '..', '..', '..')
  const workflow = readFileSync(
    join(repoRoot, '.github', 'workflows', 'scheduled-crons.yml'),
    'utf8',
  )

  /** Every `- cron: '<expr>'` under `on.schedule`. */
  const scheduled = [...workflow.matchAll(/^\s*- cron: '([^']+)'/gm)].map(
    (match) => match[1],
  )
  /**
   * A shell word, with one layer of quoting removed.
   *
   * A route carrying a query string has to be quoted in the `case` arm —
   * `?` is a pathname-expansion metacharacter, so `path=/api/x?month=current`
   * is a glob the shell is entitled to rewrite. The quotes are part of the
   * SHELL syntax, not part of the route, and a parser that keeps them
   * compares `'/api/x?month=current'` against `/api/x?month=current` and
   * reports a correctly wired cron as missing (AGL-2219 added the first such
   * route).
   */
  const unquote = (word: string) =>
    /^'.*'$/.test(word) || /^".*"$/.test(word) ? word.slice(1, -1) : word

  /** Every `'<expr>') path=<route> ;;` arm in the resolver. */
  const caseArms = new Map(
    [...workflow.matchAll(/^\s*'([^']+)'\)\s*path=(\S+)\s*;;/gm)].map(
      (match) => [match[1], unquote(match[2])] as const,
    ),
  )
  /** Every `- /api/...` line in the `workflow_dispatch` choice list. */
  const dispatchOptions = new Set(
    [...workflow.matchAll(/^\s*- (\/api\/\S+)$/gm)].map((match) => match[1]),
  )

  it('parses the workflow at all', () => {
    // A regex that silently matched nothing would make every assertion
    // below vacuously true — the exact shape this file exists to catch.
    expect(scheduled.length).toBeGreaterThanOrEqual(10)
    expect(caseArms.size).toBeGreaterThanOrEqual(10)
    expect(dispatchOptions.size).toBeGreaterThanOrEqual(10)
    // And every route parsed out of a `case` arm is a ROUTE, not a shell
    // word that still has its quoting on. A leftover quote makes the arm
    // compare unequal to its `workflow_dispatch` twin, which reads as a
    // half-wired cron rather than as a parser that stopped one step short.
    for (const route of caseArms.values()) {
      expect(route).toMatch(/^\/api\//)
      expect(route).not.toMatch(/['"]/)
    }
  })

  it('resolves EVERY schedule to a route', () => {
    const unresolved = scheduled.filter((cron) => !caseArms.has(cron))
    expect(unresolved).toEqual([])
  })

  it('offers every scheduled route as a manual dispatch too', () => {
    // A cron that cannot be triggered by hand cannot be tested, re-run
    // after an incident, or verified after a deploy.
    const missing = scheduled
      .map((cron) => caseArms.get(cron))
      .filter((route): route is string => Boolean(route))
      .filter((route) => !dispatchOptions.has(route))
    expect(missing).toEqual([])
  })

  it('has no case arm for a schedule that no longer fires', () => {
    // The other direction: a removed `- cron:` line leaves dead routing
    // behind, and the next person reads it as proof the job still runs.
    const orphaned = [...caseArms.keys()].filter(
      (cron) => !scheduled.includes(cron),
    )
    expect(orphaned).toEqual([])
  })

  it('keeps nothing sub-hourly on GitHub Actions (AGL-1617)', () => {
    // The measurement that moved the frequent sweeps off this runner:
    // `gh run list` over 2026-08-22..24 shows this workflow firing two to
    // four times an hour when the `*/15` and `*/20` entries alone demanded
    // seven — under 40% delivery, because GitHub coalesces and drops
    // scheduled triggers under load and does it per workflow. The daily and
    // weekly jobs absorb that; a fifteen-minute one cannot, and the campaign
    // processor went 104 minutes without a beat.
    //
    // So this is not "campaigns moved". It is the invariant that fails on the
    // NEXT frequent cron somebody adds here, which would re-open AGL-1617
    // without anybody noticing until a customer's campaign was late.
    const subHourly = scheduled.filter((cron) => {
      const minuteField = cron.split(/\s+/)[0]
      return minuteField.includes('/') || minuteField.includes(',')
    })
    expect(subHourly).toEqual([])
  })

  /**
   * AGL-1955 — a FOURTH place, and the one that notices a job going away.
   *
   * The three edits above keep a cron REACHABLE. None of them notices a
   * `- cron:` line being deleted: remove the schedule and its case arm
   * together and every assertion here still passes, because the invariant
   * they hold is internal consistency, not existence. That deletion is the
   * whole of AGL-1955 — the job stops firing, nothing runs, nothing fails,
   * nothing says anything.
   *
   * `SCHEDULED_JOBS` is what `/api/health/crons` judges against, so it is the
   * copy that has to stay true to the workflow. These tests hold it in both
   * directions: a schedule with no inventory row would be a job nobody
   * watches, and an inventory row with no schedule is the alarm firing —
   * correctly — for a job that really did stop being scheduled.
   */
  describe('the absence detector inventory (AGL-1955)', () => {
    const inventoryByCron = new Map<string, (typeof SCHEDULED_JOBS)[number]>(
      SCHEDULED_JOBS.filter((job) => job.runner === 'github-actions').map(
        (job) => [`${job.cron} ${job.target}`, job] as const,
      ),
    )

    it('watches EVERY schedule in the workflow', () => {
      const unwatched = scheduled
        .map((cron) => `${cron} ${caseArms.get(cron)}`)
        .filter((key) => !inventoryByCron.has(key))
      expect(unwatched).toEqual([])
    })

    it('has no inventory row for a schedule that no longer exists', () => {
      // Deliberately the direction that FAILS THE BUILD when someone deletes
      // a `- cron:` line. The health check would have gone red in production
      // a day later; this makes it a red test at the commit instead, and
      // makes removing a job a two-place decision somebody has to mean.
      const workflowKeys = new Set(
        scheduled.map((cron) => `${cron} ${caseArms.get(cron)}`),
      )
      const orphaned = [...inventoryByCron.keys()].filter(
        (key) => !workflowKeys.has(key),
      )
      expect(orphaned).toEqual([])
    })

    it('gives every job a stable id, a grace and a consequence', () => {
      for (const job of SCHEDULED_JOBS) {
        expect(job.id).toMatch(/^[a-z][a-z0-9-]*$/)
        expect(job.graceMinutes).toBeGreaterThan(0)
        // The board renders this. A row with no consequence on it is a red
        // light with a code, which is a puzzle rather than an instruction.
        expect(job.drives.length).toBeGreaterThan(40)
      }
      expect(new Set(SCHEDULED_JOBS.map((job) => job.id)).size).toBe(
        SCHEDULED_JOBS.length,
      )
    })
  })

  /**
   * AGL-1617 — the OTHER runner, held to the same standard.
   *
   * The block above proves every `github-actions` row against the workflow in
   * both directions. Until now the `cloud-scheduler` rows had no such proof at
   * all: `plugin-jobs-beat` was asserted to merely *not* be in the workflow,
   * which is a test that passes for a job nobody schedules anywhere. That was
   * tolerable while there was one of them. There are now three, two of which
   * drive a feature `/product/marketing` sells, so the same both-directions
   * invariant has to hold against `cloud/functions/src/index.ts`.
   *
   * Read as TEXT, not imported: `cloud/functions` is a standalone npm package
   * outside the nx workspace (firebase-admin and firebase-functions only), so
   * this suite cannot import from it. Same reason the workflow above is
   * regex-parsed rather than YAML-loaded, and the same mitigation — the first
   * test refuses to let a regex that matched nothing make the rest vacuous.
   */
  describe('the Cloud Scheduler inventory (AGL-1617)', () => {
    const functions = readFileSync(
      join(repoRoot, 'cloud', 'functions', 'src', 'index.ts'),
      'utf8',
    )

    const fastSchedule = /^const CONSOLE_FAST_CRON_SCHEDULE = '([^']+)'$/m.exec(
      functions,
    )?.[1]
    const fastRoutesBlock = /const CONSOLE_FAST_CRON_ROUTES[^=]*=\s*\[([^\]]*)\]/.exec(
      functions,
    )?.[1]
    const fastRoutes = [
      ...(fastRoutesBlock ?? '').matchAll(/'(\/api\/[^']+)'/g),
    ].map((match) => match[1])

    /** Inventory rows driven by `consoleFastCrons`, keyed by the route. */
    const fastJobs = SCHEDULED_JOBS.filter(
      (job) => job.runner === 'cloud-scheduler' && job.id !== 'plugin-jobs-beat',
    )

    it('parses the functions file at all', () => {
      expect(fastSchedule).toBeDefined()
      expect(fastRoutes.length).toBeGreaterThanOrEqual(2)
      // And the constant is not decorative. A schedule pinned in a named
      // const that the `onSchedule` options do not actually use would pass
      // every assertion below while the deployed job ran on something else.
      expect(functions).toContain('schedule: CONSOLE_FAST_CRON_SCHEDULE')
      expect(functions).toContain(
        'CONSOLE_FAST_CRON_ROUTES.map((route) => postConsoleCron(route))',
      )
    })

    it('runs the campaign processor often enough to honour a clock time', () => {
      // Moved here from the workflow block, unchanged in substance: the
      // composer takes a `datetime-local` down to the minute, so a sweep
      // slower than every fifteen turns "9:00 AM" into "some time today" —
      // correct wiring, false promise. The runner changed; the promise did
      // not.
      expect(fastRoutes).toContain('/api/campaigns/process-scheduled')
      const everyNMinutes = /^\*\/(\d+)$/.exec(
        (fastSchedule as string).split(/\s+/)[0],
      )
      expect(everyNMinutes).not.toBeNull()
      expect(Number(everyNMinutes?.[1])).toBeLessThanOrEqual(15)
    })

    it('watches every route the scheduled function drives', () => {
      // A route added to `consoleFastCrons` with no inventory row is a job
      // nobody watches — AGL-1955's whole shape, on the new runner.
      const unwatched = fastRoutes.filter(
        (route) => !fastJobs.some((job) => job.target.includes(route)),
      )
      expect(unwatched).toEqual([])
    })

    it('has no inventory row for a route the function no longer drives', () => {
      // The direction that FAILS THE BUILD on a deletion. Take a route out of
      // `CONSOLE_FAST_CRON_ROUTES` and the health check would go red in
      // production forty-five minutes later; this makes it red at the commit.
      const orphaned = fastJobs.filter(
        (job) => !fastRoutes.some((route) => job.target.includes(route)),
      )
      expect(orphaned.map((job) => job.id)).toEqual([])
    })

    it('judges them against the schedule the function actually declares', () => {
      // The AGL-1617 failure in miniature: an inventory cron that disagrees
      // with the scheduler is a check that has quietly redefined "on time".
      for (const job of fastJobs) expect(job.cron).toBe(fastSchedule)
    })

    it('holds these to a TIGHTER grace than the GitHub Actions jobs', () => {
      // The point of the move, and the thing a future edit could silently
      // undo. Ninety minutes on a fifteen-minute schedule is six missed
      // fires before anyone is told; that number was GitHub's drift budget
      // and there is no longer any reason to pay it. Widening it back is
      // exactly the "make the monitor agree with reality by lowering the bar"
      // option AGL-1617 rejected.
      for (const job of fastJobs) {
        expect(job.graceMinutes).toBeLessThanOrEqual(45)
        // …and not so tight that one cold start or one retry reds the board.
        expect(job.graceMinutes).toBeGreaterThanOrEqual(30)
      }
      const githubGraces = SCHEDULED_JOBS.filter(
        (job) => job.runner === 'github-actions',
      ).map((job) => job.graceMinutes)
      expect(Math.min(...githubGraces)).toBeGreaterThan(45)
    })

    it('still watches the every-minute beat, which is in neither list', () => {
      // `firebase-schedule-pluginJobsBeat-us-central1`. Cloud Scheduler
      // spells its schedule `every 1 minutes`; the inventory holds the
      // equivalent five-field expression, so this pins BOTH spellings rather
      // than asserting the row merely isn't in the workflow.
      const beat = SCHEDULED_JOBS.find((job) => job.id === 'plugin-jobs-beat')
      expect(beat?.runner).toBe('cloud-scheduler')
      expect(beat?.cron).toBe('* * * * *')
      expect(scheduled).not.toContain(beat?.cron)
      expect(functions).toContain('export const pluginJobsBeat = onSchedule(')
      expect(functions).toContain("schedule: 'every 1 minutes'")
    })
  })

  /**
   * AGL-2359 — the workflow lives on `main`, the routes live in production.
   *
   * `finish-domain-attachments` and its every-20-minutes schedule landed in
   * one correct commit (AGL-1996/AGL-2010) and the cron then 404ed ~72 times
   * a day against a production deploy 236 commits behind. The job now asks
   * `tools/scripts/cron-deploy-state.sh` whether the route's source file is
   * at `refs/heads/production` and skips the POST when it provably is not.
   *
   * That guard is only worth having while it can still fail, and it rests on
   * a route → source-file mapping that nothing else re-derives. So the tests
   * below hold both ends: the mapping must resolve every scheduled route to a
   * file that really exists, and the POST step must keep failing on a 404.
   */
  describe('the deploy-ordering guard (AGL-2359)', () => {
    const script = join(repoRoot, 'tools', 'scripts', 'cron-deploy-state.sh')
    const implFor = (route: string) =>
      execFileSync(script, ['--impl', route], { encoding: 'utf8' }).trim()

    it('resolves every scheduled route to a file that exists', () => {
      // A mapping that points at a moved or renamed file is not a harmless
      // typo: that file is absent from BOTH refs, so the route would read as
      // "not deployed yet" forever and the cron would stop silently. The
      // script fails closed on exactly this (it answers `unknown`, and the
      // job POSTs anyway) — this test is the other half, catching it at the
      // commit that breaks it rather than at the next 404.
      const missing = [...caseArms.values()]
        .map((route) => [route, implFor(route)] as const)
        .filter(([, impl]) => !impl || !existsSync(join(repoRoot, impl)))
      expect(missing).toEqual([])
    })

    it('does not resolve a plugin-served route by App Router convention', () => {
      // The specific trap. `/api/campaigns/process-scheduled` has no
      // `apps/console/app/api/campaigns/...` file on any ref — the marketing
      // plugin's server router serves it through `/api/[...pluginApi]` — and
      // it returns 200 in production today. A guard that resolved it by
      // convention would mark a working cron as undeployed and quietly stop
      // calling it: AGL-2134's silent-inertness bug, reintroduced by the
      // guard meant to prevent a different one.
      const impl = implFor('/api/campaigns/process-scheduled')
      expect(impl).not.toMatch(/^apps\/console\/app\//)
      expect(existsSync(join(repoRoot, impl))).toBe(true)
    })

    it('strips a query string before resolving to a file', () => {
      // `?month=current` (AGL-2219) is a route the workflow POSTs but not a
      // path on disk.
      expect(implFor('/api/billing/report-usage?month=current')).toBe(
        implFor('/api/billing/report-usage'),
      )
    })

    it('gates the POST on a PROVEN absence, and on nothing else', () => {
      // The skip must be conditioned on the route being absent from the
      // deployed tree — never on the response code. `unknown`, which is what
      // the script answers for every question it cannot settle, must still
      // POST.
      const gate = /^\s*if:\s*(.+)$/m.exec(
        workflow.slice(workflow.indexOf('POST the console cron route')),
      )?.[1]
      expect(gate).toBe("steps.deployed.outputs.state != 'not-deployed'")
    })

    it('still fails the job on a 404 from a route that IS deployed', () => {
      // The regression that would make this whole change worthless: an arm
      // that forgives 404 turns the workflow into a check that cannot fail,
      // and a broken cron route is precisely what it exists to catch.
      expect(workflow).toContain('Cron route returned $code (expected 200)')
      expect(workflow).not.toMatch(/code" = "404"|code" == "404"|404\).*continue/)
    })
  })
})
