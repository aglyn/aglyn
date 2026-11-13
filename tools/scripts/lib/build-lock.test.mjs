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

// The shared build lock's FIFO protocol (build-lock.mjs), on a lock and queue
// in a temp folder. Pure node; the signal cases run a child node process.
//
//   node --test tools/scripts/lib/build-lock.test.mjs

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  lockOwner,
  queuePathFor,
  readQueue,
  releaseLock,
  tryTakeLock,
  withBuildLock,
} from './build-lock.mjs'

const LIB = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), 'build-lock.mjs'),
).href

function fixture({ queue = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'build-lock-'))
  const lock = join(dir, 'aglyn-xcodebuild.lock')
  if (queue) writeFileSync(queuePathFor(lock), '')
  return { dir, lock, queue: queuePathFor(lock) }
}

/** What another queue user (a session's lock script) does to hold the lock. */
function holdAs(lock, name) {
  mkdirSync(lock)
  writeFileSync(join(lock, 'owner'), `${name}\n`)
}

describe('queuePathFor', () => {
  it('puts the queue beside the lock', () => {
    assert.equal(
      queuePathFor('/private/tmp/aglyn-xcodebuild.lock'),
      '/private/tmp/aglyn-xcodebuild.queue',
    )
  })
})

describe('tryTakeLock', () => {
  it('takes a free lock at once when there is no queue, and creates none', () => {
    const { lock, queue } = fixture({ queue: false })
    assert.equal(tryTakeLock({ lock, queue, name: 'ship' }), true)
    assert.equal(lockOwner(lock), 'ship')
    assert.equal(existsSync(queue), false)
  })

  it('waits behind the head of the queue, then takes the lock and leaves the queue', () => {
    const { lock, queue } = fixture()
    writeFileSync(queue, 'lane-a\n')
    assert.equal(tryTakeLock({ lock, queue, name: 'ship' }), false)
    assert.deepEqual(readQueue(queue), ['lane-a', 'ship'])
    assert.equal(existsSync(lock), false, 'the free lock is left to the head')
    assert.equal(tryTakeLock({ lock, queue, name: 'ship' }), false)
    assert.deepEqual(readQueue(queue), ['lane-a', 'ship'], 'joins only once')

    assert.equal(tryTakeLock({ lock, queue, name: 'lane-a' }), true)
    assert.deepEqual(readQueue(queue), ['ship'])
    releaseLock({ lock, queue, name: 'lane-a' })

    assert.equal(tryTakeLock({ lock, queue, name: 'ship' }), true)
    assert.equal(lockOwner(lock), 'ship')
    assert.deepEqual(readQueue(queue), [])
  })

  it('stays queued while the head finds the lock held', () => {
    const { lock, queue } = fixture()
    holdAs(lock, 'lane-a')
    assert.equal(tryTakeLock({ lock, queue, name: 'ship' }), false)
    assert.deepEqual(readQueue(queue), ['ship'])
    assert.equal(lockOwner(lock), 'lane-a')
  })

  it('joins again when its queue line went missing', () => {
    const { lock, queue } = fixture()
    // Its line was there, and a peer's rewrite of the file dropped it.
    writeFileSync(queue, 'lane-a\n')
    assert.equal(tryTakeLock({ lock, queue, name: 'ship' }), false)
    assert.deepEqual(readQueue(queue), ['lane-a', 'ship'])
  })
})

describe('releaseLock', () => {
  it('never removes a lock another job holds, but leaves the queue', () => {
    const { lock, queue } = fixture()
    holdAs(lock, 'lane-a')
    writeFileSync(queue, 'ship\nlane-b\n')
    releaseLock({ lock, queue, name: 'ship' })
    assert.equal(lockOwner(lock), 'lane-a')
    assert.deepEqual(readQueue(queue), ['lane-b'])
  })

  it('releases its own lock, and a second call is harmless', () => {
    const { lock, queue } = fixture()
    assert.equal(tryTakeLock({ lock, queue, name: 'ship' }), true)
    releaseLock({ lock, queue, name: 'ship' })
    releaseLock({ lock, queue, name: 'ship' })
    assert.equal(existsSync(lock), false)
  })
})

