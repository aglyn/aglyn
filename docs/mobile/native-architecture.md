# Native apps: architecture

AGL-3651 (iOS, Swift/SwiftUI), AGL-3652 (Android, Kotlin/Jetpack Compose) and
AGL-3653 (desktop: macOS from the SwiftUI code, Windows from the Kotlin code
through Compose Multiplatform). Project P-AGL-141.

On 2026-10-07 Zach decided to build two native apps per platform. Later the
same day he dropped React Native: the native apps are now **the only apps**.
`apps/mobile`, `apps/pos-mobile`, `libs/mobile/*`, each plugin's `src/mobile`,
the RN dependencies, the RN mobile manifest, the Expo push sender and the RN
CI job are removed from `main` once the native skeletons land (AGL-3651).
Their unmerged work is parked, never to be merged, on
`reference/rn-pos-mobile-agl3618`, `reference/rn-mobile-commerce-agl3621` and
`reference/rn-mobile-workspace-agl3622`. Those branches and the RN code in
history (up to the removal commit) are the functional reference for screens
and behavior. The apps are:

| app | bundle / package | what it is |
| -- | -- | -- |
| **Aglyn** | `com.aglyn.app` | Manages the workspace: sites, team, products, orders, forms, media, analytics, bookings, CRM, emails, inbox and notifications. The Besigner and the long-tail console screens open in an authenticated WebView. There is no native builder. |
| **Aglyn POS** | `com.aglyn.pos` | The register: fast item picking, Stripe Terminal (Tap to Pay and Bluetooth readers on mobile, smart readers everywhere), tips, receipts and booking payments. |

Both apps run on phone, tablet and desktop. UI quality is the bar. The iOS and
macOS apps use SwiftUI with the standard navigation and controls. The Android
and desktop apps use Material 3 with adaptive layouts.

What the React Native foundation (AGL-3620) decided carries over, and this
document reuses it:

- the plugin `mobile` surface in `plugins.config.json`;
- the deep-link grammar;
- the push device registry `users/{uid}/devices`;
- the notification catalog;
- the console API routes.

## 1. Rules (binding, inherited from the mobile brief)

1. **Everything is a plugin.** A plugin's native screens live in the plugin,
   in `libs/plugins/<p>/src/ios` and `libs/plugins/<p>/src/android`. The app
   shells import the foundation and the generated native manifest. They never
   import a plugin directly.
2. **Zero web bytes.** No web manifest, bundle, `tsconfig.next.json` or Next
   config changes because of native code. Native sources are Swift and Kotlin,
   which no web toolchain reads, and the guard in §9 holds the file level both
   ways.
3. **Native code never imports web or server code.** The only things it shares
   with TypeScript are generated: contracts, theme tokens, the notification
   catalog and the plugin manifest (§5–§7). They are generated from pure
   modules that `tools/scripts/mobile-pure-modules.json` already proves pure.
4. **No privileged mobile path.** Writes go through the same console API
   routes the console calls, with the Firebase ID token as the bearer. Reads go
   through Firestore under the same security rules the console runs under. A
   route or rule refuses the app exactly when it would refuse the console.
5. **Linear moves with the work.** A commit cites a real `AGL-nnnn` (3651
   iOS, 3652 Android, 3653 desktop).

## 2. Repo layout

