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
 *
 * It probes where the server will look (AGL-2834): the
 * `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST` the caller
 * exported, which the `serve:*:emulated` scripts hand to the server and mirror
 * into the page, or the ports `cloud/firebase.json` pins when neither is set.
 * A stack on a private port set is checked where it is, instead of passing
 * because another session's emulators hold the default ports.
 */
import net from 'node:net'

const REQUIRED = [
  {
    name: 'Firestore',
    variable: 'FIRESTORE_EMULATOR_HOST',
    fallback: 'localhost:8082',
  },
  {
    name: 'Auth',
    variable: 'FIREBASE_AUTH_EMULATOR_HOST',
    fallback: 'localhost:9099',
  },
]

/**
 * The socket address for `host:port`, or null when the value is not one.
 *
 * `localhost` is probed as 127.0.0.1: the emulators bind IPv4, and Node may
 * resolve `localhost` to ::1 first, which would report a running emulator as
 * missing.
 */
function socketAddress(value) {
  const colon = value.lastIndexOf(':')
  if (colon <= 0) return null
  const port = Number(value.slice(colon + 1))
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  const host = value.slice(0, colon).replace(/^\[(.*)\]$/, '$1')
  return { host: host === 'localhost' ? '127.0.0.1' : host, port }
}

/** Resolves true if something accepts a TCP connection at the address. */
function isListening({ host, port }, timeoutMs = 700) {
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
    socket.connect(port, host)
  })
}

const missing = []
for (const dependency of REQUIRED) {
  const value = process.env[dependency.variable] || dependency.fallback
  const address = socketAddress(value)
  if (!address || !(await isListening(address))) {
    missing.push({ ...dependency, value })
  }
}

if (missing.length === 0) process.exit(0)

const list = missing
  .map((dependency) => `${dependency.name} (${dependency.variable}=${dependency.value})`)
  .join(', ')
process.stderr.write(
  `\n  Emulator not running — ${list} is not accepting connections.\n\n` +
    `  This target talks to the local emulator on purpose, so it will not fall\n` +
    `  back to production. Start the emulator in another terminal:\n\n` +
    `      npm run firebase:emulate\n\n` +
    `  A fresh emulator is EMPTY (there is no ./.firebase export to import),\n` +
    `  so seed it once it is up, or the console will render as though the\n` +
    `  account has no data:\n\n` +
    `      npm run seed:e2e\n\n` +
    `  An emulator stack on its own ports is found through the same two\n` +
    `  variables; see "A private port set" in docs/E2E_LOCAL.md.\n\n` +
    `  If you genuinely need production data, use the live-data target and\n` +
    `  know that it bills real reads on every hot reload:\n\n` +
    `      npx nx serve console        # via .claude/launch.json: console-live-data\n\n`,
)
process.exit(1)
