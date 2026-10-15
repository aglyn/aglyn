#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builds the native apps for private testing (TestFlight, Play internal
 * testing), from the checkout it runs in (AGL-3800).
 *
 *   node tools/scripts/native-release.mjs ios-archive <Aglyn|AglynPOS> <ios|macos>
 *   node tools/scripts/native-release.mjs ios-upload <path to .xcarchive>
 *   node tools/scripts/native-release.mjs android-bundle <app|pos>
 *
 * Every output lands in /private/tmp/aglyn-release (AGLYN_RELEASE_DIR
 * overrides it), named by app, platform and build number.
 *
 * ios-archive: `xcodebuild archive` of the Release configuration
 *   (Config/Release.xcconfig: the production project) for a generic iOS
 *   device or the Mac, signed automatically for team R3B7G75SWA with
 *   -allowProvisioningUpdates, so Xcode needs an account for that team
 *   (Xcode → Settings → Accounts). CURRENT_PROJECT_VERSION is the UTC time
 *   as yyyyMMddHHmm, so every archive outnumbers the last upload.
 * ios-upload: `xcodebuild -exportArchive` with destination `upload`, which
 *   sends the archive to App Store Connect (TestFlight) under the same
 *   account. The app record must already exist.
 * android-bundle: `bundleRelease` signed with the upload key, kept outside
 *   the repo at ~/.aglyn/release/aglyn-upload.jks (AGLYN_UPLOAD_KEYSTORE
 *   overrides it), alias `aglyn-upload`. Its password is read from the login
 *   Keychain (service `aglyn-android-upload-keystore`, account
 *   `aglyn-upload`) unless AGLYN_UPLOAD_STORE_PASSWORD is set, and reaches
 *   Gradle through the environment only, never the command line. The
 *   versionCode is the minutes since 1970 (UTC).
 *
 * The Xcode and Gradle builds take the shared build locks
 * (/private/tmp/aglyn-xcodebuild.lock, /private/tmp/aglyn-gradle.lock), so
 * two sessions on this Mac never build at once.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TEAM_ID = 'R3B7G75SWA'
const OUT = process.env.AGLYN_RELEASE_DIR || '/private/tmp/aglyn-release'
const IOS = join(ROOT, 'apps', 'ios')
const ANDROID = join(ROOT, 'apps', 'android')
const SCHEMES = new Set(['Aglyn', 'AglynPOS'])
const PLATFORMS = {
  ios: 'generic/platform=iOS',
  macos: 'generic/platform=macOS',
}
const ANDROID_APPS = { app: 'Aglyn', pos: 'AglynPOS' }

function fail(message) {
  console.error(`native-release: ${message}`)
  process.exit(1)
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Runs `work` holding the named build lock, a directory other sessions also take. */
function withLock(path, work) {
  let announced = false
  for (;;) {
    try {
      mkdirSync(path)
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (!announced) console.log(`Waiting for ${path} …`)
      announced = true
      sleep(20_000)
    }
  }
  try {
    return work()
  } finally {
    rmdirSync(path)
  }
}

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.status !== 0)
    fail(`${command} exited with ${result.status ?? result.signal}`)
}

function utcStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`
}

/** The commit a build is cut from, for the report and the file name. */
function headCommit() {
  return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short=10', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
}

function sizeOf(path) {
  const out = execFileSync('du', ['-sh', path], { encoding: 'utf8' })
  return out.split(/\s+/)[0]
}

function iosArchive(scheme, platform) {
  if (!SCHEMES.has(scheme))
    fail(`scheme must be one of ${[...SCHEMES].join(', ')}`)
  const destination = PLATFORMS[platform]
  if (!destination)
    fail(`platform must be one of ${Object.keys(PLATFORMS).join(', ')}`)
  const build = utcStamp()
  mkdirSync(OUT, { recursive: true })
  const archive = join(OUT, `${scheme}-${platform}-${build}.xcarchive`)
  withLock('/private/tmp/aglyn-xcodebuild.lock', () =>
    run(
      'xcodebuild',
      [
        'archive',
        '-project',
        join(IOS, 'Aglyn.xcodeproj'),
        '-scheme',
        scheme,
        '-configuration',
        'Release',
        '-destination',
        destination,
        '-archivePath',
        archive,
        '-derivedDataPath',
        join(IOS, 'build', 'DerivedData'),
        '-clonedSourcePackagesDirPath',
        join(IOS, 'build', 'SourcePackages'),
        '-skipPackagePluginValidation',
        '-allowProvisioningUpdates',
        `CURRENT_PROJECT_VERSION=${build}`,
        '-quiet',
      ],
      { cwd: IOS },
    ),
  )
  if (!existsSync(archive)) fail(`no archive at ${archive}`)
  console.log(`\n${scheme} ${platform}: build ${build} from ${headCommit()}`)
  console.log(`archive ${archive} (${sizeOf(archive)})`)
}

function iosUpload(archive) {
  if (!archive || !existsSync(archive) || !statSync(archive).isDirectory())
    fail('name an .xcarchive to upload')
  const exportPath = join(OUT, `${basename(archive, '.xcarchive')}-export`)
  mkdirSync(exportPath, { recursive: true })
  const options = join(exportPath, 'ExportOptions.plist')
  writeFileSync(
    options,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>${TEAM_ID}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
`,
  )
  withLock('/private/tmp/aglyn-xcodebuild.lock', () =>
    run('xcodebuild', [
      '-exportArchive',
      '-archivePath',
      archive,
      '-exportOptionsPlist',
      options,
      '-exportPath',
      exportPath,
      '-allowProvisioningUpdates',
    ]),
  )
  console.log(
    `\nUploaded ${basename(archive)} to App Store Connect; it shows in TestFlight once processed.`,
  )
}

