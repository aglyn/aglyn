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
 * The jest runner every project in this workspace uses. It is jest's own
 * runner plus one behavior: a test file whose WORKER PROCESS died from a
 * memory-safety signal is dispatched a second time, to a fresh worker
 * (AGL-2528).
 *
 * ── WHAT GOES WRONG WITHOUT IT ──────────────────────────────────────────
 *
 * A jest worker crashes part-way through a long run. Jest attributes the
 * death to whichever test file that worker was carrying and reports:
 *
 *   ● Test suite failed to run
 *     A jest worker process (pid=71824) was terminated by another process:
 *     signal=SIGSEGV, exitCode=null.
 *
 * The run is then RED with an intact `Tests:` summary and zero failed
 * assertions — every test that executed passed, and the missing ones are the
 * file that never ran. It clears on re-run and under `--runInBand`, so the
 * honest reading at a release gate is indistinguishable from a real failure.
 *
 * Jest does not re-dispatch that file. `ChildProcessWorker._onExit` in
 * jest-worker re-sends a pending request only when the child exited with a
 * numeric code; a signal death carries `exitCode: null`, so it takes the
 * branch that turns the pending request into an error. Its own comment
 * records the reason — a retry would make things worse if an OOM killer was
 * freeing memory — which is why the retry here is restricted to the signals
 * an OOM killer does not send.
 *
 * ── WHAT THE CRASH ACTUALLY IS ──────────────────────────────────────────
 *
 * Not the test code, and not a heap limit. Every macOS crash report from
 * these deaths carries the same faulting frame and the same fault address:
 *
 *   EXC_BAD_ACCESS (SIGSEGV), KERN_INVALID_ADDRESS at 0x0e
 *   v8::internal::ClearStaleLeftTrimmedPointerVisitor::VisitRootPointers
 *   v8::internal::InternalFrame::Iterate
 *   v8::internal::Isolate::Iterate
 *   v8::internal::Heap::IterateRoots
 *   v8::internal::MarkCompactCollector::MarkRoots
 *   v8::internal::MarkCompactCollector::MarkLiveObjects
 *
 * That is V8 marking GC roots and dereferencing a stale one, under node
 * v24.16.0 / V8 13.6.233.17. Nothing was out of memory: a worker's heap
 * climbs from 117 MB over its first test file to a peak of 999 MB over 99 of
 * them, against a multi-gigabyte old-space ceiling on a 68 GB machine, and
 * the crash reports show ~860 MB of V8 regions rather than an exhausted heap.
 *
 * That measurement is also why `workerIdleMemoryLimit` is NOT set. It is the
 * mitigation jest's own message points at, and it would bound the heap these
 * collections walk, but it treats an exhaustion that is not happening, it has
 * not been shown to change the crash rate — 2 deaths in 48 loaded runs leaves
 * no room to measure a difference — and `shouldRunInBand` in `@jest/core`
 * disables every in-band shortcut whenever it is set, so each small run pays
 * for workers it did not need. Recovery is what this workspace controls.
 *
 * ── WHY THIS DOES NOT HIDE REAL FAILURES ────────────────────────────────
 *
 * Only SIGSEGV, SIGBUS and SIGILL are retried, and only once per file. Those
 * three mean the process executed an illegal memory access — a defect in the
 * engine or a native addon, never an assertion. A killed worker (SIGKILL
 * from an OOM killer, SIGTERM from a step timeout), a worker jest itself
 * diagnosed as out of memory, and a worker that exited with any numeric code
 * are all left exactly as jest reported them. A test that fails still fails:
 * a failing assertion is a test RESULT, not a worker death, and never
 * reaches this path.
 *
 * A retried file is announced on stderr with its signal, so a crash is
 * always visible in the log even when the run ends green. If a run loses
 * more files than `MAX_CRASHED_FILES` the retry is abandoned and every one
 * of them is reported as jest first saw it, because that many native crashes
 * is a broken toolchain rather than the flake this exists to absorb.
 */

const path = require('node:path')

// jest's own runner, which `jest` depends on and npm hoists to the workspace
// root. Subclassing it keeps every scheduling decision — worker count, the
// in-band shortcuts, retry-on-numeric-exit — exactly as jest makes it.
const TestRunner = require('jest-runner').default

/**
 * The message jest-worker builds for a child that exited on a signal. The
 * captured group is the only part that distinguishes a native crash from a
 * deliberate kill.
 */
const WORKER_SIGNAL_DEATH =
  /^A jest worker process \(pid=\d+\) was terminated by another process: signal=(\w+)/

/** Signals a process raises against itself by executing bad memory. */
const CRASH_SIGNALS = new Set(['SIGSEGV', 'SIGBUS', 'SIGILL'])

/** Above this many crashed files in one run, report rather than retry. */
const MAX_CRASHED_FILES = 5

function crashSignal(error) {
  const message = typeof error === 'string' ? error : error && error.message
  if (typeof message !== 'string') return null
  const match = WORKER_SIGNAL_DEATH.exec(message)
  return match && CRASH_SIGNALS.has(match[1]) ? match[1] : null
}

class WorkerCrashRetryRunner extends TestRunner {
  constructor(globalConfig, context, options) {
    super(globalConfig, context, options)
    // `test-file-failure` listeners the scheduler registered, called by hand.
    this._failureListeners = new Set()
    // `[test, error]` pairs held back from the first pass.
    this._crashed = []
    // True while the second pass runs, so its failures are reported.
    this._retrying = false
    super.on('test-file-failure', ([test, error]) => {
      if (!this._retrying && crashSignal(error) !== null) {
        this._crashed.push([test, error])
        return
      }
      this._report(test, error)
    })
  }

  on(eventName, listener) {
    if (eventName !== 'test-file-failure') return super.on(eventName, listener)
    this._failureListeners.add(listener)
    return () => this._failureListeners.delete(listener)
  }

  async runTests(tests, watcher, options) {
    await super.runTests(tests, watcher, options)
    const crashed = this._crashed
    this._crashed = []
    if (crashed.length === 0) return
    this._retrying = true
    try {
      if (crashed.length > MAX_CRASHED_FILES) {
        for (const [test, error] of crashed) this._report(test, error)
        return
      }
      for (const [test, error] of crashed) {
        const where = path.relative(this._globalConfig.rootDir, test.path)
        process.stderr.write(
          `A jest worker died on ${where} (${crashSignal(error)}). ` +
            'Re-running that file on a fresh worker (AGL-2528).\n',
        )
      }
      await super.runTests(
        crashed.map(([test]) => test),
        watcher,
        options,
      )
    } finally {
      this._retrying = false
    }
  }

  _report(test, error) {
    for (const listener of this._failureListeners) listener([test, error])
  }
}

module.exports = WorkerCrashRetryRunner
