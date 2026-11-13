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

// The shared build locks on a Mac several sessions build on at once
// (/private/tmp/aglyn-xcodebuild.lock, /private/tmp/aglyn-gradle.lock), so two
// heavy builds never run together. native-release.mjs takes them through
// withBuildLock; session build scripts take them by the same protocol:
//
// - The lock is a directory. `mkdir` takes it; the holder writes its name to
//   `<lock>/owner`, so a stuck lock can be traced to the job holding it.
// - The queue is the file beside it (`aglyn-xcodebuild.queue`), one waiter
//   name per line, first come first served. A waiter appends its name once
//   (again if the line went missing), and only the waiter at the HEAD may
//   `mkdir` the lock. On taking it, it removes its own line.
// - Every exit, normal, failed or signalled, removes the waiter's queue line
//   and, if it holds the lock (owner is its name), removes the owner file and
//   the lock directory. A dead job never blocks the queue.
// - No queue file: a plain `mkdir` poll, and the queue is not created, so a
//   Mac with no queue users sees the same behaviour as before.
//
// Before this, native-release took the lock with a bare `mkdir` every 20 s and
// ignored the queue, so with queue users polling every few seconds it waited
// behind each of them in turn (2.5 h once), and it wrote no owner file.
//
//   node --test tools/scripts/lib/build-lock.test.mjs

import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { constants } from 'node:os'
import { join } from 'node:path'

/** The signals that release the lock on the way out; SIGKILL cannot be caught. */
export const RELEASE_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']

/** `/private/tmp/aglyn-xcodebuild.lock` → `/private/tmp/aglyn-xcodebuild.queue`. */
export function queuePathFor(lock) {
  return `${lock.replace(/\.lock$/, '')}.queue`
}

/**
 * The waiters in `queue`, head first, or null when there is no queue file.
 *
 * @param {string} queue
 * @returns {string[] | null}
 */
export function readQueue(queue) {
  let text
  try {
    text = readFileSync(queue, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/** Removes every `name` line from `queue`, if the file exists. */
export function leaveQueue(queue, name) {
  const lines = readQueue(queue)
  if (lines === null || !lines.includes(name)) return
  const rest = lines.filter((line) => line !== name)
  const temp = `${queue}.${process.pid}.tmp`
  writeFileSync(temp, rest.map((line) => `${line}\n`).join(''))
  renameSync(temp, queue)
}

/** The name in `<lock>/owner`, or '' when there is none. */
export function lockOwner(lock) {
  try {
    return readFileSync(join(lock, 'owner'), 'utf8').trim()
  } catch {
    return ''
  }
}

/**
 * One attempt at the lock: joins the queue when there is one, and takes the
 * lock only from its head (or at once when there is no queue).
 *
 * @param {{ lock: string, queue: string, name: string }} target
 * @returns {boolean} whether `name` now holds the lock
 */
export function tryTakeLock({ lock, queue, name }) {
  const lines = readQueue(queue)
  if (lines !== null) {
    if (!lines.includes(name)) appendFileSync(queue, `${name}\n`)
    // Re-read: another waiter may have appended in between.
    if ((readQueue(queue) ?? [name])[0] !== name) return false
  }
  try {
    mkdirSync(lock)
  } catch (error) {
    if (error.code === 'EEXIST') return false
    throw error
  }
  writeFileSync(join(lock, 'owner'), `${name}\n`)
  if (lines !== null) leaveQueue(queue, name)
  return true
}

/**
 * Leaves the queue and, when `name` holds the lock, releases it. Safe to call
 * more than once, and never removes a lock another job holds.
 */
export function releaseLock({ lock, queue, name }) {
  leaveQueue(queue, name)
  if (lockOwner(lock) !== name) return
  rmSync(join(lock, 'owner'), { force: true })
  try {
    rmdirSync(lock)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Runs `work` holding `lock`, waiting its turn in the queue first.
 *
 * A SIGINT, SIGTERM or SIGHUP while waiting leaves the queue and exits
 * 128 + the signal's number. While `work` runs, the first such signal is left
 * to `work` (native-release forwards it to its build), and the lock is
 * released once `work` settles, so the next job never starts beside a build
 * that is still winding down; the exit code is then 128 + the signal's
 * number. A second signal releases and exits at once.
 *
 * @template T
 * @param {string} lock
 * @param {() => T | Promise<T>} work
 * @param {{ name: string, pollMs?: number, log?: (line: string) => void }} options
 * @returns {Promise<T>}
 */
export async function withBuildLock(
  lock,
  work,
  { name, pollMs = 5_000, log = console.log },
) {
  const target = { lock, queue: queuePathFor(lock), name }
  let held = false
  let interrupted = null
  const release = () => releaseLock(target)
  const onSignal = (signal) => {
    if (held && !interrupted) {
      interrupted = signal
      return
    }
    release()
    process.exit(128 + constants.signals[signal])
  }
  process.on('exit', release)
  for (const signal of RELEASE_SIGNALS) process.on(signal, onSignal)
  try {
    let announced = false
    while (!tryTakeLock(target)) {
      if (!announced) log(`Waiting for ${lock} …`)
      announced = true
      await delay(pollMs)
    }
    held = true
    return await work()
  } finally {
    release()
    held = false
    process.off('exit', release)
    for (const signal of RELEASE_SIGNALS) process.off(signal, onSignal)
    if (interrupted) process.exitCode = 128 + constants.signals[interrupted]
  }
}
