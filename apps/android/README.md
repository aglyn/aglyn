# Aglyn and Aglyn POS for Android (and the JVM desktop)

The native Kotlin apps (AGL-3652, AGL-3653). One Gradle root builds:

| module | what it is |
| -- | -- |
| `:app` | **Aglyn** (`com.aglyn.app`; debug builds are `com.aglyn.app.dev`) |
| `:pos` | **Aglyn POS** (`com.aglyn.pos`; debug builds are `com.aglyn.pos.dev`) |
| `:desktop` | both apps on the JVM desktop: `AglynDesktop` and `AglynPosDesktop` (Windows ships from here) |
| `:plugin-manifest` | every plugin's native registrar, from the generated `PluginManifest.generated.kt` |
| `:native-*` | the shared foundation in `libs/native/kotlin` (`core`, `ui`, `plugin-host`, `webview`, `shell`, `contracts`, `hardware`, and the Android-only `camera`) |
| `:plugin-<id>` | a plugin's `src/android` module, from `native-plugins.generated.properties` |

The architecture is `docs/mobile/native-architecture.md`.

## Stack

Versions live in `gradle/libs.versions.toml`: Gradle 9.8, AGP 9.4, Kotlin
2.4.20, Compose Multiplatform 1.12.1 (Material 3 1.9.0), Ktor 3.6, Firebase
Android SDK (the BoM 34.19.0 set). `compileSdk` is 37 because the current
Compose and adaptive artifacts require it; `minSdk` is 26.

Dependencies beyond the base stack are each approved by Zach (2026-10-07) and
pinned in the catalog:

| dependency | used by | license |
| -- | -- | -- |
| Stripe Terminal Android SDK (`stripeterminal`, `stripeterminal-taptopay`) | `:pos` only: Tap to Pay and Bluetooth readers | MIT |
| Stripe Android SDK (`com.stripe:paymentsheet`, approved 2026-10-14) | `:pos` only: the card form for a card typed in at the register | MIT |
| CameraX (`camera-camera2`, `camera-lifecycle`, `camera-view`) | `:native-camera`, Android only | Apache-2.0 |
| ML Kit barcode scanning (bundled model) | `:native-camera`, Android only | ML Kit Terms of Service |
| Google Play Integrity (`com.google.android.play:integrity`, approved 2026-10-15) with Firebase App Check's `firebase-appcheck-playintegrity` | `:native-core` on Android: the App Check token production requires on Auth and Firestore (AGL-3818) | Android SDK License / Apache-2.0 |
| JNA | desktop: Windows Credential Manager, WebView2 over COM | Apache-2.0 / LGPL-2.1 |
| grpc-java (`grpc-okhttp`, `grpc-stub`) + `proto-google-cloud-firestore-v1` | desktop: Firestore `Listen` | Apache-2.0 |
| Microsoft Edge WebView2 SDK (`Microsoft.Web.WebView2`, NuGet): `WebView2Loader.dll` only | desktop on Windows: the Besigner, on the Evergreen runtime Windows keeps updated | Microsoft BSD-style (packaged as `licenses/WebView2-LICENSE.txt`) |

The WebView2 SDK resolves from Microsoft's NuGet feed (an Ivy repository in
`settings.gradle.kts` that serves nothing else) and only when Windows
packages or runs the desktop app: `:desktop:webview2Loader` extracts the x64
and arm64 loaders into Compose's `appResources`.

Shared modules are Kotlin Multiplatform with an Android target
(`com.android.kotlin.multiplatform.library`) and a JVM `desktop` target. The
shells, the theme and every plugin screen are Compose Multiplatform in
`commonMain`, so Android and desktop run the same UI.

Firebase is configured in code from build fields (`FirebaseOptions`); there is
no `google-services.json` and the google-services Gradle plugin is not used.

## Develop

