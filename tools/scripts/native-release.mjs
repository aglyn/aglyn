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
 *   node tools/scripts/native-release.mjs ios-symbols <path to .xcarchive>
 *   node tools/scripts/native-release.mjs android-bundle <app|pos>
 *   node tools/scripts/native-release.mjs android-upload <path to .aab> [track]
 *
 * Every output lands in /private/tmp/aglyn-release (AGLYN_RELEASE_DIR
 * overrides it), named by app, platform and build number.
 *
 * ios-archive: `xcodebuild archive` of the Release configuration
 *   (Config/Release.xcconfig: the production project) for a generic iOS
 *   device or the Mac, signed automatically for team R3B7G75SWA with
 *   -allowProvisioningUpdates (and -allowProvisioningDeviceRegistration, which
 *   registers this Mac with the team), so Xcode needs an account for that team
 *   (Xcode → Settings → Accounts). CURRENT_PROJECT_VERSION is the UTC time
 *   as yyyyMMddHHmm, so every archive outnumbers the last upload; the
 *   version is the root package.json's (releaseVersion below).
 *   The archive's dSYMs then go to Firebase Crashlytics (ios-symbols).
 * ios-symbols: uploads an archive's dSYMs to Firebase Crashlytics with its
 *   `upload-symbols` (from the firebase-ios-sdk package checkout), so a crash
 *   from that build reads as source lines (AGL-4067). There is no
 *   GoogleService-Info.plist, so the Firebase app id is read from the archived
 *   app's own Info.plist (AGLYN_FIREBASE_APP_ID, which Config/Release.xcconfig
 *   sets per target). The Mac app is the same target as the iPhone and iPad
 *   app, so it shares that Apple app id; only the platform (`mac`) differs.
 *   ios-archive runs it after every archive; a failed upload is reported, not
 *   fatal, and is retried with this command.
 * ios-upload: `xcodebuild -exportArchive` with destination `upload`, which
 *   sends the archive to App Store Connect (TestFlight) under the same
 *   account. The app record must already exist.
 * android-bundle: `bundleRelease` signed with the upload key, kept outside
 *   the repo at ~/.aglyn/release/aglyn-upload.jks (AGLYN_UPLOAD_KEYSTORE
 *   overrides it), alias `aglyn-upload`. Its password is read from the login
 *   Keychain (service `aglyn-android-upload-keystore`, account
 *   `aglyn-upload`) unless AGLYN_UPLOAD_STORE_PASSWORD is set, and reaches
 *   Gradle through the environment only, never the command line. The
 *   versionCode is the minutes since 1970 (UTC); versionName is the root
 *   package.json's version, passed as -Paglyn.versionName.
 *   -Paglyn.crashlyticsMappingUpload=true has the Crashlytics Gradle plugin
 *   upload the R8 mapping file, so the bundle's crashes deobfuscate; no other
 *   build uploads one.
 *
 * android-upload: sends a bundle to a Play testing track (internal unless
 *   a track is named) through the Play Developer API: an edit, the bundle,
 *   the track's release, commit. No key file: the operator's own
 *   application-default login (`gcloud auth application-default login`)
 *   mints a short-lived token for the publisher service account
 *   (AGLYN_PLAY_PUBLISHER, default play-publisher@aglyn-main), which holds
 *   "Release apps to testing tracks" on both apps in Play Console and
 *   nothing else. The operator needs Service Account Token Creator on it.
 *   The package comes from the bundle's name (Aglyn-…, AglynPOS-…).
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
  readdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { withExportTempCleanup } from './lib/xcode-export-temp.mjs'

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

/**
 * The repo's release version, the root package.json's (`npm run release:prepare`
 * bumps it), so a store build and the web it ships beside name one release.
 * Apple's CFBundleShortVersionString takes only up to three integers, so the
 * Apple builds carry the numeric core as MARKETING_VERSION and the whole string
 * as AGLYN_VERSION (Info.plist), which the apps show; Android's versionName is
 * free text, so the bundles get the whole string as -Paglyn.versionName.
 */
