# Aglyn and Aglyn POS for Android (and the JVM desktop)

The native Kotlin apps (AGL-3652, AGL-3653). One Gradle root builds:

| module | what it is |
| -- | -- |
| `:app` | **Aglyn** (`com.aglyn.app`; debug builds are `com.aglyn.app.dev`) |
| `:plugin-manifest` | every plugin's native registrar, from the generated `PluginManifest.generated.kt` |
| `:native-*` | the shared foundation in `libs/native/kotlin` (`core`, `ui`, `plugin-host`, `webview`, `shell`, `contracts`, `hardware`) |
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
node apps/mobile/scripts/seed-emulator.mjs

cd apps/android
./gradlew :app:assembleDebug
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

Release builds take no emulator host and default the console to
`https://app.aglyn.com`; `AglynConfig.problems()` logs anything missing.

## Plugins

A plugin's native screens live in `libs/plugins/<id>/src/android`, a KMP module
whose registrar registers the ids its `mobile.contributes` block declares in
`plugins.config.json`. `npm run generate:plugin-manifests` writes the manifest
and properties files from the plugin's `mobile.android` block. Until a plugin's
block lands, `native-plugins.properties` and `NativePlugins.kt` carry it, and a
generated entry always wins.

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