```
apps/ios/                                Xcode project (AGL-3651, AGL-3653)
  Aglyn.xcodeproj                        one project; synchronized folders, no per-file lists
  Aglyn/                                 "Aglyn" app target: iOS + iPadOS + macOS (one multiplatform target)
  AglynPOS/                              "Aglyn POS" app target: iOS + iPadOS + macOS
  AglynTests/ AglynUITests/              XCTest / XCUITest
  PluginManifest/                        GENERATED Swift package (Package.swift + manifest source)
  Config/                                xcconfigs: Emulator.xcconfig (default), Production.xcconfig.example
  README.md                              develop, test, and what Zach owes
  project.json                           Nx: scope:mobile type:app

apps/android/                            Gradle root (AGL-3652, AGL-3653)
  settings.gradle.kts  build.gradle.kts  gradle/libs.versions.toml  gradlew
  app/                                   com.aglyn.app (Android application)
  pos/                                   com.aglyn.pos (Android application)
  desktop/                               Compose Desktop entry points: AglynDesktop + AglynPosDesktop (JVM; MSIX on Windows)
  plugin-manifest/                       KMP module; its manifest source is GENERATED
  native-plugins.generated.properties    GENERATED: plugin id → module dir
  README.md  project.json

libs/native/apple/                       Swift package "AglynKit" (iOS 17+, macOS 14+)
  Package.swift
  Sources/AglynCore/                     auth, workspace/site, API client, Firestore reads, push, deep links, config
  Sources/AglynUI/                       theme (Tokens.generated.swift), components, adaptive layout
  Sources/AglynWebView/                  authenticated console WebView + bridge
  Sources/AglynPluginHost/               registrars, registry, deep-link resolution
  Sources/AglynContracts/                GENERATED contracts (Contracts.generated.swift + JSON resource)
  Sources/AglynHardware/                 POS peripherals: ESC/POS printers, cash drawer, HID scanners (macOS/iPad)
  Tests/…

libs/native/kotlin/                      KMP modules (commonMain, androidMain, desktopMain)
  core/ ui/ webview/ plugin-host/ contracts/ hardware/
  (included by apps/android/settings.gradle.kts)

libs/plugins/<p>/src/ios/                a plugin's Apple code: its own Swift package "Aglyn<P>Plugin"
libs/plugins/<p>/src/android/            a plugin's Kotlin code: a KMP module (android + desktop)
```

The plugin folders keep the names `ios` and `android` from the brief.
`src/ios` builds for iOS, iPadOS **and macOS**. `src/android` is a Kotlin
Multiplatform module that builds for Android **and the JVM desktop**. A
plugin's desktop code is that same source. There is no third codebase.

Why `libs/native/*` and not more of `libs/mobile/*`: `libs/mobile/*` is
TypeScript that only the React Native apps compile, and the guard treats it
that way. The native libraries are Swift and Kotlin, they serve desktop too,
and they have their own toolchains. Keeping them in their own tree keeps
`check:mobile-isolation`'s TypeScript walk and the native walk (§9) separate
and simple.

### Xcode project

There is one `Aglyn.xcodeproj` with two **multiplatform** app targets.
`SUPPORTED_PLATFORMS = iphoneos iphonesimulator macosx`, so each target is
native SwiftUI on macOS, not Catalyst. Catalyst is used only if a dependency
forces it, and none does today. The project uses Xcode's file-system-
synchronized groups, so adding a Swift file never edits `project.pbxproj`, and
merges stay quiet. Local Swift packages are referenced by relative path:
`libs/native/apple`, `apps/ios/PluginManifest`, and through it every plugin's
`src/ios`. External packages come in through SPM: `firebase-ios-sdk` (Auth,
Firestore, Messaging) and `stripe-terminal-ios` (iOS only).

`#if os(iOS)` appears only where an API is iOS-only: Tap to Pay, Bluetooth
readers, the camera barcode scanner, and the `UIApplication` push
registration. Everything else in `AglynKit` and the plugin packages is
platform-agnostic SwiftUI.

### Gradle build

`apps/android` is the only Gradle root. It includes:

- the app modules;
- the `libs/native/kotlin/*` modules, through `projectDir`;
- every plugin's `src/android`, through the generated
  `native-plugins.generated.properties`.

It uses version catalogs and the Kotlin Multiplatform, Compose Multiplatform
and Android Gradle plugins. Shared logic and UI live in `commonMain`. Android
APIs (the Firebase Android SDK, Stripe Terminal Android, CameraX, FCM) live in
`androidMain`, behind interfaces that `commonMain` declares. Desktop
implementations live in `desktopMain`.

## 3. The foundations

Each foundation mirrors a React Native lib, now removed. Read it at the
removal commit's parent or on the `reference/rn-*` branches, match its
behavior, and keep its specs' cases.