describe('withBuildLock', () => {
  it('runs in queue order and releases after the work', async () => {
    const { lock, queue } = fixture()
    holdAs(lock, 'lane-a')
    writeFileSync(queue, 'lane-b\n')
    const lines = []
    const ran = []
    const ship = withBuildLock(
      lock,
      async () => {
        ran.push('ship')
        assert.equal(lockOwner(lock), 'ship')
        return 'archived'
      },
      { name: 'ship', pollMs: 5, log: (line) => lines.push(line) },
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.deepEqual(readQueue(queue), ['lane-b', 'ship'])
    releaseLock({ lock, queue, name: 'lane-a' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.deepEqual(ran, [], 'lane-b is ahead')
    assert.equal(tryTakeLock({ lock, queue, name: 'lane-b' }), true)
    ran.push('lane-b')
    releaseLock({ lock, queue, name: 'lane-b' })
    assert.equal(await ship, 'archived')
    assert.deepEqual(ran, ['lane-b', 'ship'])
    assert.deepEqual(lines, [`Waiting for ${lock} …`])
    assert.equal(existsSync(lock), false)
    assert.deepEqual(readQueue(queue), [])
  })

  it('releases when the work throws', async () => {
    const { lock, queue } = fixture()
    await assert.rejects(
      withBuildLock(
        lock,
        () => {
          throw new Error('xcodebuild exited with 65')
        },
        { name: 'ship', log: () => {} },
      ),
      /65/,
    )
    assert.equal(existsSync(lock), false)
    assert.deepEqual(readQueue(queue), [])
  })
})

/**
 * A child holding or waiting for `lock`; while holding it runs `sleep` the way
 * native-release runs a build, passing a signal on to it.
 */
function child(lock, name) {
  const script = `
    import { spawn } from 'node:child_process'
    import { RELEASE_SIGNALS, withBuildLock } from ${JSON.stringify(LIB)}
    console.log('waiting')
    await withBuildLock(${JSON.stringify(lock)}, () => new Promise((resolve, reject) => {
      const build = spawn('sleep', ['30'], { stdio: 'ignore' })
      const forward = (signal) => build.kill(signal)
      for (const signal of RELEASE_SIGNALS) process.on(signal, forward)
      build.on('close', (code, signal) => code === 0 ? resolve() : reject(new Error('build ' + signal)))
      console.log('holding')
    }), { name: ${JSON.stringify(name)}, pollMs: 10, log: () => {} }).catch(() => {})
  `
  const proc = spawn(process.execPath, ['--input-type=module', '-e', script], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  let out = ''
  proc.stdout.on('data', (chunk) => (out += chunk))
  const saw = (text) =>
    new Promise((resolve) => {
      const check = setInterval(() => {
        if (out.includes(text)) {
          clearInterval(check)
          resolve()
        }
      }, 10)
    })
  const exited = new Promise((resolve) => proc.on('close', resolve))
  return { proc, saw, exited }
}

describe('withBuildLock under a signal', () => {
  it('leaves the queue and exits 143 when killed while waiting', async () => {
    const { lock, queue } = fixture()
    holdAs(lock, 'lane-a')
    const { proc, saw, exited } = child(lock, 'ship-waiting')
    await saw('waiting')
    while (!readQueue(queue).includes('ship-waiting'))
      await new Promise((resolve) => setTimeout(resolve, 10))
    proc.kill('SIGTERM')
    assert.equal(await exited, 143)
    assert.deepEqual(readQueue(queue), [])
    assert.equal(lockOwner(lock), 'lane-a', 'the holder keeps its lock')
  })

  it('stops the build, releases the lock and exits 143 when killed while holding', async () => {
    const { lock, queue } = fixture()
    const { proc, saw, exited } = child(lock, 'ship-holding')
    await saw('holding')
    assert.equal(lockOwner(lock), 'ship-holding')
    proc.kill('SIGTERM')
    assert.equal(await exited, 143)
    assert.equal(existsSync(lock), false)
    assert.deepEqual(readQueue(queue), [])
  })

  it('exits 130 on SIGINT while holding', async () => {
    const { lock } = fixture({ queue: false })
    const { proc, saw, exited } = child(lock, 'ship-int')
    await saw('holding')
    proc.kill('SIGINT')
    assert.equal(await exited, 130)
    assert.equal(existsSync(lock), false)
    assert.equal(existsSync(queuePathFor(lock)), false)
  })
})
