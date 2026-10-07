# Aglyn for iPhone, iPad and Mac

Two SwiftUI apps from one Xcode project (`Aglyn.xcodeproj`), each a single
multiplatform target that runs natively on iOS, iPadOS and macOS (not
Catalyst):

| target | bundle | what it is |
| -- | -- | -- |
| **Aglyn** | `com.aglyn.app` | Manages the workspace: Home (plugin widgets and quick actions), plugin screens, notifications, settings, and the console in an authenticated WebView. |
| **Aglyn POS** | `com.aglyn.pos` | The register: sign in, pick the store, then the plugins' POS contributions. |

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
| `-AglynShowSwitcher YES` | opens the workspace and site switcher |
| `-AglynNoPushPrompt YES` | skips the notification permission prompt |
| `-AglynAuthTransport rest\|sdk` | forces how the app signs in (see below) |

### Sign-in on an unsigned Mac build

The Firebase SDK keeps its user in the data-protection Keychain, which a Mac
build without a team signature cannot write to (`-34018`). Such a build (any
local `xcodebuild` until the Apple team exists) therefore signs in through the
Identity Toolkit REST API instead and reads Firestore over REST with the same
ID token, so the same security rules apply. A live list re-reads every 30
seconds and on Refresh (⌘R). The refresh token is kept in the login Keychain;
an ad-hoc rebuild changes the app's signature, and the next launch then asks
for the password again instead of showing a Keychain prompt. A team-signed
build uses the SDK, as iOS does.

Links: `aglyn://<console path>` (and `aglyn-pos://` for the register) opens a
console path, natively when a plugin answers it, otherwise in the console WebView:

```bash
xcrun simctl openurl booted 'aglyn://demo-workspace/hosts/demo-site/redirects'
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
entitlement, so until the team exists registration fails quietly and no row is
written.

## What Zach owes

Nothing below is needed to build or test against the emulators. Each is needed
for a real device, TestFlight, the Mac release or production data:

1. **Apple Developer Program** enrollment, and the team id set as
   `DEVELOPMENT_TEAM` on both targets.
2. **App IDs** `com.aglyn.app` and `com.aglyn.pos`, each with **Push
   Notifications** and **Associated Domains**. The targets then get their
   entitlements (`aps-environment`, `com.apple.developer.associated-domains`
   with `applinks:` for the console origin).
3. **Tap to Pay on iPhone** entitlement for `com.aglyn.pos` (requested from
   Apple, granted per team).
4. **APNs key** (`.p8`, Key ID, Team ID), set as `APNS_KEY_P8`, `APNS_KEY_ID`
   and `APNS_TEAM_ID` on the server.
5. **Firebase app registrations** for iOS and macOS, for both bundles, in the
   production project. Their public values go in `Config/Production.xcconfig`
   (copy `Production.xcconfig.example`). No `GoogleService-Info.plist` is used.
6. **Developer ID** signing and **notarization** for the Mac apps (or the Mac
   App Store).
7. **Stripe Terminal live mode** for the POS app.
8. **`apple-app-site-association`** on the console origin, naming both apps'
   app ids, so console links open the apps.
9. **App Store Connect** records for both apps: listing, privacy labels and a
   TestFlight group.