Needs a JDK 21 (`JAVA_HOME`) and the Android SDK (`local.properties` with
`sdk.dir=…`, or `ANDROID_HOME`). Gradle installs missing SDK platforms itself.

```bash
# A local stack: the emulators on a demo- project, seeded with one member, one site and three redirects
(cd cloud && firebase emulators:start --only auth,firestore --project demo-aglyn)
node tools/scripts/seed-native-emulator.mjs

cd apps/android
./gradlew :app:assembleDebug :pos:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.aglyn.app.dev/com.aglyn.app.MainActivity
```

The debug build points at the emulators through the Android emulator's name
for the host computer (`10.0.2.2`) and fills the sign-in form with the seeded
member. `--ez autoSignIn true` on `am start` also submits it.

Every setting can be overridden with `-Paglyn.<name>=…` or `AGLYN_<NAME>`:
`consoleUrl`, `firebaseProjectId`, `firebaseApiKey`, `firebaseAppId`,
`firebaseAuthDomain`, `firebaseMessagingSenderId`, `authEmulatorHost`,
`firestoreEmulatorHost`. A second emulator stack on other ports, for example:

```bash
./gradlew :app:assembleDebug -Paglyn.firebaseProjectId=demo-aglyn-native \
  -Paglyn.authEmulatorHost=10.0.2.2:9299 -Paglyn.firestoreEmulatorHost=10.0.2.2:8289
```

### Desktop (JVM)

```bash
./gradlew :desktop:run                              # Aglyn
./gradlew :desktop:run -Paglyn.desktopApp=pos       # Aglyn POS
# another stack: -Paglyn.jvmArgs="-Daglyn.firebaseProjectId=demo-aglyn-native -Daglyn.authEmulatorHost=127.0.0.1:9299 -Daglyn.firestoreEmulatorHost=127.0.0.1:8289 -Daglyn.autoSignIn=true"
./gradlew :desktop:snapshots -Paglyn.snapshotDir=/tmp/shots   # offscreen PNGs of every screen
./gradlew :desktop:posSnapshots -Paglyn.snapshotDir=/tmp/shots # the register driven through a sale, offscreen
./gradlew :desktop:packageMsi                       # on Windows
./gradlew :desktop:launchCheck [-Paglyn.desktopApp=pos]  # starts the PACKAGED app and fails if it does not start
```

A package carries its own jlink runtime with only the JDK modules listed in
`desktop/build.gradle.kts` (`DESKTOP_RUNTIME_MODULES`). Every package task runs
`:desktop:launchCheck` first, which launches the packaged launcher with
`--launch-check` (the shell rendered offscreen, then exit 0), so a missing
module fails the build instead of the app. After adding a dependency, rerun
`./gradlew :desktop:suggestRuntimeModules` and keep the list a superset.

