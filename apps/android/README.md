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
```

Desktop signs in through the Identity Toolkit REST API and reads Firestore
through its REST API with the person's own ID token (the same rules). A
visible document or list is a gRPC `Listen` stream opened with a freshly
minted ID token and re-opened before that token's hour is up; a stream that
cannot be held three times in a row falls back to re-reading every 30
seconds. The refresh token is kept in Windows Credential Manager (through
JNA), so the next launch signs straight back in; a macOS or Linux run keeps it
in memory and signs in each launch. The console opens in the system browser,
and desktop has no push in v1 (Settings → Notifications still edits which
types reach the person's phones and tablets).

To watch `Listen` work against the emulator stack:
`AGLYN_LISTEN_EMULATOR=127.0.0.1:8289 AGLYN_LISTEN_AUTH=127.0.0.1:9299 AGLYN_LISTEN_PROJECT=demo-aglyn-native ./gradlew :native-core:desktopTest --tests '*ListenTest*'`. Menus: Go (⌘/Ctrl 1–3, ⌘/Ctrl ,),
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

The register's camera button scans barcodes with CameraX and ML Kit's bundled
model (`libs/native/kotlin/camera`, provided to the kit's `BarcodeScanSheet`
through `LocalCameraScanner`). Each code goes through the same barcode-then-SKU
lookup as a keyboard-wedge scan, and the sheet stays open for the next item.

Release builds take no emulator host and default the console to
`https://app.aglyn.com`; `AglynConfig.problems()` logs anything missing.

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

- Firebase Android app registrations for `com.aglyn.app` and `com.aglyn.pos`
  (their app ids go into the release build fields), and FCM enabled on the project.
- Google Play Console apps `com.aglyn.app` and `com.aglyn.pos`, with Play App
  Signing and an upload key for each.
- Stripe Terminal live mode, and Tap to Pay on Android for the POS app.
- `assetlinks.json` on the console origin, with both apps' signing certificate
  fingerprints, so console links open the apps.
- Desktop (Windows): code signing (Azure Trusted Signing or an EV certificate)
  and/or a Microsoft Store account.