| concern | RN reference | Apple (`AglynKit`) | Kotlin (`libs/native/kotlin`) |
| -- | -- | -- | -- |
| config | `libs/mobile/core/src/lib/config.ts` | `AglynConfig` from Info.plist keys set by xcconfig (`AGLYN_CONSOLE_URL`, `AGLYN_FIREBASE_*`, `AGLYN_AUTH_EMULATOR_HOST`, `AGLYN_FIRESTORE_EMULATOR_HOST`, `AGLYN_BRAND_NAME`), same validation (`https` except local hosts, no emulator on a non-local console) | `AglynConfig` from `BuildConfig` fields (Android) / a properties file (desktop), same rules |
| auth | `auth.tsx` | Firebase iOS SDK Auth (email/password; Google when configured), Keychain persistence, emulator via `useEmulator` | Android: Firebase Android SDK. Desktop: Identity Toolkit REST (`accounts:signInWithPassword`, `securetoken` refresh), refresh token in the OS credential store; same emulator switch |
| API client | `api-client.ts` | `ConsoleAPIClient` (`URLSession`, async/await): bearer ID token, one forced refresh on 401, GET/idempotent retries on network/502/503/504 with 400·2ⁿ ms backoff, `Idempotency-Key`, `ConsoleAPIError(status, message)` with `consoleErrorMessage` wording | the same, on Ktor client (`OkHttp` engine on Android, `Java` engine on desktop) + kotlinx.serialization |
| Firestore reads | `live-doc.ts`, `list-query.ts` | Firebase iOS SDK snapshot listeners; `ListQuery` runs the generated list declarations (§5) as SDK constraints, a page at a time plus one probe row | Android: Firebase Android SDK listeners. Desktop: **Firestore REST** (§4) |
| workspace + site | `workspace.tsx`, `org-access.ts` | `WorkspaceStore` (`@Observable`): `users/{uid}/orgs`, `users/{uid}/hostMemberships where orgId ==`, persisted pick | `WorkspaceStore` (`StateFlow`), same queries |
| console WebView | `libs/mobile/webview` | `WKWebView` signed in by POSTing the ID token to `/api/auth/session` (the console's own route; HttpOnly `__session` cookie into `WKHTTPCookieStore`); origin-checked bridge with the same method allowlist as `bridge-protocol.ts`; native back | Android `WebView` + `CookieManager`; desktop: the system browser with a one-time session handoff, because the JVM has no first-party WebView |
| deep links | `plugin-host/src/lib/deep-links.ts` | the same grammar: strip `/{org}/hosts/{host}`, match registered patterns, otherwise WebView. Universal links on the console origin, plus the `aglyn://` scheme | App Links + `aglyn://`; desktop: `aglyn://` URL handler (macOS via the app, Windows via MSIX protocol registration) |
| theme | `libs/mobile/ui` + `tokens.generated.json` | `Tokens.generated.swift` (§7), applied through SwiftUI `tint`, semantic colors and `ShapeStyle`s; system fonts and Dynamic Type | `Tokens.generated.kt`, giving a Material 3 `ColorScheme` (light/dark) for `MaterialTheme`. Dynamic color stays off, so the brand palette holds |
| layout | `useLayout()`, `SplitView` | `NavigationSplitView` on iPad/Mac, `TabView` + `NavigationStack` on iPhone; Mac adds `commands` (menus + shortcuts) and `WindowGroup`s for an order/product in its own window | `NavigationSuiteScaffold` (bar → rail → drawer by window size class) + `ListDetailPaneScaffold`; desktop adds a `MenuBar` with shortcuts and extra windows |
| push | `apps/mobile/src/shell/push.ts` | APNs directly (§8): register, write `users/{uid}/devices/{installId}`, delete on sign-out, deep-link the tap | FCM directly (§8), same registry; desktop has no push in v1 (§8) |
| biometric lock | `app-lock.tsx` | LocalAuthentication; Touch ID on Mac | BiometricPrompt; desktop: none |

### Plugin host (the native plugin surface)

The plugin host mirrors `libs/mobile/plugin-host/src/lib/types.ts`. There are
five contribution kinds, `screens`, `tabs`, `widgets`, `quickActions` and
`deepLinks`. Ids are `<pluginId>.<name>`, and the ids are **the same ones**
the plugin declares under `mobile.contributes` in `plugins.config.json`. The
native registry refuses a registration the declaration does not name, the
same rule the RN loader enforces. The RN and native apps are two renderers of
one declared inventory. A link or notification therefore resolves to the same
contribution id in both, and no plugin has two lists that drift.

Native-only fields are kept to the minimum:

- `apps`: `[.aglyn]`, `[.pos]` or both, with `.aglyn` as the default. The POS
  shell shows only contributions that name `.pos`.
- `icon`: an SF Symbol on Apple and a Material Symbol on Kotlin. The RN
  Ionicons name stays with RN.
- `placement`, for POS: `register`, `tender`, `peripheral` or `menu`.

```swift
// libs/plugins/redirects/src/ios/Sources/AglynRedirectsPlugin/Register.swift
public func registerRedirectsNative(_ r: NativePluginRegistrar) {
  r.screen("redirects.list", title: "Redirects", requiresSite: true) { ctx, params in RedirectsListScreen(ctx: ctx) }
  r.widget("redirects.summary", title: "Redirects", order: 40, size: .half, requiresSite: true) { RedirectsSummaryWidget(ctx: $0) }
  r.quickAction("redirects.open", title: "Redirects", icon: "arrow.triangle.turn.up.right.diamond", order: 40, screen: "redirects.list", requiresSite: true)
  r.deepLink("redirects.page", path: "/redirects", screen: "redirects.list")
}
```

```kotlin
// libs/plugins/redirects/src/android/src/commonMain/kotlin/com/aglyn/plugins/redirects/Register.kt
fun registerRedirectsNative(r: NativePluginRegistrar) { … same ids … }
```

A screen gets a `NativePluginContext`, the twin of `MobilePluginContext`:

- `uid`, `orgId`, `hostId`, `orgSlug` and `hostSlug`;
- `firestore`, a reader interface rather than the SDK, so desktop can swap in
  REST;
- `api`;
- `navigate(screenId, params)`;
- `openConsolePath(path, scope)`.

### Generated native manifest

A plugin's `mobile` block in `plugins.config.json` names its native
registrars next to its declared contributions:

```json
"mobile": {
  "contributes": { … },
  "ios": { "module": "AglynRedirectsPlugin", "register": "registerRedirectsNative" },
  "android": { "package": "com.aglyn.plugins.redirects", "register": "registerRedirectsNative" }
}
```

The RN registrar name (`register`) stays only until React Native is removed,
and goes with it.

`tools/scripts/generate-plugin-manifests.mjs` (with its rows built and
validated in `tools/scripts/lib/native-manifest.mjs`, which has its own tests)
writes the following files:

- `apps/ios/PluginManifest/Package.swift`: depends on each plugin's
  `src/ios` package by relative path, and on `AglynKit`.
- `apps/ios/PluginManifest/Sources/AglynPluginManifest/PluginManifest.generated.swift`:
  `NativePluginManifest.entries`, holding id, declared contributions and the
  registrar function.
- `apps/android/native-plugins.generated.properties`: `plugin-<id>` =
  `../../libs/plugins/<id>/src/android`. `settings.gradle.kts` includes these,
  and `plugin-manifest/build.gradle.kts` depends on them.
- `apps/android/plugin-manifest/src/commonMain/kotlin/com/aglyn/plugins/manifest/PluginManifest.generated.kt`.

Validation fails the generator in these cases:

- a `native` block without a `mobile` block;
- an unknown key;
- a module or package that does not match its plugin;
- a `src/ios/Package.swift` or `src/android/build.gradle.kts` that does not
  exist.

`generate:plugin-manifests:check` covers the native outputs, and the web
manifests stay byte-identical because no web generator reads `mobile`.

## 4. Desktop data access (AGL-3653): decided

**Desktop reads Firestore through the Firestore REST API (v1) with the user's
own ID token as the bearer.** The same security rules apply, so there is no
privileged path.

Why REST, and not the console API routes: the console itself reads most lists
straight from Firestore, and no route serves them. Routing desktop reads
through new routes would mean writing a privileged read path per list, which
is exactly what rule 4 forbids. REST is the same database and the same rules,
and it carries the same query shape: `runQuery` takes a `structuredQuery`
that the generated list declarations (§5) translate into, just as the SDKs'
constraints do.

What REST lacks is realtime listeners. So `desktopMain`'s `FirestoreReader`:

- refreshes on focus, on pull and on a 30-second timer while a list is
  visible;
- pages with `startAt` cursors on the same order fields.

gRPC `Listen` would give realtime, but it is not worth its weight in v1. The
reader interface lets a later swap stay local.

Writes stay on the console API routes, the same as on every platform.

Auth on desktop uses the Identity Toolkit REST endpoints (§3). The refresh
token is kept in the OS credential store: Keychain on macOS, which never
runs the JVM build in production, and Windows Credential Manager through JNA.

## 5. Shared contracts codegen

The console's pure model and query modules are TypeScript. The native apps
must not hand-copy them. `tools/scripts/generate-native-contracts.mjs`
(`--check` for drift, run in the guard sweep and in CI) generates them.

- **Input:** `tools/scripts/native-contracts.json`, which lists what to emit:
  - **values**: named exports of modules that are **already** on
    `mobile-pure-modules.json`. Examples: `ORDER_LIST_QUERY`,
    `PRODUCT_LIST_QUERY`, the status and channel label maps, and the
    `NOTIFICATION_TYPE_LEVELS`.
  - **types**: interfaces, string-literal unions and enums from those same
    modules, and route payload types. A route payload type is only ever moved
    into a pure module, never read from a server file.
  The generator refuses a module that is not on the pure list, so the
  contracts can never reach web or server code.
- **How:** values are loaded with `jiti`, the same loader
  `generate-mobile-theme-tokens.mjs` uses, and serialized. Types are read with
  the TypeScript compiler API and translated as follows:
  - a string-literal union becomes a Swift `enum: String, Codable,
    CaseIterable` or a Kotlin `@Serializable enum class` (`@SerialName`
    per case), with an `unknown` fallback case, so a newer server value never
    crashes an older app;
  - an interface becomes a `struct: Codable, Hashable, Sendable` or a
    `@Serializable data class`, with optional fields optional;
  - `Record<string, T>` becomes a dictionary or map;
  - unsupported shapes fail the generator by name.
- **Output:**
  - `libs/native/contracts/contracts.generated.json` holds every value,
    such as list declarations and label maps, which both platforms load as a
    bundled resource;
  - `libs/native/apple/Sources/AglynContracts/Contracts.generated.swift`;
  - `libs/native/kotlin/contracts/src/commonMain/kotlin/com/aglyn/contracts/Contracts.generated.kt`.
- **The list-query planner itself** (`planListQuery`, the filter grammar) is
  logic, not data. It is ported once per platform in `AglynCore` /
  `core` (`ListQueryPlan`). Its spec cases are generated alongside the
  contracts: `list-query-cases.generated.json` holds input declaration,
  request and expected constraints, produced by running the TS planner. Each
  platform's unit tests replay every case, so the ports cannot drift from the
  console.

## 6. Notification catalog

`tools/scripts/generate-mobile-notification-catalog.mjs` writes the member
notification types to `libs/native/contracts/notification-catalog.generated.json`
(it wrote them for the RN app before), and both native settings screens read
it. Taps use the same `MobilePushData`
(`type`, `link`, `orgId`, `hostId`) that `libs/aglyn/src/lib/app-utils/mobile-push.ts`
defines, and the link resolves through the deep-link grammar.

## 7. Theme

`tools/scripts/generate-mobile-theme-tokens.mjs` reads the resolved console
MUI theme. It is extended to also emit:

- `libs/native/apple/Sources/AglynUI/Tokens.generated.swift`:
  `AglynTokens.light/dark` with each intent (`main`, `contrastText`, `text`,
  `pressed`), background, text, divider, grey, radius and spacing, as `Color`
  values parsed from the same strings (`#rrggbb[aa]`, `rgb()`, `rgba()`);
- `libs/native/kotlin/ui/src/commonMain/kotlin/com/aglyn/ui/Tokens.generated.kt`:
  the same data, plus `lightColorScheme`/`darkColorScheme` mappings.

The intents map to Material 3 roles as follows: primary → primary, secondary →
secondary, tertiary → tertiary, error → error, background/paper →
background/surface. `--check` covers all three outputs.

## 8. Push

The registry stays `users/{uid}/devices/{installId}`, one row per install, and
its rules stay owner-only. It grows one field: `transport`, either `apns` or
`fcm`. Expo is out with React Native, so the rules no longer accept an Expo
token, and the fan-out prunes any `expo` row it meets (no RN app was ever
released, so such rows exist only on test devices). The rules accept each
token by transport:

- an APNs device token: hex, 64 to 200 characters;
- an FCM registration token: `[A-Za-z0-9_:-]`, 100 to 4096 characters.

An APNs row also carries `apnsEnvironment` (`sandbox`/`production`) and
`app`. Rules tests cover each transport.

Server side, all of it server-only, in `libs/tenant/data/admin/src/lib/server/`
next to `push-delivery.ts`:

- `push-delivery.ts` groups a user's devices by transport. The Expo sender
  (`exp.host`) is deleted.
- `push-apns.ts` sends over HTTP/2 (`node:http2`) to
  `api.push.apple.com` / `api.sandbox.push.apple.com`, with an ES256 provider
  JWT signed by `node:crypto` from `APNS_KEY_P8`, `APNS_KEY_ID` and
  `APNS_TEAM_ID`. The topic is the row's bundle (`com.aglyn.app` /
  `com.aglyn.pos`). It reuses the JWT for up to 50 minutes. A `410` or
  `BadDeviceToken` prunes the row. With no key, it is skipped and logged once.