Desktop signs in through the Identity Toolkit REST API and reads Firestore
through its REST API with the person's own ID token (the same rules). A
visible document or list is a gRPC `Listen` stream opened with a freshly
minted ID token and re-opened before that token's hour is up; a stream that
cannot be held three times in a row falls back to re-reading every 30
seconds. The refresh token is kept in Windows Credential Manager (through
JNA), so the next launch signs straight back in; a macOS or Linux run keeps it
in memory and signs in each launch. Every area is a native screen; the
Besigner, the only web content, opens inside the app window (WebView2 on
Windows) and never in the system browser. Desktop has no push in v1 (Settings → Notifications still edits which
types reach the person's phones and tablets).

To watch `Listen` work against the emulator stack:
`AGLYN_LISTEN_EMULATOR=127.0.0.1:8289 AGLYN_LISTEN_AUTH=127.0.0.1:9299 AGLYN_LISTEN_PROJECT=demo-aglyn-native ./gradlew :native-core:desktopTest --tests '*ListenTest*'`. Menus: Go (⌘/Ctrl 1 Home, 2 Notifications, 3 Pages, 4 Orders, ⌘/Ctrl , Settings),
Workspace (⌘/Ctrl K switches site) and Account (⌘/Ctrl ⇧Q signs out).

The desktop register takes cards on smart readers only. A keyboard-wedge
barcode scanner works anywhere in the window (a fast burst of keys ended by
Enter or Tab is a scan, not typing). A network receipt printer is named with
`-Daglyn.receiptPrinter=host[:port]` (raw TCP, 9100 by default): receipts
print as ESC/POS and a cash sale kicks the drawer. Register shortcuts:
⌘/Ctrl F search, ⌘/Ctrl Enter or F12 charge, ⌘/Ctrl + and − the last line's
quantity, ⌘/Ctrl H hold the basket, Esc closes the item sheet.

### Aglyn POS on Android: card readers and the camera

The POS app carries the Stripe Terminal Android SDK (`com.stripe:stripeterminal`
and `stripeterminal-taptopay`); the Aglyn app does not. Card readers → This
device offers **Use Tap to Pay** (an NFC device on Android 13+) and **Find
Bluetooth readers** (Stripe M2, WisePad 3, Chipper 2X), after asking for
location and nearby devices. Connection tokens come from
`/api/commerce/pos-terminal-connection-token` for the open site, scoped to its
Terminal Location; readers never connect on behalf of a merchant, because
card-present payments settle on the platform account. A connected reader
becomes the first card tender; the payment is the shared
`collectCardPayment` sequence (retrieve → collect → confirm, which
authorizes; the server captures). The reader's prompts show on the checkout
screen, and a reader update is offered (or required) on the readers screen.

Every build uses the SDK's **simulated** readers until live readers are
switched on with `-Paglyn.terminalLiveReaders=true` on a release build, which
needs Stripe Terminal live mode. Tap to Pay's PIN screens run in the SDK's
`:stripetaptopay` process, where the app does nothing on start.

A card typed in at the register ("Type card", offered when the site has a Stripe
publishable key) goes into Stripe's own PaymentSheet (`com.stripe:paymentsheet`,
`:pos` only): the number is typed into Stripe's fields and never reaches our
code. The server makes the PaymentIntent (`card-keyed`) and reads the payment back
from Stripe; the sheet is built by `MainActivity` in `onCreate` and bound through
the hardware kit's `KeyedCardEntry`. The Aglyn app and the desktop shell do not
carry the SDK.

The register's camera button scans barcodes with CameraX and ML Kit's bundled
model (`libs/native/kotlin/camera`, provided to the kit's `BarcodeScanSheet`
through `LocalCameraScanner`). Each code goes through the same barcode-then-SKU
lookup as a keyboard-wedge scan, and the sheet stays open for the next item.

Release builds take no emulator host and default to the production project
(`aglyn-main`: each app's Firebase Android app id, the Android API key, sender
id, `aglyn-main.firebaseapp.com`) and the console at `https://app.aglyn.com`,
all public client config; `-Paglyn.<name>` overrides any of it.
`AglynConfig.problems()` logs anything missing.

## Release to private testing

`tools/scripts/native-release.mjs android-bundle <app|pos>` runs
`:<module>:bundleRelease` under the shared Gradle lock, signs it with the
upload key and copies the bundle to
`/private/tmp/aglyn-release/<Aglyn|AglynPOS>-android-<versionCode>.aab`, then
checks the signature with `jarsigner -verify`:

```bash
node tools/scripts/native-release.mjs android-bundle app
node tools/scripts/native-release.mjs android-bundle pos
```

- **versionCode** is the minutes since 1970 (UTC), passed as
  `-Paglyn.versionCode`, so every bundle outnumbers the last and stays under
  Play's 2,100,000,000. A build without it is versionCode 1.
