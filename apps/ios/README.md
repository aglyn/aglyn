# Aglyn for iPhone, iPad and Mac

Two SwiftUI apps from one Xcode project (`Aglyn.xcodeproj`), each a single
multiplatform target that runs natively on iOS, iPadOS and macOS (not
Catalyst):

| target | bundle | what it is |
| -- | -- | -- |
| **Aglyn** | `com.aglyn.app` | Manages the workspace: Home (plugin widgets and quick actions), plugin screens, notifications, settings, and the console in an authenticated WebView. |
| **Aglyn POS** | `com.aglyn.pos` | The register: sign in, pick the store, then the plugins' POS contributions. |

A Debug build has its own identity (AGL-3994): "Aglyn Debug" (`com.aglyn.app.debug`) and "Aglyn POS Debug"
(`com.aglyn.pos.debug`), set in `Config/Emulator.xcconfig`. It runs beside the TestFlight or App Store app without
taking its Dock item, keychain items or settings. Address it by that id in a test or a script (`xcrun simctl launch
<device> com.aglyn.app.debug`), and never install a debug build into /Applications.

The architecture is `docs/mobile/native-architecture.md`. In short:

- `libs/native/apple` is the Swift package **AglynKit**: `AglynCore` (config,
  auth, Firestore reads, workspace and site, console API client, deep links,
  console sessions), `AglynUI` (generated theme tokens, Roboto Flex, brand
  artwork, the shared component kit), `AglynWebView`, `AglynPluginHost`,
  `AglynContracts` (generated) and `AglynHardware`.
- Plugins contribute through their own Swift package in
  `libs/plugins/<p>/src/ios`, reached only through the generated
  `PluginManifest` package. The shells never import a plugin.
- The folders `Aglyn/`, `AglynPOS/`, `Shared/`, `AglynTests/` and
  `AglynUITests/` are synchronized groups: add a Swift file and it is in the
  target, with no `project.pbxproj` edit.

## Develop

Xcode 16 or later (the project uses synchronized folders), iOS 17+ and macOS 14+.

```bash
# A local stack: the emulators on a demo- project, seeded with a member, a workspace, a site and its content
(cd cloud && firebase emulators:start --only auth,firestore --project demo-aglyn)
node tools/scripts/seed-native-emulator.mjs   # prints the seeded sign-in

open apps/ios/Aglyn.xcodeproj                  # run the Aglyn or AglynPOS scheme (the app is "Aglyn POS") on a simulator or My Mac
```

`Config/Emulator.xcconfig` is the default configuration: the Auth emulator on
`127.0.0.1:9099`, Firestore on `127.0.0.1:8082`, project `demo-aglyn`, and a
console at `http://localhost:4200`. Override any of it for your machine in
`Config/Local.xcconfig` (git ignores it), for example a second emulator stack
on other ports:

```
AGLYN_FIREBASE_PROJECT_ID = demo-aglyn-native
AGLYN_AUTH_EMULATOR_HOST = 127.0.0.1:9399
AGLYN_FIRESTORE_EMULATOR_HOST = 127.0.0.1:8389
// Debug builds: `-AglynAutoSignIn YES` signs in as the seeded member
AGLYN_DEBUG_EMAIL = mobile-owner@example.test
AGLYN_DEBUG_PASSWORD = <the password seed-native-emulator.mjs printed>
```

Debug launch arguments, for screenshots and UI tests:

| argument | does |
| -- | -- |
| `-AglynAutoSignIn YES` | signs in with `AGLYN_DEBUG_*` (emulator builds only) |
| `-AglynSection notifications\|settings\|more` | opens that section |
| `-AglynDemoRoute redirects.list` | pushes a plugin screen |
| `-AglynDemoParams uid=…,orgId=…` | the pushed screen's params |
| `-AglynDebugAccount staff` | signs in as the seeded staff account (`staff: true`, `staffRole: super`) to see the staff section |
| `-AglynShowSwitcher YES` | opens the workspace and site switcher |
| `-AglynNoPushPrompt YES` | skips the notification permission prompt |
| `-AglynAuthTransport rest\|sdk` | forces how the app signs in (see below) |
| `-AglynAppearance light\|dark` | Mac debug builds: draws the app in that appearance, whatever the system's |

### Sign-in on an unsigned Mac build

The Firebase SDK keeps its user in the data-protection Keychain, which a Mac
build without a team signature cannot write to (`-34018`). Such a build (any
local Debug build) therefore signs in through the
Identity Toolkit REST API instead and reads Firestore over REST with the same
ID token, so the same security rules apply. A live list re-reads every 30
seconds and on Refresh (⌘R). The refresh token is kept in the login Keychain;
an ad-hoc rebuild changes the app's signature, and the next launch then asks
for the password again instead of showing a Keychain prompt. A team-signed
build uses the SDK, as iOS does.

