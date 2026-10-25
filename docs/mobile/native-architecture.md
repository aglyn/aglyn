# Native apps: architecture

AGL-3651 (iOS, Swift/SwiftUI), AGL-3652 (Android, Kotlin/Jetpack Compose) and
AGL-3653 (desktop: macOS from the SwiftUI code, Windows from the Kotlin code
through Compose Multiplatform). Project P-AGL-141.

On 2026-10-07 Zach decided to build two native apps per platform. Later the
same day he dropped React Native: the native apps are now **the only apps**.
`apps/mobile`, `apps/pos-mobile`, `libs/mobile/*`, each plugin's `src/mobile`,
the RN dependencies, the RN mobile manifest, the Expo push sender and the RN
CI job were removed from `main` once both native skeletons landed (AGL-3651).
Their unmerged work is parked, never to be merged, on
`reference/rn-pos-mobile-agl3618`, `reference/rn-mobile-commerce-agl3621` and
`reference/rn-mobile-workspace-agl3622`. Those branches and the RN code in
history (up to the removal commit) are the functional reference for screens
and behavior. The apps are:

| app | bundle / package | what it is |
| -- | -- | -- |
| **Aglyn** | `com.aglyn.app` | Manages the workspace: sites, team, products, orders, forms, media, analytics, bookings, CRM, emails, inbox and notifications. Every console area is a native screen. Only the Besigner opens in a web view, inside the app. There is no native builder. |
| **Aglyn POS** | `com.aglyn.pos` | The register: fast item picking, Stripe Terminal (Tap to Pay and Bluetooth readers on mobile, smart readers everywhere), tips, receipts and booking payments. |

Navigation (the sidebars, settings modes, pins, starred and recents, the one
box and theming) is specified in `native-navigation.md` (AGL-3943).

### Native console, Besigner-only web view (binding, Zach 2026-10-07)

The apps manage the workspace natively. Every console area the Aglyn app
covers (sites, team, products, orders, forms, media, analytics, bookings, CRM,
emails, inbox, notifications and settings) is a native screen with native
reads and writes, never a console page loaded in a web view.

The **Besigner** is the only web content. It opens in an authenticated web
view *inside* the app, never in the system browser. A console link or
notification that targets a non-Besigner page goes to the matching native
screen. If no native screen exists yet, that is a gap to build; it never falls
back to opening the console web page.

The one exception is OAuth sign-in. Google refuses sign-in from embedded web
views, so Google sign-in uses the platform's auth sheet
(`ASWebAuthenticationSession`, Android Custom Tabs, or the desktop
loopback/PKCE flow below). That sheet only signs the user in; it never shows
console pages.

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

   A write the console makes client-side **with derived state** (fields it
   computes in the browser before the Firestore write) is never re-ported to
   Swift or Kotlin. The computation moves into a pure module in the plugin,
   the console imports it unchanged, and a plugin route runs the same module
   on the server under the same gate the Firestore rules put on that write.
   The first case is commerce's products:
   - `model/product-write.ts` holds the code, and the console product editor
     and Adjust stock dialog import it.
   - `POST /api/commerce/products/save` takes `{ hostId, productId, create,
     product }`. An edit is the console's full replace, and keeps live stock
     holds and stored timestamps. A create is keyed by a client-minted id,
     so a retry answers `replayed`, and it meets the `commerce` entitlement
     and the `productsPerHost` quota.
   - `POST /api/commerce/products/stock` takes `{ hostId, productId,
     variantId, delta, reason }` and requires an `Idempotency-Key`. The key
     names the `inventoryAdjustments` row, so a retry moves nothing twice.
   - Both routes admit a verified member with a write role, or staff, while
     the site is not frozen: `canWriteHostContent` and `hostWritesFrozen`.
     Both drop the site's cache through the publish outbox.

   The order screen's two hand writes follow the same rule. The console
   appends a note, and answers a restock question, with a client `updateDoc`
   of the order's `timeline` (and `restockCheck`), the only two fields the
   rules let a member write on an order. Both are read-then-append, so a
   stale seed would drop an event another tab wrote. `model/order-annotations.ts`
   holds the computation (`orderNoteUpdate`, `restockAnswer`, and
   `describeRestockCheck`, whose sentence the apps replay from
   `function-cases.generated.json`), the console's dialog imports it, and
   `POST /api/commerce/order-note` and `POST /api/commerce/order-restock-answer`
   run it in a transaction on the stored order under the same gate
   (`canWriteHostContent`, `hostWritesFrozen`).

   A read-only check the console runs before a client write works the same
   way: `POST /api/redirects/check` runs the Redirects page's save checks.
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
  Sources/AglynWebView/                  authenticated Besigner web view + bridge
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
Firestore, Messaging), and, for the AglynPOS target only and filtered to
iOS, `stripe-terminal-ios` (`StripeTerminal`). It is referenced by
`Aglyn.xcodeproj` itself, never by a plugin package, because both app targets
link the one plugin manifest. (A typed card uses no Stripe SDK on Apple: §
"Typed card".)

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
| Firestore reads | `live-doc.ts`, `list-query.ts` | Firebase iOS SDK snapshot listeners; `ListQuery` runs the generated list declarations (§5) as SDK constraints, a page at a time plus one probe row | Android: Firebase Android SDK listeners. Desktop: **Firestore REST + gRPC `Listen`** (§4) |
| workspace + site | `workspace.tsx`, `org-access.ts` | `WorkspaceStore` (`@Observable`): `users/{uid}/orgs`, `users/{uid}/hostMemberships where orgId ==`, persisted pick | `WorkspaceStore` (`StateFlow`), same queries |
| Besigner web view | `libs/mobile/webview` | Besigner paths only. `WKWebView` (iOS, iPadOS, macOS) signed in by POSTing the ID token to `/api/auth/session` (the console's own route; HttpOnly `__session` cookie into `WKHTTPCookieStore`), then opened through `/auth/besigner`, which signs the web view in before the editor loads; origin-checked bridge with the same method allowlist as `bridge-protocol.ts`; native back | Android `WebView` + `CookieManager`. Windows: WebView2 (Evergreen runtime), approved 2026-10-07: `BesignerWebView` hosts it in a heavyweight AWT canvas inside a Compose `SwingPanel`, driving `CreateCoreWebView2EnvironmentWithOptions` and `ICoreWebView2Controller` over COM through JNA on one STA thread with its own message loop; the `/api/auth/session` cookies go into `CoreWebView2CookieManager`; `NavigationStarting` keeps it on Besigner paths; the bridge rides `WebMessageReceived`; the profile is `%LOCALAPPDATA%\Aglyn\WebView2`. Only `WebView2Loader.dll` ships (no bundled Chromium). A Windows without the runtime gets a native screen with Microsoft's Evergreen bootstrapper. Never the system browser. |
| deep links | `plugin-host/src/lib/deep-links.ts` | the same grammar: strip `/{org}/hosts/{host}`, match registered patterns. A Besigner path opens the Besigner web view; any other unmatched path opens the nearest native screen, never a web page. Universal links on the console origin, plus the `aglyn://` scheme | App Links + `aglyn://`; desktop: `aglyn://` URL handler (macOS via the app, Windows via MSIX protocol registration) |
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
rule the RN loader enforced. The Swift and Kotlin apps are two renderers of
one declared inventory. A link or notification therefore resolves to the same
contribution id in both, and no plugin has two lists that drift.

Native-only fields are kept to the minimum:

- `apps`: `[.aglyn]`, `[.pos]` or both, with `.aglyn` as the default. The POS
  shell shows only contributions that name `.pos`.
- `icon`: an SF Symbol on Apple and a Material Symbol on Kotlin.
- `placement`, for POS: `register`, `tender`, `peripheral` or `menu`.
  `device` is a whole-screen mode a tablet is set up as with nobody signed in
  (the customer display, the self-service kiosk): the POS sign-in offers it, it
  is remembered across launches, and it is handed a context with no member, no
  workspace and no site, whose `api` it calls anonymously with its own pairing
  token (`headers`), and whose `back()` returns the tablet to sign-in. A kiosk
  takes Tap to Pay on the tablet's own card reader (Kotlin: the context's
  `peripherals`; Apple: the device reader it makes itself) with a connection
  token from the kiosk route, never a staff session.

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

A widget may name a `slot` (`r.widget(…, slot: "hostSeo")`) and then renders in a core
page's zone instead of Home: the native twin of the console's `PluginWidgetSlot`. A core page that hosts a zone draws
`context.slotWidgets(slot)` and never names the plugins that contribute. Site setup hosts three (AGL-3668):
`hostBusinessProfile` (what Aglyn AI learned from the site's edits), `hostSeo` under the SEO check (the listing the
guided start proposed), and `hostSettings`, which Setup's Integrations section draws for the plugins running on the site (a plugin's settings screen gets its card from its spec's `cardSlot`, so email platforms, Zapier, live chat and ad conversions each need no Kotlin or Swift of their own). The SEO page also hands its widgets a `SeoZone` (Kotlin
`LocalSeoZone`, Apple the `seoZone` environment value): the stored `seo` settings, and `proposeDraft(values, key)`,
which puts values in the form below as unsaved edits (the same key twice applies once; the form's Save is the write).

A screen gets a `NativePluginContext`, the twin of `MobilePluginContext`:

- `uid`, `orgId`, `hostId`, `orgSlug` and `hostSlug`;
- `firestore`, a reader interface rather than the SDK, so desktop can swap in
  REST;
- `api`;
- `navigate(screenId, params)`;
- `openBesigner(path, scope)`, which opens a Besigner page (a path whose last
  segment is `besigner`) in the app's web view and refuses any other path. A
  quick action opens a screen or a `besignerPath`, never a console page, and
  a link no plugin answers resolves to `.besigner` or `.unavailable`, never
  to a console web page. The web view itself refuses a main-frame navigation
  off the Besigner and hands the path back to the app's own resolver.

  The web view never loads the Besigner page directly (AGL-3850). It opens
  the console's `/auth/besigner?continue=<path>`, which turns the session
  cookie the app minted into the web view's own Firebase sign-in and only
  then moves on to the editor. Loaded straight from the cookie, the editor
  met a signed-out web view and sent it to the web sign-in page first.
  Leaving works the other way. The console moves between pages with its
  client-side router, so each platform also watches the page's address:
  `WKWebView.url`, Android `doUpdateVisitedHistory` and WebView2
  `SourceChanged`. The editor's back arrow (its page's `/view`) returns to
  the app's screen. Another console page returns to the app and opens that
  page's native screen when one exists. Reaching the sign-in wall means the
  session ended, and the web view says so. `BesignerEntry` in AglynCore and
  in the Kotlin `plugin-host` holds these rules. On Android, the web view
  accepts third-party cookies for the canvas and the auth frames, and only a
  main-frame navigation is ever routed out of the view.

  Every web view also appends `AglynApp/<version> (<platform>)` to its user
  agent (AGL-3894): WKWebView's `applicationNameForUserAgent` after WebKit's
  own `Mobile/…`, Android's `userAgentString`, and WebView2's
  `ICoreWebView2Settings2.UserAgent`. `BesignerEntry.userAgent…` builds it on
  both platforms. The console reads it, or the entry page's session mark,
  through `@aglyn/aglyn/app-utils/native-app-web-view` and leaves out what an
  app screen does not need: the web notification prompt, the editor's back
  arrow, and the unread count and trailing brand in the page title. The
  marker decides presentation only, never auth. The app names the screen
  itself ("Besigner"), so the Mac window title never comes from the page.

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

The React Native registrar name (`register`) went with React Native; a
`mobile` block takes only `contributes`, `ios` and `android`.

`tools/scripts/generate-plugin-manifests.mjs` (with its rows built and
validated in `tools/scripts/lib/native-manifest.mjs`, which has its own tests)
writes the following files:

