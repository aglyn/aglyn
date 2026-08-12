/**
 * Refuse to start an "emulated" dev server when no emulator is listening.
 *
 * Without this the server starts happily, every read is served from a Firestore
 * that isn't there, and the console renders empty — which looks like a broken
 * app rather than a missing dependency. The failure is cheap to cause and
 * expensive to diagnose, so it is worth one preflight.
 *
 * The inverse mistake is the one that actually costs money: a dev server
 * pointed at PRODUCTION burns real reads on every HMR remount. One console
 * page load is ~41 reads, so a day of editing with a tab open is tens of
 * thousands of reads against the live project (AGL-1440). That is why the
 * emulated targets are the default and the live-data ones are opt-in.
 */
import net from 'node:net'

const REQUIRED = [
  { name: 'Firestore', port: 8082 },
  { name: 'Auth', port: 9099 },
]

/** Resolves true if something accepts a TCP connection on the port. */
function isListening(port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const done = (result) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, '127.0.0.1')
  })
}

const missing = []
for (const dep of REQUIRED) {
  if (!(await isListening(dep.port))) missing.push(dep)
}

if (missing.length === 0) process.exit(0)

const list = missing.map((m) => `${m.name} (127.0.0.1:${m.port})`).join(', ')
process.stderr.write(
  `\n  Emulator not running — ${list} is not accepting connections.\n\n` +
    `  This target talks to the local emulator on purpose, so it will not fall\n` +
    `  back to production. Start the emulator in another terminal:\n\n` +
    `      npm run firebase:emulate\n\n` +
    `  A fresh emulator is EMPTY (there is no ./.firebase export to import),\n` +
    `  so seed it once it is up, or the console will render as though the\n` +
    `  account has no data:\n\n` +
    `      npm run seed:e2e\n\n` +
    `  If you genuinely need production data, use the live-data target and\n` +
    `  know that it bills real reads on every hot reload:\n\n` +
    `      npx nx serve console        # via .claude/launch.json: console-live-data\n\n`,
)
process.exit(1)