- `push-fcm.ts` uses `firebase-admin` `getMessaging().sendEach`, with the same
  project credentials the server already holds, so no new secret is needed.
  `messaging/registration-token-not-registered` prunes the row.
- The kill switch (`mobile-push-switch.ts`) and the per-type preferences apply
  to both transports alike. Apple and Google are the push subprocessors
  (AGL-3648).

On desktop, macOS registers for APNs like iOS, with the `macos` platform and
the same bundle ids. Windows has no push in v1, because WNS needs a Store
identity Zach does not have yet. The desktop app shows the notification feed
from Firestore instead, refreshed on focus.

## 9. Isolation guard

`check:mobile-isolation` (`tools/scripts/lib/mobile-isolation.mjs`) gains a
native walk. It fails when any of these holds:

- **web → native:** any TS/JS file reaches into `apps/ios`, `apps/android`,
  `libs/native`, or any plugin's `src/ios` or `src/android`. This covers
  imports, `require`, and `new URL()` asset paths. A web `tsconfig*.json`
  `include` also may not reach these trees.
- **native → web or server:** a Swift, Kotlin or Gradle file under the native
  trees names a web or server path or package. That means a relative path into
  `apps/console`, `apps/tenant`, `apps/docs`, `libs/aglyn`, `libs/tenant`,
  `libs/besigner`, `libs/shared`, `libs/mobile`, or a plugin's non-native
  source. It also means a `sourceSets`/`path:` entry pointing outside the
  native trees, or `firebase-admin`, a service-account file, or an `sk_live_`
  or `sk_test_` key.