function releaseVersion() {
  const { version } = JSON.parse(
    readFileSync(join(ROOT, 'package.json'), 'utf8'),
  )
  const core = /^(\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(version ?? '')?.[1]
  if (!core) fail(`package.json version ${version} is not semver`)
  return { version, core }
}

/** Stops the command. Thrown rather than exiting, so a held build lock is released on the way out. */
class ReleaseError extends Error {}

function fail(message) {
  throw new ReleaseError(message)
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
  return out.trim().split(/\s+/)[0]
}

function iosArchive(scheme, platform) {
  if (!SCHEMES.has(scheme))
    fail(`scheme must be one of ${[...SCHEMES].join(', ')}`)
  const destination = PLATFORMS[platform]
  if (!destination)
    fail(`platform must be one of ${Object.keys(PLATFORMS).join(', ')}`)
  const build = utcStamp()
  const { version, core } = releaseVersion()
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
        // Lets Xcode register a device when a development profile needs one. A generic
        // destination names no device, so a Mac new to the team is registered first by a
        // build against itself (apps/ios/README.md, "Release to private testing").
        '-allowProvisioningDeviceRegistration',
        `CURRENT_PROJECT_VERSION=${build}`,
        `MARKETING_VERSION=${core}`,
        `AGLYN_VERSION=${version}`,
        // The schemes share package intermediates; coverage instrumentation would make Aglyn and
        // AglynPOS rebuild each other's (AGL-3783), and nothing reads coverage from an archive.
        'CLANG_COVERAGE_MAPPING=NO',
        '-quiet',
      ],
      { cwd: IOS },
    ),
  )
  if (!existsSync(archive)) fail(`no archive at ${archive}`)
  console.log(
    `\n${scheme} ${platform}: ${version} (${core}) build ${build} from ${headCommit()}`,
  )
  console.log(`archive ${archive} (${sizeOf(archive)})`)
  try {
    iosSymbols(archive)
  } catch (error) {
    if (!(error instanceof ReleaseError)) throw error
    console.error(
      `\nThe dSYMs did not reach Crashlytics (${error.message}). Retry with:\n  node tools/scripts/native-release.mjs ios-symbols ${archive}`,
    )
  }
}

/** The archived app's Info.plist, iOS (`App.app/Info.plist`) or macOS (`App.app/Contents/Info.plist`). */
function archivedInfoPlist(archive) {
  const apps = join(archive, 'Products', 'Applications')
  const app = existsSync(apps)
    ? readdirSync(apps).find((name) => name.endsWith('.app'))
    : undefined
  if (!app) fail(`no app in ${apps}`)
  const plist = [
    join(apps, app, 'Info.plist'),
    join(apps, app, 'Contents', 'Info.plist'),
  ].find((path) => existsSync(path))
  if (!plist) fail(`no Info.plist in ${join(apps, app)}`)
  return { plist, mac: plist.includes(`${app}/Contents/`) }
}

function plistValue(plist, key) {
  const result = spawnSync('plutil', ['-extract', key, 'raw', plist], {
    encoding: 'utf8',
  })
  return result.status === 0 ? result.stdout.trim() : ''
}

/** Sends an archive's dSYMs to Firebase Crashlytics (see ios-symbols above). */
function iosSymbols(archive) {
  if (!archive || !existsSync(archive) || !statSync(archive).isDirectory())
    fail('name an .xcarchive whose dSYMs to upload')
  const tool = join(
    IOS,
    'build',
    'SourcePackages',
    'checkouts',
    'firebase-ios-sdk',
    'Crashlytics',
    'upload-symbols',
  )
  if (!existsSync(tool))
    fail(`no upload-symbols at ${tool} (an archive resolves the packages there)`)
  const dsyms = join(archive, 'dSYMs')
  if (!existsSync(dsyms) || readdirSync(dsyms).length === 0)
    fail(`no dSYMs in ${dsyms}`)
  const { plist, mac } = archivedInfoPlist(archive)
  if (plistValue(plist, 'AGLYN_TELEMETRY') !== 'on') {
    console.log(
      'AGLYN_TELEMETRY is not on for this build, so it reports no crashes; no dSYMs uploaded.',
    )
    return
  }
  const appID = plistValue(plist, 'AGLYN_FIREBASE_APP_ID')
  if (!/^1:\d+:ios:[0-9a-f]+$/.test(appID) || /^1:0+:/.test(appID))
    fail(`AGLYN_FIREBASE_APP_ID in ${plist} is not a Firebase Apple app id`)
  run(tool, ['-ai', appID, '-p', mac ? 'mac' : 'ios', '--', dsyms])
  console.log(`dSYMs from ${basename(archive)} uploaded to Crashlytics.`)
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
  // The export leaves a ~300 MB XcodeDistPipeline.~~~* staging folder in the
  // temp folder; the cleanup removes the one this export made.
  withLock('/private/tmp/aglyn-xcodebuild.lock', () =>
    withExportTempCleanup(() =>
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
    ),
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
        `-Paglyn.versionName=${releaseVersion().version}`,
        // The R8 mapping file goes to Crashlytics, so this bundle's crashes deobfuscate (AGL-4067).
        '-Paglyn.crashlyticsMappingUpload=true',
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
    `\n${name} android: ${releaseVersion().version} versionCode ${versionCode} from ${headCommit()}`,
  )
  console.log(`bundle ${target} (${sizeOf(target)})`)
}