- `apps/ios/PluginManifest/Package.swift`: depends on `AglynKit`
  (`libs/native/apple`) and on each plugin's `src/ios` package, which it
  reaches through a generated symlink, `Plugins/Aglyn<P>Plugin` → the plugin's
  `src/ios`. SwiftPM names a path dependency by its last directory, so every
  `src/ios` would be the same package `ios`, and a second native plugin would
  collide with the first. The link gives each a distinct name, and SwiftPM
  resolves it, so the plugin's own relative dependencies still hold. For the
  same reason a product of `AglynKit` is named by the package `apple`:
  `.product(name: "AglynPluginHost", package: "apple")`, in the manifest and
  in every plugin's `Package.swift`.
- `apps/ios/PluginManifest/Sources/AglynPluginManifest/PluginManifest.generated.swift`:
  `NativePluginManifest.entries`, holding id, declared contributions and the
  registrar function: `NativePluginManifestEntry(id:contributes:register:)`
  from `AglynPluginHost`, with `contributes: [String: [String]]` keyed by
  kind (`"screens"`, `"widgets"`, …) and `register:
  (NativePluginRegistrar) -> Void`.
- `apps/android/native-plugins.generated.properties`: `<id>` =
  `../../libs/plugins/<id>/src/android`. `settings.gradle.kts` includes these,
  and `plugin-manifest/build.gradle.kts` depends on them.
- `apps/android/plugin-manifest/src/commonMain/kotlin/com/aglyn/plugins/manifest/PluginManifest.generated.kt`:
  `object NativePluginManifest { val entries: List<NativePluginManifestEntry> }`,
  with `com.aglyn.pluginhost.NativePluginManifestEntry(id, contributes:
  Map<String, List<String>>, register: (NativePluginRegistrar) -> Unit)`.

Validation fails the generator in these cases:

- an `ios` or `android` key outside a plugin's `mobile` block, or one in a
  `mobile` block that declares no contributions;
- an unknown key;
- a module or package that does not match its plugin;
- a `src/ios/Package.swift` or `src/android/build.gradle.kts` that does not
  exist.

`generate:plugin-manifests:check` covers the native outputs, and the web
manifests stay byte-identical because no web generator reads `mobile`.

## 4. Firebase client per platform: decided

Each Firebase client option was checked against its current official docs and
repositories on 2026-10-07, and one was chosen per platform.

| option | platforms | Auth (email/password · Google · custom token) | Firestore realtime / offline | Storage | App Check | Messaging | support | rules apply |
| -- | -- | -- | -- | -- | -- | -- | -- | -- |
| **firebase-ios-sdk** (SPM) | iOS, native macOS, Catalyst | ✓ · ✓ (GoogleSignIn-iOS, iOS and macOS) · ✓; Auth "partial" on macOS | ✓ / ✓ | ✓ | DeviceCheck, App Attest (macOS 11+), custom, debug | ✓ | official; iOS GA, macOS and Catalyst "official beta" | ✓ |
| **Firebase Android SDK** (BoM) | Android only | ✓ · ✓ · ✓ | ✓ / ✓ | ✓ | Play Integrity | ✓ | official GA | ✓ |
| **Firebase C++ SDK**, desktop | Windows, macOS, Linux | ✓ | ✓ | ✓ | debug and custom only | stub | desktop is **beta, "not for publicly shipping code"**; no Java binding, so JNI glue and per-OS native libraries | ✓ |
| **GitLive firebase-kotlin-sdk** | Android, iOS, JVM, JS | wraps the official SDKs; on the JVM, only what firebase-java-sdk offers | 23% of the Firestore API | 64% | — | 5% | unofficial; v2.7.0 (2026-09-02), active | ✓ |
| **GitLive firebase-java-sdk** (its JVM backend) | JVM | ✓ · **✗** · ✓ | ✓ / ✓ | **✗** | — | — | unofficial **alpha**; last release and commit 2025-10-19; Apache-2.0 | ✓ |
| **Firestore REST + gRPC** with the user's ID token; Auth via Identity Toolkit REST | any | ✓ · ✓ (`signInWithIdp` after a loopback OAuth flow) · ✓ | gRPC `Listen` ✓ / **no offline cache** | our API routes | custom provider only | — | official public Google APIs | ✓ |
| **JS SDK in a WebView2 / JS engine** | any | ✓ | ✓ / IndexedDB | ✓ | reCAPTCHA | — | official SDK, unofficial host; the data layer would sit behind a JS bridge | ✓ |
| **Aglyn console API routes** as a backend-for-frontend | any | through our session | ✗ realtime | ✓ (today) | n/a | — | ours; a new route per list | only by re-implementing them |
| **Firebase Admin SDK** | servers | — | — | — | — | — | privileged environments only | **✗, bypasses rules: ruled out** |

| platform | choice | why |
| -- | -- | -- |
| **iOS / iPadOS** | firebase-ios-sdk (SPM) + GoogleSignIn-iOS | Official GA, with full coverage: offline Firestore, FCM/APNs, App Attest. |
| **macOS** (native, not Catalyst) | firebase-ios-sdk (SPM) + GoogleSignIn-iOS | The same Swift code as iOS. "Official beta", but Firestore, Storage, Functions, Messaging and App Check are all supported. The "partial" Auth cell is tested against the methods we use (email/password, Google, custom token). |
| **Android** | Firebase Android SDK (BoM) | Official GA, full coverage. |
| **Windows** (Compose Desktop / JVM) | **Identity Toolkit REST for Auth, Firestore REST for reads, grpc-java `Listen` for realtime, all with the user's ID token. Writes and uploads stay on our console API routes, except where the console itself writes Firestore as the owner (the notification settings map), which desktop writes the same way, a REST merge under the same rule.** | It is the only option built on official, production Google APIs with the rules enforced. The C++ desktop SDK is officially not for shipping. GitLive's JVM SDK is alpha, untouched since 2025-10, and lacks Google sign-in and Storage. |

How this shapes the code:

- **The Kotlin code shares an Aglyn interface, not a Firebase wrapper.**
  `commonMain` declares `AuthSession` (state, ID token, sign-in and sign-out)
  and `FirestoreReader` (get, query by the generated list plans, and `observe`
  as a `Flow`). `androidMain` implements them with the official SDK and
  `desktopMain` with the REST/gRPC client. GitLive is not used in
  `commonMain`.
- **`desktopMain` paging.** It pages with `runQuery` `structuredQuery`
  cursors, translated from the same generated declarations (§5).
- **Desktop realtime.** `Listen` runs over gRPC with
  `Authorization: Bearer <ID token>` (`GrpcFirestoreListen`, grpc-java over
  OkHttp with the published `proto-google-cloud-firestore-v1` messages and a
  hand-built method descriptor, so no protoc or generated stub). Each stream
  opens with a freshly minted token and is re-opened after 50 minutes, before
  that token expires; the new stream resends every row.
- **What the spike proved (2026-10-07), and what it did not.** Against the
  Firestore emulator (`demo-aglyn-native`), a `Listen` carrying the seeded
  member's ID token streamed their own `users/{uid}` document to CURRENT; the
  same token on another user's document, and no token at all, had the target
  removed with `PERMISSION_DENIED` from the `users/{userId}` rule; a token
  that is not a JWT was refused as `invalid jwt`. So the emulator evaluates
  the rules with the token's claims. The emulator does not check a token's
  signature or expiry the way production does, and nothing here has run
  against production Firestore: that production `Listen` accepts a Firebase
  ID token is still how the client SDKs work rather than something observed.
- **The fallback is built in.** An observation whose stream fails three
  times in a row without a snapshot (a refused or unreachable call) falls
  back to REST, re-reading every 30 seconds while it is collected, so a
  production refusal degrades to the polling desktop had before. A target the
  rules remove is shown as a failure, not a fallback, since REST would be
  refused the same way. It never falls back to the C++ SDK. Desktop is
  online-only with an in-memory cache.
- **Desktop Google sign-in** follows Google's recommended flow for desktop
  apps. The app opens the system browser and the redirect comes back to a
  loopback address, using PKCE. The resulting Google ID token goes to
  `accounts:signInWithIdp`. The refresh token is kept in the OS credential
  store: Windows Credential Manager through JNA (`CredWriteW`/`CredReadW`/
  `CredDeleteW` on `Advapi32`, a generic credential per app and Firebase
  project), restored with `securetoken` and `accounts:lookup` at launch. A
  macOS or Linux development run of the JVM build keeps it in memory.
- **App Check is enforced in production** on Authentication and Firestore,
  so every Firebase call carries a token (next section). Windows has no
  built-in attestation, so its sign-in goes through a console hand-off and
  its tokens are minted by the console for that session (next section).
  Measured against aglyn-main on 2026-10-15 with no token: Identity
  Toolkit's `accounts:signInWithCustomToken` answers 401 "Firebase App Check
  token is invalid." before reading the token, while the Secure Token refresh
  and `accounts:lookup` reach their own validation. So the hand-off's custom
  token cannot be exchanged without a token (the first one rides the
  redemption), and an ID token refreshes without one (the mint route needs
  only that). The order: redeem (code, verifier) → custom token and App
  Check token → `signInWithCustomToken` with that token → later tokens from
  `/api/auth/native-app-check`.
- **The console hand-off** (AGL-3816) is how an app signs in where the
  console has to run the sign-in itself: workspace single sign-on on every
  app, and every sign-in and sign-up on the Windows build against a project
  that enforces App Check. The app makes a PKCE pair and opens
  `/auth/native?start=signin|signup|sso&challenge=…&redirect_uri=…&state=…`
  (`ASWebAuthenticationSession` on Apple, a Custom Tab on Android, the system
  browser on the desktop). The page sends a signed-out visitor through the
  console's own `/signin`, `/signup` or `/sso`, then shows who is signed in
  and asks before continuing (AGL-1415). Continuing calls
  `POST /api/auth/native-handoff/authorize` (bearer ID token; verified
  address, no support session, the lockdown verdict), which stores a
  one-time code as its SHA-256 in the server-only `nativeHandoffs`
  collection, bound to the uid, the identity pool, the challenge and the
  return address, for 120 seconds. The page goes to the return address
  (`aglyn://auth/handoff`, `aglyn-pos://auth/handoff`, or
  `http://127.0.0.1:<port>/handoff` on the desktop) with the code and
  `state`. The app posts the code, its verifier and the same return address
  to `POST /api/auth/native-handoff/redeem`, which consumes the record in one
  transaction and mints a custom token in the account's own pool, and signs
  in with it in that pool. A sign-in on an address whose domain has workspace
  SSO (`/api/auth/sso-lookup`) goes this way from the email field, so an SSO
  account signs in as its tenant uid rather than as a project-pool account.
  On Android the SDK aims its one instance at the tenant
  (`setTenantId`), which it cannot undo, so after a single sign-on in one
  process the other doors ask for the app to be reopened.
- **The macOS app is the SwiftUI build,** so the JVM desktop target ships
  only for Windows (and Linux, which is not committed).

### App Check (AGL-3818)

Production (`aglyn-main`) enforces App Check on Authentication and Firestore:
a call without a valid `X-Firebase-AppCheck` token is refused before any rule
runs (`401 "Firebase App Check token is invalid."` from Identity Toolkit, a
permission error from Firestore). The emulator stack does not enforce it, so
`AGLYN_APP_CHECK` (on in Release, off in the emulator configs, and off by
default whenever an emulator or a local console is set) turns it on or off.