- **misplaced native source:** a `.swift`, `.kt` or `.kts` file outside
  `apps/ios`, `apps/android`, `libs/native` and `libs/plugins/*/src/{ios,android}`.

With React Native gone, the guard's TypeScript rules for `libs/mobile` and
plugin `src/mobile` go with it. `mobile-pure-modules.json` stays: it is now
the list of pure modules the native generators (§5) may read.

The only sanctioned crossings are the generated files of §3 and §5–§7. Their
generators read the pure modules. Native code reads only their outputs. Specs
for each rule live in `tools/scripts/lib/mobile-isolation.test.mjs`.

## 10. POS on every platform

The functional reference is the console register
(`libs/plugins/commerce/src/lib/components/console/pos/*`, `pos-api.ts`), plus
the RN POS lane (AGL-3618, `reference/rn-pos-mobile-agl3618`). The native POS register is native, not a WebView:

- **Register:** category chips, search, barcode scan, quick keys, a product
  grid, and variants and modifiers (`product-modifiers` contracts).
- **Cart and tender:** `/api/commerce/pos-order` and
  `/api/commerce/pos-payment` (`context`, tender and gift-card balance), the
  same routes and idempotency keys as the web register.
- **Tips** and **receipts by email or text**, through the routes the web
  register uses.