- **The upload key** is one keystore for both apps, kept outside the repo at
  `~/.aglyn/release/aglyn-upload.jks` (alias `aglyn-upload`, RSA 4096, valid
  to 2056). Its password is in the login Keychain (service
  `aglyn-android-upload-keystore`, account `aglyn-upload`); the script reads it
  and hands it to Gradle through the environment (`AGLYN_UPLOAD_KEYSTORE`,
  `AGLYN_UPLOAD_KEY_ALIAS`, `AGLYN_UPLOAD_STORE_PASSWORD`,
  `AGLYN_UPLOAD_KEY_PASSWORD`), never the command line, with the configuration
  cache off so it is never written to disk. Without `AGLYN_UPLOAD_KEYSTORE` a
  release build is simply unsigned, which is what CI builds.
- Upload certificate fingerprints (registered on both Firebase Android apps):
  SHA-1 `AE:2A:2F:D3:A5:71:4E:FC:DB:20:AF:0B:89:7C:67:A1:C8:69:62:1F`,
  SHA-256 `7C:5A:6E:56:5F:02:61:63:65:25:E3:8B:FB:F0:48:C0:E8:19:A6:E0:28:29:B2:E2:05:32:D0:C5:31:D7:51:3E`.
- Play App Signing re-signs each app with Google's app signing key. Its
  SHA-1 and SHA-256 (Play Console → Test and release → App integrity) also
  go on the Firebase Android app and in `assetlinks.json`.

## Test

```bash
./gradlew desktopTest          # every module's JVM tests, including the replayed console cases
```

## Plugins

A plugin's native screens live in `libs/plugins/<id>/src/android`, a KMP module
whose registrar registers the ids its `mobile.contributes` block declares in
`plugins.config.json`. `npm run generate:plugin-manifests` writes the manifest
and properties files from the plugin's `mobile.android` block; the apps load
`NativePluginManifest.entries` and nothing else.

## What Zach owes

Done: the Firebase Android app registrations for `com.aglyn.app` and
`com.aglyn.pos` in `aglyn-main` (their app ids are the release defaults), and
the upload key with its fingerprints on both. App Check (AGL-3818, 2026-10-15):
Play Integrity registered for both apps in Firebase App Check, the Play
app-signing SHA-256 on each Firebase Android app, and both Play apps linked to
Cloud project `aglyn-main` (543499566626) for the Integrity API. Release builds
have `APP_CHECK` on (`-Paglyn.appCheck=off` turns it off for a project that
does not enforce it); debug builds, on the emulators, have it off.

- Google Play Console apps `com.aglyn.app` and `com.aglyn.pos`, enrolled in Play
  App Signing with the upload certificate above, and an internal testing track;
  then each app signing key's SHA-1 and SHA-256 on its Firebase Android app.
- FCM enabled on the project.
- Stripe Terminal live mode, and Tap to Pay on Android for the POS app.
- `assetlinks.json` at `https://app.aglyn.com/.well-known/assetlinks.json`
  (app links, both apps) and `https://aglyn.com/.well-known/assetlinks.json`
  (passkeys, `com.aglyn.app`), with the Play app signing certificates' SHA-256.
  Passkeys also need the `delegate_permission/common.get_login_creds` relation for `com.aglyn.app` in the apex
  file (template: `docs/mobile/well-known/`); then the release is built with `-Paglyn.passkeyRpId=aglyn.com` and the
  certificate's hash is listed in the console's `PASSKEY_ANDROID_APK_KEY_HASHES`. Until then "Set up a passkey" is hidden.
- Google sign-in for "Connect Google": the Firebase project's Web OAuth client id (`-Paglyn.googleWebClientId`) and an
  Android OAuth client in the same Google Cloud project for `com.aglyn.app` and its release signing certificate's SHA-1;
  on Windows a Desktop OAuth client (`AGLYN_GOOGLE_DESKTOP_CLIENT_ID` and `AGLYN_GOOGLE_DESKTOP_CLIENT_SECRET`). The
  action is hidden until they are set.
- Desktop (Windows): code signing (Azure Trusted Signing or an EV certificate)
  and/or a Microsoft Store account.