function keychainPassword() {
  const result = spawnSync(
    'security',
    [
      'find-generic-password',
      '-a',
      'aglyn-upload',
      '-s',
      'aglyn-android-upload-keystore',
      '-w',
    ],
    { encoding: 'utf8' },
  )
  if (result.status !== 0)
    fail(
      'no upload keystore password in the login Keychain (service aglyn-android-upload-keystore)',
    )
  return result.stdout.trim()
}

function androidBundle(module) {
  const name = ANDROID_APPS[module]
  if (!name) fail(`app must be one of ${Object.keys(ANDROID_APPS).join(', ')}`)
  const keystore =
    process.env.AGLYN_UPLOAD_KEYSTORE ||
    join(homedir(), '.aglyn', 'release', 'aglyn-upload.jks')
  if (!existsSync(keystore)) fail(`no upload keystore at ${keystore}`)
  const password = process.env.AGLYN_UPLOAD_STORE_PASSWORD || keychainPassword()
  const versionCode = Math.floor(Date.now() / 60_000)
  const env = {
    ...process.env,
    ANDROID_HOME:
      process.env.ANDROID_HOME || join(homedir(), 'Library', 'Android', 'sdk'),
    AGLYN_UPLOAD_KEYSTORE: keystore,
    AGLYN_UPLOAD_KEY_ALIAS:
      process.env.AGLYN_UPLOAD_KEY_ALIAS || 'aglyn-upload',
    AGLYN_UPLOAD_STORE_PASSWORD: password,
    AGLYN_UPLOAD_KEY_PASSWORD:
      process.env.AGLYN_UPLOAD_KEY_PASSWORD || password,
  }
  // No configuration cache: it would keep the environment, the passwords with it, on disk.
  withLock('/private/tmp/aglyn-gradle.lock', () =>
    run(
      './gradlew',
      [
        '--no-daemon',
        '--no-configuration-cache',
        `:${module}:bundleRelease`,
        `-Paglyn.versionCode=${versionCode}`,
      ],
      { cwd: ANDROID, env },
    ),
  )
  const built = join(
    ANDROID,
    module,
    'build',
    'outputs',
    'bundle',
    'release',
    `${module}-release.aab`,
  )
  if (!existsSync(built)) fail(`no bundle at ${built}`)
  mkdirSync(OUT, { recursive: true })
  const target = join(OUT, `${name}-android-${versionCode}.aab`)
  copyFileSync(built, target)
  // jarsigner exits 0 for an unsigned bundle too, so the verdict is read from its output.
  const verify = spawnSync('jarsigner', ['-verify', target], {
    encoding: 'utf8',
  })
  if (!/jar verified/.test(verify.stdout))
    fail(`${target} is not signed:\n${verify.stdout}${verify.stderr}`)
  console.log(
    `\n${name} android: versionCode ${versionCode} from ${headCommit()}`,
  )
  console.log(`bundle ${target} (${sizeOf(target)})`)
}

const [command, ...args] = process.argv.slice(2)
switch (command) {
  case 'ios-archive':
    iosArchive(args[0], args[1])
    break
  case 'ios-upload':
    iosUpload(args[0])
    break
  case 'android-bundle':
    androidBundle(args[0])
    break
  default:
    fail(
      'usage: ios-archive <Aglyn|AglynPOS> <ios|macos> | ios-upload <archive> | android-bundle <app|pos>',
    )
}