- **Booking payments:** the bookings plugin contributes a `.pos` screen.

Card readers by platform:

| platform | readers |
| -- | -- |
| iPhone / iPad | Stripe Terminal iOS SDK: Tap to Pay on iPhone, Bluetooth readers (M2, WisePad 3), and smart readers through the server-driven flow |
| Android phone / tablet | Stripe Terminal Android SDK: Tap to Pay on Android, Bluetooth readers, and smart readers through the server-driven flow |
| macOS / Windows | **Smart readers only** (WisePOS E, S700) through AGL-3607's server-driven flow (`/api/commerce/pos-readers`). Stripe's SDKs do not support Tap to Pay or Bluetooth there, and the UI does not offer them |

The SDK flow needs a connection token scoped to the site's Location. That is
the `commerce/pos-terminal-connection-token` route, which the AGL-3618 lane
wrote and parked on `reference/rn-pos-mobile-agl3618`. The native POS lands it
on `main`, because it is server code with nothing RN in it.

Peripherals live in the `AglynHardware` / `hardware` module:

- the AGL-3619 cloud printers, through their routes;
- on desktop (and iPad where the OS allows), direct ESC/POS receipt printers
  over the network (TCP 9100), USB and serial;
- a cash-drawer kick through the printer (`ESC p`);
- HID barcode scanners read as keyboard input, with a fast-burst detector.