| platform | provider | how |
| -- | -- | -- |
| iPhone, iPad | **App Attest** (`DCAppAttestService`) | Firebase's `AppAttestProvider` from `FirebaseAppCheck`, a product of the firebase-ios-sdk the kit already links (its `app-check` dependency was already resolved). It generates the key, attests it once, keeps the key id and artifact in the Keychain, then sends an assertion over a fresh challenge; `DCError.invalidKey` resets the key and re-attests. Entitlement `com.apple.developer.devicecheck.appattest-environment = production` (TestFlight and the App Store use production regardless). |
| Mac | **DeviceCheck** (`DCDevice`) | `DCAppAttestService.isSupported` is false on every Mac, so `DeviceCheckProvider` (`exchangeDeviceCheckToken`). The App Attest entitlement does not exist on macOS. |
| Simulator | none | Neither is supported; the app sends no token, which only the emulator stack accepts. |
| Android phone, tablet | **Play Integrity** (`com.google.android.play:integrity`, approved 2026-10-15) | `firebase-appcheck-playintegrity` (BoM 34.19.0): `generatePlayIntegrityChallenge`, a classic Play Integrity request with that challenge as the nonce and the project number, then `exchangePlayIntegrityToken`. Installed on every Firebase app, including a support session's named app. |
| Windows (Compose Desktop) | **console-minted** (Zach, 2026-10-15) | `ConsoleMintedAppCheck`: there is no attestation on Windows, so the console mints the tokens (Admin `createToken`, one hour) for a session it signed in. The first rides the hand-off's redemption (`appCheckToken`); after that `POST /api/auth/native-app-check` with the app's current ID token (revoked tokens, disabled accounts and support sessions refused; rate limited per account and install; audited as `user.nativeAppCheck`). Cached, replaced at half-life, one mint at a time, re-minted when Firebase refuses it (`withAppCheck` retries a 401 once with a fresh token), dropped on sign-out. Weaker than App Attest or Play Integrity: it attests a live console session, not a genuine binary. |

The SDKs (Auth and Firestore on Apple and Android) read the token through
`FirebaseAppCheck` on their own, which is why the official providers are used
rather than a hand-written REST client: the SDKs accept a token only through
that interop. Their core caches the token for its TTL, refreshes it before it
lapses and shares one in-flight exchange among concurrent callers. The kit's
REST and gRPC clients (Identity Toolkit and Secure Token for the unsigned Mac
build and support sessions, Firestore REST, the Google link's
`signInWithIdp`) take the same token through `AppCheckTokenProvider`:
`AppCheckTransport` in Swift (adds the header to Firebase hosts only, and
resends once with a forced refresh on an App Check refusal) and
`HttpClient.withAppCheck` in Kotlin. Console API routes are not App Check
gated; they take the Firebase ID token as before. A refusal reads "This copy
of the app could not be verified. Update the app or try again." instead of the
generic sign-in failure.

Done (2026-10-15): the App Attest capability on `com.aglyn.app` and
`com.aglyn.pos`; App Attest registered in Firebase App Check for both Apple
apps (team R3B7G75SWA, 1 h TTL); Play Integrity registered for both Android
apps, with the Play app-signing SHA-256 on each Firebase Android app and both
Play apps linked to Cloud project `aglyn-main` (543499566626). Still owed:
DeviceCheck registration (a DeviceCheck `.p8` key and its Key ID) for both
Apple apps in Firebase App Check, which the Mac builds need; until then a Mac
build against production cannot sign in.