Links: `aglyn://<console path>` (and `aglyn-pos://` for the register) opens a
console path, natively when a plugin answers it, otherwise in the console WebView:

```bash
xcrun simctl openurl booted 'aglyn://juniper-street/hosts/juniper-street/redirects'
```

From the command line (the build directory is git-ignored):

```bash
cd apps/ios
xcodebuild build -project Aglyn.xcodeproj -scheme Aglyn -destination 'platform=iOS Simulator,name=iPhone 16' \
  -derivedDataPath build/DerivedData -clonedSourcePackagesDirPath build/SourcePackages
xcodebuild build -project Aglyn.xcodeproj -scheme Aglyn -destination 'platform=macOS' \
  -derivedDataPath build/DerivedData -clonedSourcePackagesDirPath build/SourcePackages
```

After you change a plugin's `mobile` block, run `npm run generate:plugin-manifests`.

A card typed in at the register goes into Aglyn POS's own native card fields
(iPhone, iPad and Mac), which send it to Stripe's PaymentMethods API with the
site's publishable key and hand only the PaymentMethod id to the server. No
Stripe card SDK is linked on Apple; see "Typed card" in
`docs/mobile/native-architecture.md` for the rules and the PCI note.

The Stripe Terminal SDK (Tap to Pay on iPhone, Bluetooth readers) is placed the
same way: the `StripeTerminal` product of `stripe-terminal-ios`, pinned exact in
`Aglyn.xcodeproj`, filtered to iOS and linked by Aglyn POS alone.
`AglynPOS/StripeTerminalCollector.swift` binds it to the hardware kit's
`CardCollector`, and the app publishes it as `DeviceCardReaders.shared` at
launch, which is where the commerce register finds it. No plugin package may
depend on it: both apps link the plugin manifest, so that would put the SDK
(and its location and Bluetooth references) in the Aglyn app, which declares no
purpose strings for them.

## Test

```bash
# AglynKit: config, API client, deep links, workspace, plugin registry, bridge
(cd libs/native/apple && xcodebuild test -scheme AglynKit-Package -destination 'platform=macOS')
# The app: unit tests, and the UI test that signs in and reaches Home (needs the seeded stack and Local.xcconfig)
(cd apps/ios && xcodebuild test -project Aglyn.xcodeproj -scheme Aglyn -destination 'platform=iOS Simulator,name=iPhone 16')
```

## Push

Aglyn and Aglyn POS register with APNs after sign-in and keep one row per
install at `users/{uid}/devices/{installId}` (APNs token, `sandbox` in debug
builds, `production` in release builds). Signing out deletes the row first.
Settings → Notifications holds one switch per notification type, stored at
`users/{uid}.notificationSettings.accountTypes.{type}.push`, the console's own
settings. APNs hands a token only to a build signed with the `aps-environment`
entitlement (a team-signed build), so an unsigned Mac Debug build fails quietly
and writes no row.

## Release to private testing

The Release configuration is `Config/Release.xcconfig`: the production project
(`aglyn-main`), the console at `https://app.aglyn.com`, and each app's own
Firebase Apple app id and iOS OAuth client (picked by target name). All of it
is public client config. A build for another project sets only what differs
in `Config/Production.xcconfig` (git ignores it; see
`Production.xcconfig.example`), which Release.xcconfig includes last.

Signing is automatic for team **R3B7G75SWA** (Aglyn LLC) on both targets.
Debug builds stay unsigned on the Mac (ad-hoc, no entitlements), so the
emulator flow and CI (`CODE_SIGNING_ALLOWED=NO`) need no Apple account.
Release builds sign with the team, which needs that account in Xcode →
Settings → Accounts.

| target | iOS and iPadOS (`Config/<app>.entitlements`) | macOS Release (`Config/<app>-macOS.entitlements`) |
| -- | -- | -- |
| Aglyn | `aps-environment`, `applinks:app.aglyn.com`, `webcredentials:aglyn.com` | App Sandbox, outgoing network, user-selected files read-write, `aps-environment`, the same associated domains, the app's own Keychain group (the Firebase SDK keeps its user there) |
| Aglyn POS | `aps-environment`, `applinks:app.aglyn.com` | App Sandbox, outgoing network, user-selected files read-write, `aps-environment`, `applinks:app.aglyn.com`, the app's own Keychain group |

The iOS and iPadOS entitlements also carry
`com.apple.developer.devicecheck.appattest-environment = production` for
Firebase App Check (AGL-3818). The Mac files do not: App Attest is not offered
on a Mac, which uses DeviceCheck instead (`docs/mobile/native-architecture.md`,
"App Check").