The receipt bytes come from one ESC/POS encoder per platform, fed by the
generated receipt contract (`commerce-receipt`).

## 11. Nx and CI

**Nx.** Each of `apps/ios`, `apps/android`, `libs/native/apple` and
`libs/native/kotlin` has a `project.json` tagged `scope:mobile`, with
`type:app` / `type:feature`. Their targets are `nx:run-commands`, which wrap
`xcodebuild` / `./gradlew`:

- `build`;
- `test`;
- `build-macos`;
- `build-desktop`;
- `package-msix` (Windows only).

They carry `"cache": false` and no `implicitDependencies` on web projects, so
web affected runs never schedule them. The root `npm run typecheck` does not
see them.

**GitHub Actions**, in `.github/workflows/native.yml`, is path-filtered to
`apps/ios/**`, `apps/android/**`, `libs/native/**`,
`libs/plugins/*/src/{ios,android}/**`, the generators and their pure inputs:

| job | runner | runs |
| -- | -- | -- |
| `native-codegen` | ubuntu | the generators' `--check` (contracts, theme, catalog, manifests) |
| `native-apple` | `macos-latest` | `xcodebuild test` (iOS Simulator), `xcodebuild build` (macOS), both schemes; unsigned |
| `native-android` | ubuntu | `./gradlew assembleDebug testDebugUnitTest desktopTest` |
| `native-windows` | `windows-latest` | `./gradlew :desktop:packageMsi` (and MSIX packaging), artifact uploaded; unsigned |

These jobs are not in Main Gate's required set while the apps are pre-release.
The codegen `--check`s and the isolation guard **are** in the guard sweep, so
drift or a crossing is red on every push.

## 12. Configuration and what Zach owes

The apps build against the Firebase emulator stack and test configs by
default. The seed script moves from `apps/mobile/scripts/seed-emulator.mjs` to
`tools/scripts/seed-native-emulator.mjs` when React Native is removed. There are no real
`GoogleService-Info.plist` or `google-services.json` files: the Firebase SDKs
are configured in code from build settings (`FirebaseOptions`), which is also
how the self-hosted builds are configured.

Owed by Zach, listed in `apps/ios/README.md`, `apps/android/README.md` and
each issue's runbook comment:

- the Apple Developer enrollment, with App IDs `com.aglyn.app` and
  `com.aglyn.pos` (Push, Associated Domains);
- the Tap to Pay on iPhone entitlement;
- APNs key (`.p8`, Key ID, Team ID → `APNS_*` server env);
- Developer ID signing and notarization for macOS (or the Mac App Store);
- Firebase iOS, Android and macOS app registrations for both bundles;
- FCM enabled on the project;
- Google Play Console apps;
- Stripe Terminal live mode;
- Windows code signing (Azure Trusted Signing or an EV certificate) and/or a
  Microsoft Store account;
- `apple-app-site-association` and `assetlinks.json` on the console origin.