Sources: [App Check REST reference](https://firebase.google.com/docs/reference/appcheck/rest),
[App Attest provider](https://firebase.google.com/docs/app-check/ios/app-attest-provider),
[DeviceCheck provider](https://firebase.google.com/docs/app-check/ios/devicecheck-provider),
[Play Integrity provider](https://firebase.google.com/docs/app-check/android/play-integrity-provider),
[App Attest environment entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.devicecheck.appattest-environment),
[`DCAppAttestService.isSupported`](https://developer.apple.com/documentation/devicecheck/dcappattestservice/issupported).

Sources:

- [firebase-ios-sdk README, Apple platforms](https://github.com/firebase/firebase-ios-sdk#building-with-firebase-on-apple-platforms)
- [Firebase library support by platform](https://firebase.google.com/docs/ios/learn-more#firebase_library_support_by_platform)
- [GoogleSignIn-iOS](https://github.com/google/GoogleSignIn-iOS)
- [Android setup](https://firebase.google.com/docs/android/setup)
- [C++ desktop workflow](https://firebase.google.com/docs/cpp/setup#desktop-workflow)
- [C++ App Check debug provider](https://firebase.google.com/docs/app-check/cpp/debug-provider)
- [firebase-kotlin-sdk](https://github.com/GitLiveApp/firebase-kotlin-sdk)
- [firebase-java-sdk](https://github.com/GitLiveApp/firebase-java-sdk)
- [Firestore REST and the rules](https://firebase.google.com/docs/firestore/use-rest-api)
- [Firestore RPC reference (`Listen` is gRPC/WebChannel only)](https://docs.cloud.google.com/firestore/docs/reference/rpc/google.firestore.v1)
- [Identity Platform REST](https://docs.cloud.google.com/identity-platform/docs/use-rest-api)
- [OAuth for desktop apps (loopback + PKCE)](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Server client libraries bypass rules](https://firebase.google.com/docs/firestore/security/get-started)
- [Admin SDK is for privileged environments](https://firebase.google.com/docs/admin/setup)
- [App Check custom providers](https://firebase.google.com/docs/app-check/custom-provider)

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

### As built

- `tools/scripts/native-contracts.json` names the modules and, per module,
  the `types` and `values` to emit. `ints`, `json` and `omit` name fields
  (`Type.field`) that read as an integer, as raw JSON, or not at all. A key
  that matches no emitted field fails the run, so the list cannot go stale.
  `listQueryCases` names the declarations whose planner cases are recorded.
- Named types follow references: an interface's fields pull in the types
  they name, and each must be declared in a pure module. An inline object or
  literal union is named after its owner and field, as in `HostOrderReceiptRequest`
  or `OrderFulfillmentStatus`. A union of whole numbers and a whole-number
  constant are integers. Every other number is a `Double`, unless `ints`
  says otherwise. `unknown` is `ContractJSON` (Swift) / `JsonElement`
  (Kotlin).
- Swift: each enum is `String, Codable, CaseIterable, Hashable, Sendable`,
  with an `unknown` case (`unrecognized` when a value is already named
  `unknown`) that a value it does not know decodes to. Operator values are
  named as words: `==` is `equal` and `<=` is `lessThanOrEqual`. Each
  struct is `Codable, Hashable, Sendable`, with `public var` fields and a
  memberwise `public init`.
- Kotlin: each enum is an `enum class X(val raw: String)` with an `UNKNOWN`
  entry, serialized through a generated `XSerializer : RawEnumSerializer`.
  Each struct is a `@Serializable data class`, with optional fields `= null`.
  The `contracts` module needs `kotlinx-serialization-json`.
- `ContractValues` (both platforms) decodes `contracts.generated.json`. Each
  value is a property named after its export in camel case
  (`ORDER_LIST_QUERY` → `orderListQuery`). In Kotlin it is a facade over
  `@Serializable` part classes of 48 values each, every part decoded from
  the same JSON (`ContractValues.decode`), because one class of every value
  passes the JVM's 255-slot constructor limit (AGL-3703). The generator
  refuses a part over 128 slots.
- `list-query-cases.generated.json` holds `timeZone` (`UTC`), the planner's
  `normalizers` replayed over sample words (`key`, `token`, `reversed`,
  `tokens`), and one case per field operator, sort, search and refusal
  shape. Each case carries the request and the plan; a date is
  `{ "$date": ISO }`.
- `function-cases.generated.json` (`functionCases` in the config) holds the
  console's own answers from the pure formatters and rules the screens show:
  `formatOrderNumber`, `formatOrderMoney`, `formatReceiptMoney`,
  `formatReceiptTime`, `orderChannelLabel`, `canTransitionOrder` (every
  status pair), `orderRefundState`, `orderRefundSummary`, `orderNetCents`,
  `orderPaidCents` and `apportionCents`. Each platform ports them once, in its
  shared kit, and replays every case, so a native screen formats a number,
  amount or time exactly as the console does.
- Apple: `ContractValues.shared` reads `contracts.generated.json`, bundled
  with `AglynContracts` through a link in `Sources/AglynContracts/Resources`.
  The formatters and rules live in `AglynContracts` (`OrderFormatters.swift`,
  whole cents as `Int`); `planListQuery`, the name-search normalizers and
  `ListQueryPlan.apply(to:limit:)` (the plan on a Firebase `Query`) live in
  `AglynCore/ListQuery`. `AglynContractsTests` and `AglynCoreTests` replay the
  case files from `libs/native/contracts` by path.

## 6. Notification catalog

`tools/scripts/generate-mobile-notification-catalog.mjs` writes the member
notification types to `libs/native/contracts/notification-catalog.generated.json`
(it wrote them for the RN app before), and both native settings screens read
it. Taps use the same `MobilePushData`
(`type`, `link`, `orgId`, `hostId`) that `libs/aglyn/src/lib/app-utils/mobile-push.ts`
defines, and the link resolves through the deep-link grammar.

## 7. Theme

`tools/scripts/generate-mobile-theme-tokens.mjs` reads the resolved console
MUI theme and, through `tools/scripts/lib/native-theme.mjs`, also emits:

- `libs/native/apple/Sources/AglynUI/Tokens.generated.swift`: the types
  `AglynIntent` (`main`, `contrastText`, `text`, `pressed`), `AglynPalette`
  (each intent, `background: (default:, paper:)`, `text: (primary:,
  secondary:, disabled:)`, `divider`, `grey: [Int: Color]`) and
  `AglynTextStyle`, and `AglynTokens` with `light`, `dark`, `radius`,
  `spacing`, `fontFamily`, `fontPostScriptName`, `fontResource` and
  `AglynTokens.Typography.h1 … overline`. Colors are parsed at generation
  time into `Color(.sRGB, red:green:blue:opacity:)` literals. A text style's
  `font` is `Font.custom(fontPostScriptName, size:relativeTo:)` with its
  weight, so it scales with Dynamic Type.
- `libs/native/kotlin/ui/src/commonMain/kotlin/com/aglyn/ui/Tokens.generated.kt`:
  the same `AglynIntent`, `AglynPalette`, `AglynTextStyle` and `AglynTokens`
  (`RADIUS`, `SPACING`, `FONT_FAMILY`, `FONT_RESOURCE`, `light`, `dark`,
  `Typography`), plus `AglynLightColorScheme`, `AglynDarkColorScheme`,
  `aglynTypography(fontFamily)` (sp units, so it follows the font scale)
  and `AglynShapes`.

The type scale is each MUI variant at its phone size, in points or sp. The
Material 3 roles take h1–h3 as display, h4–h6 as headline, h6 and
subtitle1–2 as title, body1, body2 and caption as body, and button, caption
and overline as label. Intents map onto Material 3 roles: primary → primary,
secondary → secondary (its readable text color), tertiary → tertiary,
error → error, background → background and surface, and paper → the
surface containers. Each container is the intent's fill over the paper, at
14% in light and 24% in dark, composited at generation time. `--check`
covers all three outputs.

The brand face is vendored by `tools/scripts/vendor-native-fonts.mjs`
(`--check` pins both files by sha256): Google's `ofl/robotoflex` variable
TTF with its `OFL.txt`, at
`libs/native/apple/Sources/AglynUI/Resources/Fonts/RobotoFlex-Variable.ttf`
(+ `OFL.txt`) and
`libs/native/kotlin/ui/src/commonMain/composeResources/font/robotoflex_variable.ttf`
(+ `composeResources/files/RobotoFlex-OFL.txt`). The Apple app registers
the face at launch (`CTFontManagerRegisterFontsForURL` on
`Bundle.module`'s `fontResource`). Compose builds its `FontFamily` from
`Res.font.robotoflex_variable` and passes it to `aglynTypography`.

`tools/scripts/generate-native-brand-assets.mjs` (`--check`) writes the
logo, wordmark and app icons from the SVGs in
`apps/console/public/_static/images/brand`. A `-dark` file (dark ink) is the
light appearance, and `-light` the dark one:

- `libs/native/apple/Sources/AglynUI/Resources/Brand.xcassets`: image sets
  `AglynMark`, `AglynLogo` and `AglynWordmark`, each the console's SVG byte
  for byte with `preserves-vector-representation`, and a dark appearance
  where the ink changes. Read them as `Image("AglynLogo", bundle: .module)`.
- `libs/native/kotlin/ui/src/commonMain/composeResources/drawable{,-dark}/`:
  `aglyn_mark`, `aglyn_logo` and `aglyn_wordmark` as vector drawables
  (`Res.drawable.aglyn_logo`), converted from the same SVG paths.
- App icons, one per app, drawn from vector sources only: the layers in
  `apps/console/public/_static/images/brand/app-icon/` (`native-icon-ground.svg`,
  the primary-to-secondary gradient; `native-pos-receipt.svg`, the receipt)
  plus the console's own mark SVG, placed per `APP_ICONS` in
  `tools/scripts/lib/native-brand.mjs`. Aglyn is the all-white mark on the
  gradient; Aglyn POS is the multi-color mark printed on a receipt over the
  same gradient (AGL-3659). Outputs:
  `apps/ios/{Aglyn,AglynPOS}/Assets.xcassets/AppIcon.appiconset` (the 1024
  universal icon, and the macOS plate at every Mac size, 1x and 2x); for
  `apps/android/{app,pos}`, an adaptive icon
  (`res/mipmap-anydpi-v26/ic_launcher.xml` with the vector drawables
  `ic_launcher_background` (the gradient), `ic_launcher_foreground` (the art
  inside the 72dp viewport) and `ic_launcher_monochrome` (themed icons, where
  white shapes become outlines), and the `ic_launcher_background` color (the
  ground's first stop) for the splash screen, plus the 512
  `ic_launcher-playstore.png`; and
  `apps/android/desktop/icons/{aglyn,aglyn-pos}.{ico,icns}` for the packaged
  desktop app. minSdk is 26, so no legacy mipmap PNGs are needed. The PNGs are
  rendered with sharp (librsvg). `--check` holds them by size, transparency and
  the sha256 of every source SVG, in
  `tools/scripts/native-brand-assets.lock.json`.

### Themes, accents and density (AGL-3950)

The native apps' themes are contract values in
`libs/aglyn/src/lib/app-utils/native-themes.ts`. The source is the Native
App Figma file's variables (Themes, page 2:8): the collections Aglyn /
Theme, Appearance, Accent, Brand and Density. Figma wins wherever it
defines a value.

- **`THEME_PALETTES`**: six themes, Aglyn, Quiet, Night, Ocean, Warm and
  High contrast. Each has a light and a dark `ThemeColors`:
  - canvas, surface, raised, sunken, rail, hover and titlebar;
  - the subtle and strong borders;
  - three text colors;
  - five status bg/fg pairs;
  - the scrim and the danger fill.

  Quiet, Night (always dark) and High contrast are Figma's values exactly.
- **Aglyn** is the look that ships (`source: 'console'`): the console's
  resolved MUI scheme, the same scheme the shared tokens (§7) are generated
  from. Its dark surface is the console's paper, #2A3440.
  - Text, divider and hover are composited onto the paper.
  - The status colors are the console's MUI Alert, standard variant.
  - Figma supplies what the console has no color for: sunken, rail,
    titlebar, the strong border, "new", the scrim, and the danger fill. The
    console's `error.main` carries white text at only 4.36:1.
  - `THEME_CONSOLE_FIELDS` lists the console-sourced fields, and
    `apps/console/specs/native-theme-aglyn.spec.ts` holds them to the scheme.
  - Figma's Aglyn mode (Themes 2:8) now holds these same values.
  - The theme is labeled with the build's configured brand name
    (`brandLabel`), never a literal.
- **The original Figma Aglyn values** stay in code as `FIGMA_AGLYN_*`. They
  are the base for Quiet's status colors and for the Ocean and Warm
  derivations, which are unchanged.
- **Ocean and Warm** exist in Figma only as four-color previews.
  `deriveThemeFromPreview` builds their full palettes by one rule for both:
  - *Light:* the previewed canvas, surface and rail; raised = surface;
    sunken = canvas 25% toward the rail; hover = surface 10% toward the rail;
    titlebar = surface 35% toward the canvas; borders = the original Figma
    Aglyn borders, 18% and 22% toward the rail.
  - *Dark:* the original Figma Aglyn dark appearance tinted toward the dark
    rail seed (Ocean #0B3954, Warm #7A5634): canvas 22%, surface and raised
    18%, rail 45%.
  - Text, status and the scrim are the original Figma Aglyn values.

  Figma board 87:4930 on the Themes page shows the derived values.
- **Accents.** `THEME_ACCENTS` holds Figma's four Accent modes exactly (Blue,
  Violet, Pink, Workspace brand), each with fill, icon, soft, ring, on, hover
  and pressed, plus derived text shades. `THEME_ACCENT_SWATCHES` holds the
  picker's six swatches. `deriveAccent(hex)` returns a Figma mode for its
  ring color and derives any other color, such as a picked accent or a
  workspace's brand color:
  1. If white text on the color reaches 4.5:1, the fill keeps the color and
     `on` is white.
  2. Otherwise, if white reaches at least 3:1 and near-black reaches 4.5:1,
     the fill keeps the brand color and `on` flips to near-black. This is
     Figma's Pink. The 3:1 threshold sends Pink (3.34:1) here, and Blue
     (2.43:1) and the workspace green (2.99:1) to step 3, as Figma draws them.
  3. Otherwise the fill is darkened in 2% HSL-lightness steps until white
     reaches 4.5:1.

  For every accent:
  - hover and pressed are the fill 4% and 8% darker;
  - soft is the color at 16% alpha;
  - ring is the color itself;
  - icon reaches 3:1 on the light surface;
  - the two text shades reach 4.5:1 on Aglyn's light and dark surfaces.

  Figma's Violet is darker than the rule needs; Figma wins.
- **The console differs.** Its MUI theme (`accent-text.ts`,
  `accessible-shade.ts`) keeps `main` as a contained button's fill (3:1 for
  fills) and walks only a text shade, in 1% steps. Both measure contrast the
  same way (WCAG 2 relative luminance).
- **`THEME_DENSITIES`**: Comfortable and Compact, with Figma's space, radius,
  row, list-row, phone-row and title-bar sizes.

Role grants live beside these. `org-role-grants.ts` exports
`ORG_ROLE_GRANTS`: the org permission catalog and each role's default keys,
including the keys plugins declare, which the generator assembles from the
AI plugin's declarations. It also exports `rolePermissions(grants, role,
customRole?, overrides?)`, which mirrors the console's
`resolveOrgPermissions`. A native gate such as `hosts.create` or
`data.manage` therefore answers as the console does when a member row has
no `resolvedPermissions` stamp. `apps/console/specs/native-org-role-grants.spec.ts`
holds the table to the console's `DEFAULT_ROLE_PERMISSIONS`.

### Brand, type and polish (binding)

Every Apple screen is SwiftUI, on iPhone, iPad and macOS. UIKit or AppKit
appears only where SwiftUI has no equivalent, and then wrapped in a SwiftUI
view: `WKWebView`, the camera scanner and the Stripe Terminal UI.

Both platforms carry the console's branding and colors. Nothing is hand-typed;
each of these is generated from the source the web uses:

| what | source | Apple output | Kotlin output |
| -- | -- | -- | -- |
| colors (light and dark) | the resolved console MUI theme | `Tokens.generated.swift` | `Tokens.generated.kt`, Material 3 `ColorScheme`, dynamic color off |
| typography | the MUI theme's typography | type scale in `Tokens.generated.swift` | M3 `Typography` |
| shape and spacing | the MUI theme's shape and spacing | `Tokens.generated.swift` | M3 `Shapes` |
| typeface | Roboto Flex, the console's font (`buildFontFamilyList`, SIL OFL) | vendored with its license, behind a sha256 `--check`; `Font.custom(_:size:relativeTo:)`, so Dynamic Type scales | vendored, as a `FontFamily` |
| logo and wordmark | `apps/console/public/_static/images/brand/*.svg` (ink naming per `docs/BRAND_ASSETS.md`) | generated asset catalog | generated resources |
| app icons and launch/splash | the official logo | built for "Aglyn" and "Aglyn POS" | built for "Aglyn" and "Aglyn POS" |

The polish bar for every screen:

- platform-native navigation and controls, with SF Symbols on Apple and
  Material icons on Kotlin;
- skeleton loading, empty and error states;
- Dynamic Type and font scaling;
- accessibility labels;
- haptics where natural;
- split views and sidebars that use the space on tablets and desktops;
- keyboard shortcuts on Mac and desktop;
- Compose Desktop window chrome and menus that follow the same theme.

Each screen's screenshots are compared side by side with the matching console
screen.

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
comes from `ios` or `macos`; an FCM row comes from `android` and carries no
environment. Every row names its `app` (`aglyn`/`aglyn-pos`). RE2 caps a
repeat at 1000, so the rules check token lengths with `size()`. Rules tests
cover each transport. `mobile-push.ts` holds the same checks for the apps
and the server (`isApnsDeviceToken`, `isFcmRegistrationToken`,
`isMobilePushToken`), with `MobilePushTransport`, `ApnsEnvironment` and
`MOBILE_APP_BUNDLES`.

Server side, all of it server-only, in `libs/tenant/data/admin/src/lib/server/`:

- `mobile-push-switch.ts` holds the fan-out's hook point: `notifyUsers` hands
  every sender registered with `registerMobilePushSender` the recipients whose
  preferences say push, while `MOBILE_PUSH_ENABLED` is not `0`.
- `native-push.ts` has `registerNativePushSenders()`, which the console's and
  the tenant's `instrumentation.ts` call at boot. They call it through a
  relative `utils` file, inside the nodejs branch. It registers one sender,
  and that sender imports `push-delivery.ts` only when a notification has
  push recipients.
- `push-delivery.ts` reads each recipient's devices and prunes the rows the
  registry no longer accepts: Expo rows, rows with no transport, malformed
  tokens and unknown apps, and devices not seen for 60 days. It sends one
  token once, groups the rest by transport, and imports each transport only
  when a device needs it. It then prunes what the transport reports gone.
- `push-apns.ts` sends over HTTP/2 (`node:http2`) to
  `api.push.apple.com`, or to `api.sandbox.push.apple.com` for a sandbox row.
  It authenticates with an ES256 provider JWT, signed by `node:crypto` from
  `APNS_KEY_P8` (PEM, or base64 of the PEM or DER), `APNS_KEY_ID` and
  `APNS_TEAM_ID`, and reuses the JWT for up to 50 minutes (a `403` mints a
  new one). The topic is the row's bundle (`com.aglyn.app` /
  `com.aglyn.pos`). The payload is `aps.alert {title, body}` with
  `sound: default`, and the `MobilePushData` fields sit beside `aps`. A `410`
  (`Unregistered`), `BadDeviceToken` or `DeviceTokenNotForTopic` prunes the
  row. With no key, APNs devices are skipped and that is logged once.
- `push-fcm.ts` uses `firebase-admin` `getMessaging().sendEach` in batches of
  500. Each message carries `notification`, `data` (the `MobilePushData`)
  and Android `priority: high`, and is sent with the same project
  credentials the server already holds, so no new secret is needed.
  `registration-token-not-registered`, `invalid-registration-token` or
  `invalid-argument` prunes the row.
- The kill switch (`mobile-push-switch.ts`) and the per-type preferences apply
  to both transports alike. Apple and Google are the push subprocessors
  (AGL-3648). The `APNS_*` variables are in the self-hosting environment
  reference.

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

As built (`evaluateWebToNative` and `evaluateNativeToWeb`):

- A native file's relative path is resolved from its own folder. A path in
  an `.xcodeproj` or `.xcworkspace` resolves from the folder that holds the
  project, as Xcode does.
- A JSON `$schema` (Nx's `project.json`) is editor metadata and is not read.
- A symlink in a native tree must point into the native trees, as the
  manifest's `Plugins/` links do.
- Images and fonts are not read. Licenses and READMEs (`.txt`, `.md`) are
  prose, not build input, and are not read either.

With React Native gone, the guard's TypeScript rules for `libs/mobile` and
plugin `src/mobile` go with it. `mobile-pure-modules.json` stays: it is now
the list of pure modules the native generators (§5) may read.

Two SDKs are placed by the same guard: Stripe's card-entry SDK (PaymentSheet,
Android only now) and the Stripe Terminal SDK may be linked, imported or declared only by Aglyn
POS (`apps/ios/AglynPOS`, the AglynPOS Xcode target, `apps/android/pos`, and
the version catalog lines that pin them). A kit, a plugin (its Swift package,
its Gradle build or its sources), the plugin manifest, the Aglyn app target or
`:app` that names either is red (§10).

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
  same routes and idempotency keys as the web register. The tenders are cash,
  a card reader (smart reader or this device's), a gift card, store credit
  another plugin keeps (`credits` in the context, found by `credit-lookup`),
  a room charge to a checked-in stay (`reservations` asked for by status), and
  the QR payment page (`card-link`), drawn as a QR code on the device and never
  sent anywhere, and the typed card ("Enter card manually", the console's
  "Type card", `card-keyed`). A split pays
  part of the balance; a declined reader payment can be retried and, in test
  mode, tapped with a test card.
- **Typed card:** the console loads Stripe's Payment Element on the
  PaymentIntent the server made (`card-keyed`), then reads the payment back
  (`status`); closing it without paying runs `cancel`. Android does the same
  with Stripe's own card form (PaymentSheet, `com.stripe:paymentsheet`, used by
  `:pos` only) on that intent.
- **On Apple (iPhone, iPad and Mac) the typed card is Aglyn POS's own native
  card fields** (`CardFieldsSheet` in the commerce plugin, rules in
  `AglynHardware/CardFields.swift`), so it looks like every other form in the
  app and works on the Mac, where Stripe has no card SDK. The fields format the
  number as it is typed and name its brand, check Luhn, the expiry, the
  security code (4 digits for Amex) and the billing postal code, and show each
  error under its field. Pay sends the card in ONE request, from the device,
  to Stripe's PaymentMethods API (`POST /v1/payment_methods`, `type=card`)
  under the site's publishable key, exactly what Stripe's SDKs do; Stripe
  answers with a PaymentMethod id, and only that id goes to our server
  (`card-keyed` with `paymentMethodId`), which creates the intent, confirms it
  with the platform's secret key and records the payment from Stripe's answer.
  A decline keeps the fields open with the bank's words (the security code is
  asked for again, and the next card is a new attempt key); a card whose bank
  asks for 3-D Secure cannot be approved at the register, so the server
  releases that intent and the payment fails with words that point at Card
  (QR). The card is never logged, stored, cached or put in a URL (an
  ephemeral `URLSession`, no cookies, a form body), the fields are emptied
  when the form closes, and the form is covered whenever the app is not in
  front, so the app switcher's snapshot never shows it. **PCI:** because the
  number passes through our own fields on its way to Stripe, Aglyn POS on
  Apple is in scope for SAQ A-EP rather than SAQ A (Zach's decision,
  2026-10-16, to match Shopify's native manual entry).
- The button ("Enter card manually", the console's "Type card") shows
  whenever the register is online; the publishable key is the register
  context's, read again at the press when the register has none, and no key
  at all fails with words instead of hiding the tender. The Compose Desktop
  register (Windows) has no typed card yet.
- **The card SDK stays in Aglyn POS.** Android's PaymentSheet is pinned in the
  version catalog and used by `:pos` only; the shared kits and every plugin see
  only the `KeyedCardEntry` seam, and `check-mobile-isolation` fails if the
  Aglyn app, a kit, a plugin or a web tree names a Stripe card SDK. Tests for
  the tender run against a fake form.
- **The reader SDK stays in Aglyn POS too.** Stripe Terminal is linked the
  same way (the `StripeTerminal` product of `stripe-terminal-ios` on the
  AglynPOS target, filtered to iOS; `com.stripe:stripeterminal` in `:pos`),
  behind `CardCollector`, which Aglyn POS publishes as `DeviceCardReaders`
  at launch. The same guard holds it.
- **Tips** and **receipts by email or text**, through the routes the web
  register uses. **Print receipt** goes where the console's does: the
  register's cloud printer when it has one (the server queue the printer
  polls), else the device's own print sheet, which is what the console's
  `window.print()` is (AirPrint on an iPhone or iPad, the print panel on a Mac,
  Android's print service, the desktop's dialog). The console has no path that
  talks to a printer's own address, so neither do the apps; a Kotlin desktop
  register can also name a network printer in its build settings. A **gift
  receipt** prints on the sheet with no prices. A store whose receipt default
  is print prints as soon as the sale is paid.
- **Delivery-app orders:** the delivery-apps plugin's own native package puts
  the console's queue (accept or reject, ready, picked up) in the register's
  `posOrders` zone, which the commerce plugin hosts and fills by registry, never
  by name.
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

### As built (Apple)

- The register is the commerce plugin's Swift package
  (`libs/plugins/commerce/src/ios`, `AglynCommercePlugin`): `commerce.register`
  and `commerce.card-readers`, both `.pos`. The same package gives the Aglyn
  app its store, natively: orders (the orders page's `ORDER_LIST_QUERY` with
  status chips and search; the detail, with fulfill, deliver and cancel
  through `fulfill-order` and `cancel-order`), products (`PRODUCT_LIST_QUERY`;
  the detail), a barcode scan that finds a product (VisionKit's live scanner
  on iPhone and iPad, a typed or USB-scanned code everywhere), sales (today
  and the last seven days), Home's two sales cards and its quick actions.
- The collect sequence (retrieve, collect, confirm), the reader prompts and
  the error words are in `AglynHardware/DeviceReader.swift`, the twin of the
  Kotlin `DeviceReader.kt`, tested with a fake `TerminalPaymentPort`.
  `StripeTerminalCollector` (`apps/ios/AglynPOS`, iOS only) binds the SDK to
  it, and Aglyn POS publishes it as `DeviceCardReaders.shared` at launch; the
  commerce plugin's register, readers screen and kiosk, and a booking paid at
  the counter, see only `CardCollector` and `DeviceReaderControls` (the twin
  of the Kotlin interface). The Card readers screen (in the register's menu,
  the shell's store menu and POS Settings) finds readers by kind ("Set up Tap
  to Pay on iPhone", "Find Bluetooth readers"), lists what discovery finds,
  connects the one the cashier picks, and then shows its battery and software
  version, offers and installs reader updates with their progress, and
  disconnects (which also forgets it). Location is asked for only when the
  cashier connects a reader, with the words and an Open Settings button when
  it is refused; the SDK asks for Bluetooth as it scans. Opening the register
  only reconnects the reader connected last time, silently, when those
  permissions were already given. The kiosk's one-button setup still connects
  the first reader discovery finds. The SDK's simulated readers answer
  whenever the connection token says test mode (a Debug build's
  `-AglynSimulateReaderUpdate available|required` offers the simulated
  Bluetooth reader an update). The same screen pairs, renames, moves between
  registers and removes smart readers through `commerce/pos-readers`, as the
  console's POS devices card does. Card-present payments settle on the
  platform account, so the connection never sets `onBehalfOf`.
- The Stripe Terminal iOS SDK comes through SPM, pinned `exact: 6.0.0` in
  `Aglyn.xcodeproj`, and only the AglynPOS target links its `StripeTerminal`
  product, filtered to iOS, so the Mac builds never see it. The plugin
  package does not depend on it: both iOS apps link the one plugin manifest,
  so a plugin-level dependency put the framework, and its location and
  Bluetooth API references, in the Aglyn app too, and App Store Connect
  rejected that build for the missing purpose strings (ITMS-90683). The Aglyn
  app declares none and carries no reader; its booking screens say to take
  the payment in Aglyn POS. Aglyn POS declares
  `NSBluetoothAlwaysUsageDescription` and `NSLocationWhenInUseUsageDescription`.
  On Android the SDK (`com.stripe:stripeterminal`, `stripeterminal-taptopay`)
  is a dependency of `:pos` only, so `:app`'s runtime classpath and merged
  manifest carry neither it nor its location and Bluetooth permissions.
  Tap to Pay on a real iPhone also needs Apple's Tap to Pay entitlement (§12).

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
default. `tools/scripts/seed-native-emulator.mjs` seeds that stack: a member,
a workspace on the Pro plan and a site, then each area's rows from
`tools/scripts/seed-native/` (workspace, people, form submissions, inbox,
marketing, the store with its orders and bookings, the POS register with
its categories, modifiers and quick keys, promotions, returns and stays,
funnels, settled AI jobs, outreach sequences, a token-less sandbox accounting
connection with its sync log, and marketplace listings). The workspace
gets a logo and every site a favicon, real files from
`tools/scripts/seed-native/art/` stored the way the console stores them, so
the rail, the Sites list and the site switcher show pictures. The member
also gets a second workspace, Harbor Light Dental: white-label, on the Agency
plan, with a brand profile (product name, color and its own mark) stored the
way the console's white-label settings store it. It prints the
member's sign-in. There are no real
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
- `apple-app-site-association` and `assetlinks.json` on `aglyn.com` for passkeys, the
  `webcredentials:aglyn.com` Associated Domains entry, the Android certificate hash in
  `PASSKEY_ANDROID_APK_KEY_HASHES`, and `AGLYN_PASSKEY_RP_ID` / `passkeyRpId` in the builds
  (`docs/mobile/well-known/`).
- Google sign-in for "Connect Google" on Android and Windows: the Web OAuth client id, an Android OAuth client for
  `com.aglyn.app` and its signing certificate, and a Desktop OAuth client id and secret (Apple has both of its ids
  configured in `AGLYN_GOOGLE_*`).

## 13. Console screens as specs (AGL-3671, AGL-3667)

The workspace management areas (team, roles, workspace settings, billing,
your account, support, site admin) and the staff section are drawn from
**screen specs**: JSON that names what a screen loads from the console's own
API routes (or the Firestore documents the console itself reads), what it
shows, and which routes its actions call. Both platforms ship one renderer
each, in their shared kits: `AglynScreens` (SwiftUI) and `:native-screens`
(Compose). A spec is written once and both apps draw it, so a screen cannot
mean one thing on iPhone and another on Windows. The same template cases
(`libs/native/screens/template-cases.json`) are replayed by both platforms'
tests.

Core's specs live in `libs/native/screens/*.screens.json` and register as a
plugin named `core` ahead of the manifest's plugins (`CoreScreens`). A
plugin's specs live beside its native code, in
`libs/plugins/<p>/src/android/screens/`, linked into its Swift package's
resources, and its registrar calls `SpecScreens.register`; their ids are
declared under the plugin's `mobile.contributes` like any other screen
(the AI plugin is the first).

### Grammar

A file is `{ "screens": [ … ] }`. A screen:

| key | meaning |
| -- | -- |
| `id`, `title` | registry id (`core.*` or `<plugin>.*`); the title is a template |
| `label`, `subtitle` | the plain name the sidebar and app bar show, and a one-line description |
| `icon` | `"<SF Symbol>|<Material Symbol>"` |
| `scope` | `org`, `site` (needs a picked site), `account` or `staff` |
| `group`, `order` | where the shell lists it: `workspace`, `site`, `account`, `staff` |
| `requires` | a condition the session must meet (`org.manager`, `staff.is`, `staff.super`) |
| `links` | console paths (after `/{org}/hosts/{host}`) that open it; `:param` segments become params |
| `zones` | (plugins) the core screens' zones it contributes to: `orgMember`, `orgBillingUsage`, `siteTemplate` (Backup & restore: a plugin that can publish the site as a template), `transferStep` (the import wizard's review: a step a plugin adds for its resource), `staffOrg`, `staffUser`, `staffSite`, `staffPage` |
| `cardSlot` | (plugins) a core page's widget slot (`hostSettings`) the screen also puts a one-row card in, named `<screen id>.card` and declared under `widgets`; the card opens the screen with `pluginId` set, so a `requires` of `params.pluginId == <plugin>` holds from either door |
| `load` | `key: url` or `{ url, method, body, cursor, items, cursorParam, when, optional, accept }` (`accept`: statuses whose body is the answer, a health probe's 503; `filters`: `{ field, op, value }` clauses for a staff list route, each kept when its value template is not empty), or `{ doc }` / `{ query: { collection, where, orderBy, limit, aggregate }, more }` for a Firestore read (below: `aggregate: { count: true }` answers `{ count }`, the server's tally, as the console's `getCountFromServer` does), `late: true` on any load to run it after the others, with their answers under `data` (a read keyed by something another read found), `each: <rows>` to run it once per row of an earlier load, `{ compute, args }` for a pure function over what has loaded, or `{ switchboard: org \| site }` for the plugin switchboard's rows, or `{ entitlement: feature }` for a plan feature's gate, or `{ takeRate: marketplace }` for the take rate on the workspace's marketplace sales (`{ pct, paid }`, as `resolveMarketplaceFeePct` prices it, `paid` the paid plans' rate); each lands at `data.<key>` |
| `actions` | the screen's toolbar actions |
| `blocks` | `fields`, `meters`, `list`, `form`, `actions`, `links`, `notice`, `zone`, `image`, `html`; a `list` row may carry a `toggle: { value, disabled, label, on, off }` whose flip runs the `on` or `off` action |
| `constants` | fixed rows, read as `const` |

An action is `{ label, icon, method, url, body, headers, confirm, confirmWhen, destructive, prompt,
promptTitle, submitLabel, reason, success, instead, check, open, navigate, back, reload, when, link, copy, export,
overlay, reveal, else, then, write, route }`: `prompt` asks for inputs first (`form.*`), in a dialog titled
`promptTitle` with a `submitLabel` button where the label alone would say neither (a row's `Edit` opens
"Edit category" with Save, as the console's dialog does); `reason: true`
adds the required reason the staff routes record; `open` names the response
field holding a URL that opens in the platform's secure browser sheet
(Stripe Checkout and the Customer Portal, `ASWebAuthenticationSession` and
Custom Tabs); `route` is a console path a route answered (a hold's `href`,
`/acme/billing/settings`) followed the way a notification's link is, by the
plugin context's `openLink`: the native screen that claims it, else a Besigner
page, else a note that the page does not open in the app; `else` runs on a 404 (add a member, else invite them); `then`
follows a success; `write` merges a document the person writes directly, as
the console does (their own profile, the site document), under the rules.
`confirm` is a template, or a list of `{ when, text }` segments joined in order
so one sentence can follow the route's answer; `check` is a route call made
first (the add-on price preview), whose answer is `preview` in the
confirmation; `instead` is `{ when, title, text, open }` (or a list, the first
that matches wins) shown in place of `success` when the route's answer meets
`when`: the docs a question deflects to, a bank asking to confirm a payment
(`open` then names the response field holding the invoice page to open).
A route that answers `reauth-required` gets a password sheet, a fresh sign-in
and one retry.

`overlay` names a Firestore document (a template) that is read when the action runs and put in the body as `overlay`, without
its timestamps, for a route that replaces the whole document: `{"$overlay": {"base": "{overlay}", "set": {...}}}` is the base
with each key of `set` put on top and any whose value is null taken off (a product's details are saved this way).

`export` is `{ resource, title, fileStem, scope, filter }`: it makes no request of its own but opens the export
sheet (`TransferExportSheet`, `TransferExportDialog`) on a transfer resource such as `commerce.products`, which asks for
the columns and the file type and hands the file to the device. `scope` is `{ "kind": "all" }` unless it names a
filter; `title`, `fileStem` and `filter` are templates. The site's roles and plan are the server's to enforce.
`report` is a list of lines (`{ text, when, each }`, or a plain string) appended to `success`, one per
line (a `when` on an `each` line is read for each row, with `item` that row); `file` (`{ name, type, from }`) hands text to the device as a file, its name a template and `from` the path of the
text over the screen and the route's `response` (Save, or the share sheet: the working papers' CSV); `failure` is the same list for a refusal, appended to the route's own words and read over the route's
answer as `response` (the workspaces that still need an owner); `each` repeats a line for every row or map entry as `item`. `loop` (`{ cursor, param, until, max }`)
sends a route that works in pages again, with the cursor it answered, until it says it is done, and
answers the totals: numbers add up (a map of counts too), `pages` counts the requests and `bounded` says
the last page was not reached. Formats `facts` (an object's plain values as `words: value`) and `duration`
(milliseconds as "12 min", "3h 5m") read the health probes and the stuck claims.

`headers` names request headers, each a template. `{attempt}` there is one key per
(action, route, resolved body): sending the same request again, a retry or a second tap,
reuses it, and a changed body gets a new one. A route that provisions something
(enterprise billing) takes it as `Idempotency-Key`, and a write that carries one is retried
like a read. `{press}` is a key for one press alone: its retries share it, and the next tap gets
its own, for a route that must see two deliberate, identical changes (a rewards adjustment) as two.
A route that wants the key in its body (the AI credit give-back's `idempotencyKey`)
writes `{attempt}` there; the key is found with `{attempt}` and `{press}` blank, so carrying it does not
change the request it identifies.

A screen keeps a little state while it is open, read as `session`: `session.log` is what the person has done on it,
newest first (`{ at, text, confirmed }`, at most 25), and `session.armed.<key>` is a flag. An action's `log` is a list of
lines like `report`'s (`{ text, when, each, confirmed }`, `confirmed` a condition that defaults to true) appended when it
succeeds, the lines of one act with the last listed on top: the console's "Actions taken in this session", which the
lockdown and quarantine routes feed with `logLines`. `arm: "<key>"` sets `session.armed.<key>` when the action succeeds
and clears it when it fails, and `disarm: "<key>"` clears it when it succeeds: a preview that has been read, which a
guarded run waits for through its `when`. A block `{ "type": "html", "source": "{…}" }` draws a message's HTML as styled
text through the platform's own HTML reader (`NSAttributedString` on Apple, `AnnotatedString.fromHtml` on Android, the
JDK's HTML parser on desktop) after taking out scripts, styles, frames, forms, images (their alternative text stays) and
every attribute but a link's address; a link opens only when it is http, https, mailto or tel, in the system handler. The
shared cases both apps replay are `libs/native/screens/email-html-cases.json`, generated from the console's renderer
(`generate:native-email-html-cases`). A prompt field of kind `country` is a picker over the platform's region list,
named in the person's language and sorted by name, storing the two-letter code.

A `list` block's `columns` are the facts a row can show and the orders it can take, as the console's grid has a column
picker and sortable headers: `{ id, label, value, show, always, sort: { route | page, type, first } }`. `value` is the cell's
template over the row; the picked columns read as one line under the row (`Plan Pro · Site limit 5`), and a `Columns` menu on
the list turns each on and off (`show: false` starts it off; `always` is the row's own name, shown and not offered). A `Sort` menu
lists every column with a `sort`: a tap asks for its first order (`first`, `asc` unless `desc`), a second tap for the other, a third
for the default again, as a header click cycles. A `route` sort is the staff route's own order over every row (`sort=<path>:<dir>`;
the list's load names the parameter with `sortParam` and the order it answers with none asked as `sortDefault`), so choosing it reads
the route again from the first page; a `page` sort orders the rows already loaded by a path over the row, as the console does for the
columns no query can order by (`type` is `text`, `number` or `date`; a row without the value goes last in both directions). A list with
`columnsZone: "<zone>"` also takes the columns plugins contribute: a plugin spec with `zones: ["<zone>"]` and a `column` of the same
shape plus `load: { url, ids, max }` (`{ids}` in the url is the ids of the rows on the screen, `ids` the template for each, `max` the
most a request may name) is read for the rows on the screen in batches and answers under `column.<id>`, which its `value` and `sort`
read. A column that cannot be read leaves its cells blank.

A staff support session is an action with `impersonate: { token, tenantId }`: the paths in the route's answer of the custom token it
minted and the identity pool it belongs to (`/api/admin/impersonate`, which takes `{ uid, reason }` and refuses a reason under its
minimum). The token goes to the app's auth session and is shown, logged and kept nowhere. The session signs the customer in over
REST in that pool, in memory only, and the staff member's own session is set aside untouched: Apple uses a second
`IdentityToolkitAuth` with a memory credential store and a Firestore reader that switches to the customer's, desktop does the same
through `SupportSessions` with a REST backend, and Android signs in on a second Firebase app named `support` (a flag in
SharedPreferences signs out anything left over at launch). While it lasts the shell wears the console's band (`You are
impersonating {email} (staff: {staff email}). Actions are audited.`) with **Exit impersonation**, navigation starts again from home
on entering and leaving, device push registration is skipped for the customer, a refresh the server refuses (the session was
revoked) ends it and returns to the staff member's, and signing out ends it first. A second session replaces the first without
losing the staff member's.

A prompt field of kind `lookup` searches records and fills the form: `groups` is a list of `{ id, label, url, items, title,
subtitle, fill, fillWhenSet }`. Opening it lists the first rows of every group and typing asks each group's `url` again with
`search=<words>`. Picking a row writes `fill` (a map of form field keys to templates over `item`) into the fields the form has,
whatever they come out as, and `fillWhenSet` only when a template comes out non-blank (a person's address, as the recipient). The
system email test's "Populate from" uses it; its fills are generated from the console's `system-email-sample-sources.ts`.

Templates are `{path|fallback|'literal':format}` over the context `org`,
`site`, `user`, `staff`, `params`, `data`, `item`, `parent`, `form`,
`response` and `const`. A path takes `rows[field=other.path]` (the first row
whose field matches) and `map[key.with.dots]`. `now` has `year`, `month`, `prevMonth`, `day`, `quarter`, `ms`, `localDayMs` (today on the device's calendar as the UTC midnight a stay's nights are stored in, the console's `localTodayDayMs`) and `months` (the last twelve, newest first). A list row's `primary`, `secondary` or `tertiary` may be a list of parts instead of one template (each a template, or `{ text, when }` shown while its condition holds), joined with ` · ` and an empty part left out, so a row never ends on a dangling `set by `. A row badge with `each: "<list path>"` is one chip for every row of that list, read as `row` (`{row.label} · {row.unitsLeft} of {row.units} left`, `tone: "{row.tone}"`); a row's chips wrap onto the next line. A list block's `flatten: "a.b"` walks down into the lists inside its rows (each row found carries `$parent`, the row it came out of). A prompt field with `each: "<list path>"` is one field for every row of that list (key, label, help and initial are templates over `item`, so an email's test asks for each variable it takes, and `{"$collect": {"prefix": "token."}}` gathers what was typed). A prompt field with `generate: { length, alphabet }` offers a Generate button that fills it from the
platform's secure generator (the console's password generator). Formats: `pairs` (a map's entries as
`key: value`, the keys untouched, where `facts` splits them into words), `labeled/<path>` (each id through the map at
`<path>`), `before/-` and `after/-` (either side of the first separator), `date`, `datetime`,
`cents` (`cents/<currency path>`), `dollars`, `bytes`, `number`, `percent`,
`count`, `yesno`, `title`, `upper`, `json`. A `when` is clauses joined by
`&&` or `||`: `path`, `!path`, `path == a,b`, `path != a`. A body is resolved
in place; `{"$if": "<when>", "then": X, "else": Y}` is one of two values (or nothing, which leaves the member out; `"$null"` sends null) and
`{"$afterHours": "{form.hours}"}` is that many hours from `now.ms` in epoch milliseconds (nothing when blank); `{"$pick": {...}}` makes the list of keys whose values are truthy,
and `{"$append"|"$without": {list, item}}` edits a list.

Three small forms serve the cards that list data they cannot shape: a path
`rows.*.field` reads that field of every row as a list (so `{item.issues.*.message}`
prints them joined); a select's `optionsFrom` takes `filter`, a condition on the
row (`item.classification == bank`); and a comparison's right side may be another
path (`a != @b.c`). A load names the query parameter its route searches by with
`searchParam` (the catalog route reads `q`, the default is `search`).

A field of kind `hours` is a week of opening hours chosen by touch, as the console's weekly hours picker is: a switch
for each day and, for an open day, a From and a To time from a menu, with another interval on request. It reads and
writes the stored text lines (`Mo-Fr 09:00-17:00`), so nobody types them; its `hours` option is `{ noun, sameDay, start,
end }` (what an interval is called, whether it must end the day it starts, and the times a newly opened day gets, in minutes).
The picker and the conversion are the contracts' and the plugin host's (`WeeklyHours` in AglynContracts, `OpeningHoursPicker` in
AglynPluginHost and the UI kit), one model and one picker for every screen that picks hours; the contracts' generated function
cases hold the conversions to the console's own.

A form or prompt can list fields from the data: an entry
`{ "fieldsFrom": { items, key, label, help, required, options, kinds } }` becomes one
field per row (a carrier that names its own credential fields), `kinds` mapping a
row flag to a kind (`password`, or `yesno` for a No/Yes pick that sends "" or
"true"). Body operations grow `{"$replace": {list, key, match, value}}` (the row
whose key matches, replaced) and `{"$uuid": "box_"}` (a fresh id with that prefix), and
`{form}` reads the whole form as an object. `{"$map": {list, where, fields}}` is one object of `fields` for each row of the
list that meets `where` (all of them with none), each read with `item` set to the row: the items a batch purchase sends, from
the rows a rate request answered.

A condition may compare numbers and times: `path < @now.ms+7d` (also `<=`, `>`, `>=`), the
right side a number or `@path` with an optional offset in ms, s, m, h or d; a missing
left side is false. An action's `else` runs on the status named by `elseStatus` (404
unless set, 409 for "this needs one more answer"), and an action's `then` that has a
`prompt` is asked of the person next, with the earlier answer as `response` and the
earlier form as `previous` (print on demand lists the stores a token reaches, then
connects the one picked).

Cards that write the store's own documents, as the console's client does, use the rest of
the grammar. A `write` is `{ doc, fields }` (merge a document), `{ add, fields }` (a new
document in a collection, with an id of its own), `{ delete }`, `{ steps: [...] }` (several
in order) or `{ each: { items, filter }, doc, fields }` (one per row of the data that passes
the filter, with `item` set to the row); `siteWide: true` also drops the site's cached
pages, as the console's `writeSiteWideChange` does. `{ stay: { resource, checkIn, checkOut, guestName, route } }` is the front desk's walk-in: it prices the
stay and checks the dates against the resource's live reservations and blocks, counting units on a resource with several
(ports of the console's reservation functions, replayed from `stays-cases.json`), for the instant answer; then `route` (the
console's `/api/commerce/reservations/walk-in`) books the confirmed reservation inside a transaction, with a `reservationId`
minted for the attempt and sent again by its retry, or says in words why it cannot. A field value is resolved like a
body, and these operations shape it: `{"$timestamp": true}` (the server's time),
`{"$orNull": v}` (null when empty, which a merge write turns into a cleared field; a
template that found nothing is otherwise left out), `{"$cents": "{form.amount}"}` (typed
dollars as whole cents, and `-5.50` as -550 where a change may take money away), `{"$dateMs": {value, time, local}}` (a date and a time of day as
epoch milliseconds, UTC unless `local` asks for the device's clock), `{"$slug": v}`,
`{"$split": v}` (lines or commas to a list) and `{"$gather": {from, prefix, key, value}}`
(the entries of `{form}` whose names start with `prefix`, as `{ key, value }` rows).

More formats: `amount` (whole cents as `12.50`, what a money field starts with), `code`
(a coupon code as stored; `code/40` cuts it at 40), `token` (the search token of typed
words), `sum` and `sumcents` (a list of numbers added up), `ahead` (how many of a list of
times are still to come), `percentof/other.path` (this as a percentage of the number at the path, to one decimal, `0` where
there is nothing to divide by). `{?a == b}` is a condition as true or false, and `a ?? b` takes the
first value that is present at all (`false` and `0` count). A path `rows.*.field` also
reads an object's values in key order, and a comparison against a list holds when any of
its values does (`item.holds.*.expiresAtMs > @now.ms`). `rows[?item.rate && !item.own]` keeps the rows its condition holds for
(`item` is the row), so a count, a sum or a list can be taken over just those. A screen that sits in a zone may name a `showWhen`
condition over its own loads: the zone reads those loads and lists the row only while it holds, as a console widget that draws
nothing for a store it has nothing to say to. A number field takes `min` and
`max`, and a field a screen hid by its `when` is not sent.

A Firestore `query` load takes the console's filters, `where: [[field, op, value]]` with
`op` any of `==`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `not-in`, `array-contains` and
`array-contains-any`, a number or flag in the spec compared as itself. A list block that names its query load (`"load": "key"`) offers "Load more" whenever the window came
back full: a query has no cursor to continue from, so it reads a bigger window (the load's `more: <rows>`, else the spec's
`limit` again) and replaces its rows, until a read comes back short, and a reload after an action keeps the window the person
grew. A fourth `where` entry is a condition: the clause counts only while it holds (a filter the person has not picked, or a value
that is empty, is left off).
With
`aggregate: { count: true, sum: "field" }` the server counts and adds every matching document
and no row is read: the answer is `data.<key>.count` and `.sum`, left out where the reader
cannot ask (show "Unavailable", never a zero). `{ "entitlement": "giftCards" }` reads the
workspace document and answers `data.<key>.carried` and `.label`, the plan that includes the
feature, so a card the console locks behind a plan shows its notice instead of failing
(the features are the generated `NATIVE_PLAN_FEATURES`). A load that is not read from anywhere but worked out from the others once they answer is
`{ "derive": "shippingCoverage", "from": "store.shipping" }`: the `from` path (under `data`) finds the shipping settings, and
`data.<key>` holds what the console's Coverage block says of them (`served`, `unserved`, `headline`, `detail`, `note`, `asks`, …), a port
of the console's resolver replayed from the contracts' `function-cases.generated.json` (`summarizeShippingCoverage`,
`describeShippingCoverage`, `resolveCheckoutShippingOptions`). `{ "derive": "unitsAhead", "args": ["resources", "current"] }` is the
Reservations card's look-ahead: for each resource with several units, its next 14 nights (`{ dayMs, label, unitsLeft, units, tone }`,
keyed by resource id) from the resources load and the current stays load, as `unitsLeftByNight` counts them.

The context also carries `now` (UTC): `now.month` (`2026-10`), `now.prevMonth`,
`now.day` (`2026-10-13`) and `now.year`, the keys the console's monthly
counters and daily documents are named by, so `data.counter[@now.month]` reads
this month's figure. A path `rows.*.field` is that field of every row, as a
list. `{a + b - c}` sums numbers (paths, literals, or a list, which adds up);
a term that is missing makes the sum missing, and `x?` counts as zero where it
is missing. `a ?? 'text'` keeps a real 0 or false.

A Firestore `query` load's `where` value may also be `{"$date": ISO}` (a timestamp), and
`aggregate: { count: true, rows: 1000 }` counts on the server as above and, where the reader
cannot count, reads the rows up to that ceiling and counts them (the usage meters).
A load with `each: "data.sites.sites"` runs once per row of an earlier load,
with the row as `item`, and its key holds the list of answers (a failed one is
null); at most 50 rows.

Files and multi-step flows (the Imports and exports hub is the largest user):

- `download: "name"` makes an action's route answer a file (an export) that the
  person saves or shares, named by the route's `Content-Disposition` or else by
  `name`. `downloadAt: "package"` is for a route that answers JSON: the file is
  the value at that path of the answer, indented, and `download` is then a
  template over `response` that names it (a workspace package's export answers
  `{ fileName, package }`).
- A `file` field reads the chosen file; `parse: "json"` sends it parsed, and `parse: "base64"` sends its bytes base64-encoded (a plugin bundle). A static option may carry a `detail`, which a `multiselect` shows under the choice's label (a publisher's attestation).
  `multiselect` holds a list of ids; `coversAll: true` leaves it unfinished
  until every choice is chosen (the warnings an import must have acknowledged).
- `stash: { key: template }` on an action keeps values as `stash.<key>` for the
  screens that follow (a package read once, the plan made from it, the choices
  made so far) until the app closes. `{"$put": {map, key, value}}` in a body or a
  stash sets one entry of a map and removes it when the value is empty.
- `optionsFrom` and a list's `items` can take `within: "items"`: one entry per row
  of each row's inner list, the outer row as `parent` (`{parent.label}: {item.name}`).
  `a.*.b.*.c` flattens lists it meets, so `resources.*.items.*.key` is every
  resource's item keys. `path ~= @other.path` asks whether a list holds, or a text
  contains, what the other path reads.
- `export: { resource, title, hostId, fileStem, scope, filter }` opens the platform's export sheet for a
  transfer resource (`hostId` the site a site's resource is read for, none for the workspace's; `scope`
  `{ kind: all }` unless it names a filter; `fileStem` the resource key unless given), the sheet every list uses (the Imports and exports hub's lists open it per
  resource). It is the console's export dialog: a preset (Everything, Re-importable, Minimal,
  the resource's own, the ones the person saved, or a hand-picked list), the fields searched,
  grouped, picked and put in order (the catalog, search, presets and reorder are ports of
  `field-catalog.ts`, replayed from `libs/native/contracts/transfer-catalog-cases.json`),
  which records (the list's selection or filter, or all), the format the resource takes and
  a byte-order mark for a CSV, then the file saved or shared. The last choice and the saved
  presets are kept in the person's own `users/{uid}/transferPrefs/{resource}`, where the
  console keeps them, and a resource preset for another product writes that product's
  column names.
- A path can chain bracket groups (`stash.choices[@field][@value]`), take a quoted literal in a
  selector (`rows[id='crm']`), and read an `@path` after `*` against the whole context
  (`samples.*.[@index]` is one column of every sample row).
- `libs/native/screens/transfer-resources.screens.json` is generated from the plugins'
  `transferResources` (`generate-native-contracts.mjs`): the hub lists every resource whose
  plugin runs (the `switchboard` load) and whose plan feature the entitlements carry.
- A field of `kind: "upload"` is the import's Upload step (`maxBytes`, `maxRows` and `formats`
  are templates over the loaded resource): a chosen file or pasted rows, read on the device to
  show how they read, with the format, the encoding (a file's bytes can be read again under
  another), the separator and whether the first row names the columns guessed and changeable,
  the first five rows, and the file refused before anything is sent when it is larger, or
  longer, than the import takes. The reading is a port of `transfer-file.ts`, replayed from
  `libs/native/contracts/transfer-file-cases.json`. Its value is `{ fileName, text, bytes,
  format, delimiter?, headerRow? }` (`form.<key>.text`, ...), empty until nothing blocks it.
- `chunk: { field, bytes, idFrom, idKey, firstOnly, until }` sends the file text in `field` of
  the body in parts that each fit `bytes` once JSON-encoded (never cutting a character), each
  with `part` and `parts`, the job the first answer names (`idFrom`) sent back as `idKey`, the
  keys in `firstOnly` on the first part alone, and `until` the answer path that must be true when
  the last part has landed. A chosen file is read as UTF-8 (a byte-order mark dropped), UTF-16
  where it carries its mark, else Windows-1252, and its name is `form.<key>Name`.
- `repeat: { until, max, stop, stopMessage }` runs the action again until the answer meets
  `until` (a condition over `response`), as the console calls apply until the route is done; the
  stash takes every pass, so a screen shows the progress, and `stop` ends it as a failure with
  the route's words. `after` is a follow-up that must succeed, run with the stash just made;
  `reload: true` reloads a screen after an action with no route of its own.
- In a body, `"name?": …` is sent only when it holds something (not null, `""`, `[]` or `{}`),
  `{"$index": {rows, key, value}}` makes a map of rows, and `{"$merge": [a, b]}` lays maps over
  one another deeply. A row's position is `index`; `*` also walks an object's values; the format
  `first3` keeps a list's first three entries; a condition may mix `&&` and `||` (`&&` binds
  tighter). `$index` takes a `filter` too, run with the outer row (the item a button was pressed
  on) as `parent`; `head` and `tail` are the two halves of a `kind/id` key, and `instance` is what follows the colon of a resource key (`email.list-members:abc` is the list `abc`).
- A plugin's own step in the records import (the console's `registerPluginTransferResourceUi`
  `extraSteps`): the review draws a `transferStep` zone with the resource, site and job as params,
  and a plugin contributes a screen to it, shown only for its resource by `requires` (`stash.importResource ==
  commerce.gift-cards`). The rules step keeps the plan body it sent as `stash.importPlanBody`; a step answers by asking
  the same plan again with its answer added, `{"$merge": ["{stash.importPlanBody}", {"extras": {"$put": …}}]}`, and keeps
  the answers as `stash.importExtras` (the plan's `extras`, by step id), so the steps after it add to them. Today the
  gift card import's Confirm step (commerce) and the email list's two steps (email) use it.
- A contributed screen may carry a `hook: { when, load, action }`, and an action may name `afterZone: { zone, stash }`:
  once that action has succeeded (the import's apply), the hook of every screen contributed to `zone` whose `requires`
  and `when` hold is run, in order: its `load` is read into `data`, then its `action` runs over it (its `when` is checked
  once the data is there). A hook never fails the action; what each says is kept as `stash.<stash>` for the screen that
  follows (the import's done screen shows it). The AI plugin's After import step for a products import uses it: the
  step stores the choice for this import, and the hook reads the created ids from the import's results, works the
  job out with `aiProductsImportJob` (the console's `aiProductsBulkBrief` and bulk inputs), and starts it on
  `/api/ai/jobs`, which is where the credits are reserved, as the console's products hub starts it.
- `ssoEnforcementAccounts(accounts, providerId, designated)` is a `compute` function over a single sign-on rehearsal
  (the console's `ssoEnforcementAccounts`, `sso-enforcement.ts`): one row per account with the address, what enforcing
  would remove, what it keeps, whether it can be break-glass and whether it is. The enforcement screen keeps the
  rehearsal in `stash.ssoPreview` and draws the rows, the lockout alerts and the break-glass choice from it.
- A field of `kind: "media"` is a file chosen from the workspace's media library, never typed (the console's
  `MediaUrlField` for a logo or a favicon): the Setup pickers' `MediaPickField` over the workspace's library alone
  (`workspaceOnly`), whichever site is picked. Its value is what the console stores, the file's `cdnPath` else its address.
- `timeZoneChoices` is a `compute` function with nothing to ask: the time zone picker's rows, `[{ value, label }]`, the
  default (an empty value, which the route stores as no zone) first and then the console's list with its underscores read
  as spaces. The list is `TIME_ZONE_CHOICES` (`time-zone-choices.ts`), a snapshot of `Intl.supportedValuesOf('timeZone')`
  that the console's route accepts every name of; a `select` over it is `optionsFrom` the load, a site's adds its own first
  row (`options`) and filters the default one out (`filter: "item.value"`).
- A screen may name `start: { "action": id }`: once its data has loaded it runs that one of its own `actions` as if it had
  been chosen, when the action's `when` holds. A link's query (`?notice=<id>`) reaches the screen as `params.notice`, so
  the holds screen opens that notice's review request, as the console's holds card does.
- A `zone` block may carry `params`; a plugin's slot widget (`r.widget(…, slot: …)`) reads them (`aglynSlotParams` on
  Apple, `LocalSlotParams` on Android), as the console's `PluginWidgetSlot` hands its widget props. The workspace's
  Plugins pages use two: `orgPluginInstalls`, and `pluginInstallation` with the plugin's id, both filled by the
  Marketplace: the plugins installed from it (every site's pins, a chip where a newer version is on offer), and one
  plugin's page (current or behind, where it runs, update, add, split, promote and remove with the uninstall impact
  check, its settings from its manifest, and what it may do). The rules are `marketplace-catalog.ts`'s, replayed from
  the cases; a marketplace plugin's settings screen is built at run time by `manifestSettingsScreen`, the very screen the
  generator makes for a built-in plugin's schema (`native-plugin-settings.test.mjs` holds them equal).
- A field with `mustMatch` is unfinished until the typed text equals it; `mustMatchAs: "dollars"` reads both sides as a
  dollar amount instead (`60`, `$60.00`, `1,250 USD` all mean 6000 cents, as the gift card Confirm step reads a typed
  total), and `mismatch` is what is said under the field while something typed does not match. A number field is unfinished while it holds text that is not a number or a number outside its `min`/`max`, and its `mismatch` is said then too (`A whole number from 1 to 500`).
- `gate: { when, screen }` on an action: when the route refuses with a body that meets `when` (read as `error`), `screen`
  opens over this one, and when an action there that carries `resume: true` finishes, the very same action is sent again,
  once. The Marketplace publish uses it for the Publisher Agreement: the route's structured `agreement` refusal opens the
  agreement, and accepting sends the publish, as the console's gate does.
- A list with `page: N` shows N rows and a Show more row for the next N (a list the screen already holds whole, such as
  a diff). `packageItemChanges` takes a fourth argument, the most record rows to hold, so the records of a dataset are
  all there to page through.
- `after` chains: an action's `after` may carry an `after` of its own, each step reading the stash
  the one before made (the site package import works its decisions out, then who is still waiting,
  so every change to a default or a choice shares the two steps).
- `{ "compute": "name", "args": ["data.a.b", "data.c"] }` is a load that calls a pure function of the
  console, over paths of what has loaded (a number is passed as one). The functions are ports
  replayed from `function-cases.generated.json`, in `ScreenFunctions` (Swift and Kotlin): the site
  package import's `packageJsonDiff` (every value an imported item changes) and `packageMergeKeys`
  (the keys a merge chooses between).
- Arithmetic in a template is a sum (`a + b - c`) or, with products and brackets, the usual
  precedence: `{max(0, used - included) / 1000 * rate:usd}`. A path is a number (a list adds up),
  `x?` is zero where it is missing, the functions are `max`, `min`, `round`, `floor`, `ceil` and
  `abs`, and anything missing (or a division by zero) leaves the whole figure blank. A condition
  may compare two such expressions, and two months or dates as text (`2026-09 <= now.month`).
  The format `usd` reads a charge (`<$0.01` under a cent).
- `derive: [{ name, when }]` on a screen works conditions out once over the loaded data as
  `is.<name>` (a later entry may read an earlier one), where a block's own `when` would need
  brackets.
- A POST load pages too: `cursor` names the response field, and the next page is
  the same body with the cursor under `cursorParam` (a number cursor, such as a
  job's `createdAt`, goes back as a number).

`passkey: { options, verify, origin, errors, otherwise }` on an action (a platform action beside `account` and `write`) sets up a passkey on this device, as
the console's `registerPasskey` does: `options` answers a WebAuthn challenge, the platform makes the credential
(`ASAuthorizationPlatformPublicKeyCredentialProvider` on Apple, the Credential Manager on Android, both behind
`PasskeyCreator`), and `verify` stores it. The routes derive the relying party from the request's `Origin`, so the options
call sends `origin` (`https://{app.passkeyRp}`) and the verify call the origin the platform signed into the credential's
client data (`https://aglyn.com` on Apple, `android:apk-key-hash:...` on Android, which the server accepts only for the
hashes it lists). `errors` maps a route's reason to words, `otherwise` words any other failure, and closing the
system prompt is not a failure. The action shows where `user.canAddPasskey` holds: the build has a relying party
(`app.passkeyRp`), the device a creator, the account no company login and a verified email.

The sign-in page offers the same passkeys, so the shell's sign-in screen does too (a "Sign in with a passkey" button where the
build has a relying party and the device an asserter): `PasskeySignIn` (Apple, `AglynScreens`) and `PasskeySignIn` (Kotlin,
`:native-screens`) ask `/api/auth/passkeys/signin/options` with no session and the relying party's own `Origin`, have the
platform sign the challenge with a discoverable passkey (`PasskeyAsserter`: `ASAuthorizationPlatformPublicKeyCredentialProvider`
on Apple, the Credential Manager on Android), send the assertion to `/api/auth/passkeys/signin/verify` with the origin the
platform signed into the credential, and sign in with the Firebase custom token it answers (`AuthSession.signIn(customToken:)`,
`signInWithCustomToken`). A route's reason becomes the console's sentence; closing the system prompt says no passkey was used.

### The plugin switchboard

`{ "switchboard": "org" }` reads `orgs/{org}` and `{ "switchboard": "site" }`
also reads `hosts/{site}`, as the console's switchboards do, and resolves them
with the enabled-plugins resolvers ported to `AglynContracts` and
`com.aglyn.contracts` (`PluginSwitchboard`), which replay the console's answers
from `function-cases.generated.json` over the generated `FIRST_PARTY_PLUGINS`
catalog. Each row carries what it shows (`on`, `locked`, the site `state`,
the `cascade` a switch-off strands) and exactly what its switch writes: the
whole workspace list for `/api/orgs/settings` `set-enabled-plugins`
(`enable`, `disable`), or the site's `disabledPlugins` and `enabledPlugins`
(`turnOn`, `turnOff`) merged into the host document under the rules.

### Rules the specs keep

- **No privileged path.** Every load and action names a console route or a
  document the console itself reads or writes with the client SDK; the route
  or rule decides, as for the console.
- **Staff only on a staff token.** The staff group shows only when the ID
  token carries `staff: true`; `staff.super` gates the super-only triggers.
  `/api/admin/*` re-checks both.
- **No purchases in the app.** Plans, payment methods and invoices open on
  Stripe's hosted pages; the app shows the plan and usage, never a price it
  sets.
- `libs/native/screens/fixtures.json` holds route answers in the console's
  shapes for the snapshot renderers; nothing reads it at run time.