const PLAY_PACKAGES = { Aglyn: 'com.aglyn.app', AglynPOS: 'com.aglyn.pos' }
const PLAY_TRACKS = new Set(['internal', 'alpha', 'beta'])
const PLAY_API = 'https://androidpublisher.googleapis.com'

async function playToken() {
  const publisher =
    process.env.AGLYN_PLAY_PUBLISHER ||
    'play-publisher@aglyn-main.iam.gserviceaccount.com'
  const login = spawnSync(
    'gcloud',
    ['auth', 'application-default', 'print-access-token'],
    { encoding: 'utf8' },
  )
  if (login.status !== 0)
    fail(
      'no application-default login: run `gcloud auth application-default login`',
    )
  const project = publisher.split('@')[1]?.split('.')[0]
  const response = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${publisher}:generateAccessToken`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${login.stdout.trim()}`,
        'Content-Type': 'application/json',
        ...(project ? { 'x-goog-user-project': project } : {}),
      },
      body: JSON.stringify({
        scope: ['https://www.googleapis.com/auth/androidpublisher'],
        lifetime: '900s',
      }),
    },
  )
  const body = await response.json()
  if (!body.accessToken)
    fail(
      `could not act as ${publisher}: ${body.error?.message ?? response.status}`,
    )
  return body.accessToken
}

async function play(token, path, init = {}) {
  const response = await fetch(`${PLAY_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : {}
  if (!response.ok)
    fail(
      `Play ${init.method ?? 'GET'} ${path}: ${body.error?.message ?? response.status}`,
    )
  return body
}

async function androidUpload(bundle, track = 'internal') {
  if (!bundle || !existsSync(bundle)) fail(`no bundle at ${bundle}`)
  if (!PLAY_TRACKS.has(track))
    fail(
      `track must be one of ${[...PLAY_TRACKS].join(', ')} (production is released by a person)`,
    )
  const name = basename(bundle).split('-android-')[0]
  const packageName = PLAY_PACKAGES[name]
  if (!packageName)
    fail(
      `cannot tell the app from ${basename(bundle)} (expected ${Object.keys(PLAY_PACKAGES).join('- or ')}-…)`,
    )
  const token = await playToken()
  const app = `/androidpublisher/v3/applications/${packageName}/edits`
  const edit = await play(token, app, { method: 'POST' })
  const uploaded = await play(
    token,
    `/upload${app}/${edit.id}/bundles?uploadType=media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: readFileSync(bundle),
    },
  )
  await play(token, `${app}/${edit.id}/tracks/${track}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      track,
      releases: [
        {
          name: `${releaseVersion().version} (${uploaded.versionCode})`,
          versionCodes: [String(uploaded.versionCode)],
          status: 'completed',
        },
      ],
    }),
  })
  await play(token, `${app}/${edit.id}:commit`, { method: 'POST' })
  console.log(
    `\n${packageName}: versionCode ${uploaded.versionCode} released to ${track} (${sizeOf(bundle)})`,
  )
}

const [command, ...args] = process.argv.slice(2)
try {
  switch (command) {
    case 'ios-archive':
      iosArchive(args[0], args[1])
      break
    case 'ios-upload':
      iosUpload(args[0])
      break
    case 'ios-symbols':
      iosSymbols(args[0])
      break
    case 'android-bundle':
      androidBundle(args[0])
      break
    case 'android-upload':
      await androidUpload(args[0], args[1])
      break
    default:
      fail(
        'usage: ios-archive <Aglyn|AglynPOS> <ios|macos> | ios-upload <archive> | ios-symbols <archive> | android-bundle <app|pos> | android-upload <aab> [track]',
      )
  }
} catch (error) {
  if (!(error instanceof ReleaseError)) throw error
  console.error(`native-release: ${error.message}`)
  process.exitCode = 1
}