`aps-environment` says `development` in the files; the App Store export signs
it as `production`. Card readers (Stripe Terminal) and the barcode camera are
iOS only, so the Mac apps ask for neither Bluetooth nor the camera.

`tools/scripts/native-release.mjs` archives and uploads, under the shared
xcodebuild lock, to `/private/tmp/aglyn-release/`:

```bash
node tools/scripts/native-release.mjs ios-archive Aglyn ios       # or AglynPOS, and macos
node tools/scripts/native-release.mjs ios-upload /private/tmp/aglyn-release/Aglyn-ios-<build>.xcarchive
```

Archives sign with a development profile, which Apple issues only to a team
with a registered device. This Mac is registered; on another Mac, register it
once by building against it:

```bash
cd apps/ios && xcodebuild build -project Aglyn.xcodeproj -scheme Aglyn -configuration Release \
  -destination 'platform=macOS,arch=arm64' -derivedDataPath build/DerivedData \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration
```

The upload re-signs for the App Store (cloud-managed distribution signing), so
testers' devices never need registering.

The build number (`CURRENT_PROJECT_VERSION`) is the UTC time as
`yyyyMMddHHmm`, so every archive outnumbers the last. The version is the
repo's, the root `package.json`'s (`npm run release:prepare` bumps it), so an
app build and the web name one release: Apple takes only numbers as
`MARKETING_VERSION`, so it gets the core (`1.0.0` for `1.0.0-beta.266`), and the
whole string goes in Info.plist as `AGLYN_VERSION`, which Settings › About shows
and the push device row and Besigner marker carry. The upload goes to App Store Connect
(records "Aglyn" and "Aglyn POS") and shows in TestFlight once processed.

## What Zach owes

Nothing below is needed to build or test against the emulators.

Done: the Apple Developer Program (team R3B7G75SWA), the App IDs
`com.aglyn.app` (Push Notifications, Associated Domains, Sign in with Apple)
and `com.aglyn.pos` (Push Notifications, Associated Domains), the Firebase
Apple app registrations in `aglyn-main` (their values are in
`Config/Release.xcconfig`), and the App Store Connect records.

App Check (AGL-3818), done 2026-10-15: the App Attest capability on both App
IDs (profiles regenerate on the next archive), and App Attest registered for
both apps in Firebase App Check (team R3B7G75SWA, 1 h TTL).

Still owed:

1. **Xcode account** for team R3B7G75SWA (Xcode → Settings → Accounts), for
   Release archives and uploads.
2. **Tap to Pay on iPhone, distribution.** Apple granted the development
   entitlement (2026-10-25); the capability is on the App IDs `com.aglyn.pos`
   and `com.aglyn.pos.debug`, and `com.apple.developer.proximity-reader.payment.acceptance`
   is in `Config/AglynPOS.entitlements`. TestFlight and App Store builds need
   Apple's distribution approval, requested after internal testing.
3. **APNs key** (`.p8`, Key ID, Team ID), set as `APNS_KEY_P8`, `APNS_KEY_ID`
   and `APNS_TEAM_ID` on the server.
4. **Developer ID** signing and **notarization** for Mac apps sold outside the
   Mac App Store (TestFlight and the Mac App Store need neither).
5. **Stripe Terminal live mode** for the POS app.
6. **`apple-app-site-association`** served at
   `https://app.aglyn.com/.well-known/apple-app-site-association` (`applinks`,
   both apps: `R3B7G75SWA.com.aglyn.app`, `R3B7G75SWA.com.aglyn.pos`) and at
   `https://aglyn.com/.well-known/apple-app-site-association` (`webcredentials`
   for `R3B7G75SWA.com.aglyn.app`, for passkeys; template: `docs/mobile/well-known/`).
   `AGLYN_PASSKEY_RP_ID = aglyn.com` is set in `Config/Release.xcconfig` since
   aglyn.com serves that file (AGL-3817); both targets carry
   `webcredentials:aglyn.com`.
7. **TestFlight**: listing, privacy labels and a tester group per app.
8. **DeviceCheck in Firebase App Check** for both apps (a DeviceCheck `.p8`
   key, its Key ID and the team), which the Mac builds use; until then a Mac
   build against production is refused at sign-in.
9. **Sign in with Apple** (AGL-3816): both apps offer it beside Google
   (`AGLYN_APPLE_SIGN_IN = YES`, `com.apple.developer.applesignin` in every
   entitlements file), as App Store guideline 4.8 asks. Done 2026-10-15: the
   Apple provider in Firebase Auth (`aglyn-main`, Services ID
   `com.aglyn.app.signin`, key 5272L5F399, team R3B7G75SWA). Still owed: the
   Sign in with Apple capability on the `com.aglyn.pos` App ID, unless the
   next archive's automatic signing adds it.
