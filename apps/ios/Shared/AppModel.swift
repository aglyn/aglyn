// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynPluginManifest
import AglynScreens
import AglynSite
import Foundation
import Observation

/// Everything one app process shares across its windows: the config, the
/// signed-in person, the picked workspace and site, and the plugin registry.
@MainActor
@Observable
final class AppModel {
  let app: AglynAppKind
  let config: AglynConfig?
  /// Why the app cannot start (a build misconfiguration), in words for the screen.
  let configProblems: [String]
  let auth: AuthSession?
  let reader: FirestoreReader?
  let api: ConsoleAPIClient?
  let registry = NativePluginRegistry()
  let push: PushCenter
  private(set) var pluginFailures: [NativePluginLoadFailure] = []
  private(set) var workspace: WorkspaceStore?
  /// The signed-in token's claims: the staff section shows only when they say staff.
  private(set) var claims = TokenClaims()
  /// Bumped by Refresh (⌘R); live lists re-subscribe on it.
  private(set) var refreshToken = 0
  /// The screen this tablet was set up as instead of a register (a customer display or a self-service
  /// kiosk), remembered across launches so it comes back with nobody signed in. The POS app only.
  private(set) var deviceModeID: String?

  static let deviceModeKey = "aglyn.pos.deviceMode"

  init(app: AglynAppKind) {
    self.app = app
    deviceModeID = app == .pos ? UserDefaults.standard.string(forKey: Self.deviceModeKey) : nil
    let appID: AglynAppID = app == .pos ? .pos : .aglyn
    let push = PushCenter(app: appID)
    self.push = push
    PushAppDelegate.push = push
    var config: AglynConfig?
    var problems: [String] = []
    do {
      config = try AglynConfig.fromBundle(.main, app: appID)
      problems = config?.problems ?? []
    } catch {
      problems = [error.localizedDescription]
    }
    self.configProblems = problems
    if let config, problems.isEmpty {
      self.config = config
      AglynFirebase.configure(config)
      let auth = AuthSession.make(config)
      self.auth = auth
      // A REST sign-in has no SDK user for Firestore to read as, so Firestore goes over REST too.
      self.reader =
        auth.transport == .rest
        ? RestFirestoreReader(
          projectID: config.firebase.projectID, emulatorHost: config.firestoreEmulatorHost,
          idToken: { try await auth.idToken(forceRefresh: false) })
        : FirebaseFirestoreReader()
      self.api = ConsoleAPIClient(origin: config.consoleOrigin) { force in
        try await auth.idToken(forceRefresh: force)
      }
      auth.onBeforeSignOut { await push.signingOut() }
    } else {
      self.config = nil
      self.auth = nil
      self.reader = nil
      self.api = nil
    }
    let result = NativePluginLoader.load([CoreScreens.manifestEntry] + Self.platformEntries + NativePluginManifest.entries, into: registry)
    pluginFailures = result.failed
    for failure in result.failed {
      print("Aglyn: plugin \(failure.pluginID) did not load: \(failure.error)")
    }
  }

  /// The platform's own content screens (sites, pages, media…), which are
  /// core rather than a plugin's: loaded before the generated plugin
  /// manifest, through the same registrar and declaration check.
  static var platformEntries: [NativePluginManifestEntry] { NativePlatformEntries.entries }

  var brandName: String { config?.brandName ?? AglynConfig.defaultBrandName }

  /// This app's own name, as a person sees it: "Aglyn", or "Aglyn POS" (with
  /// the space) for the register. The brand alone names the company and its
  /// console; this names the app (sign out of it, update it, its notifications).
  var appName: String { app == .pos ? "\(brandName) POS" : brandName }

  /// Follows the signed-in person: a new workspace store per person, none signed out.
  func userChanged(_ user: AglynUser?) {
    guard user?.uid != workspace?.uid else { return }
    workspace?.stop()
    workspace = nil
    push.signedIn(uid: user?.uid, reader: reader)
    claims = TokenClaims()
    Task { await refreshClaims(force: false) }
    guard let user, let reader else { return }
    let store = WorkspaceStore(uid: user.uid, reader: reader)
    store.start()
    workspace = store
  }

  func refresh() {
    refreshToken += 1
  }

  /// Re-reads the claims from the ID token (forced after a re-auth).
  func refreshClaims(force: Bool) async {
    claims = TokenClaims(idToken: try? await auth?.idToken(forceRefresh: force))
  }

  /// What every spec screen reads about who is signed in and where.
  var screenSession: ScreenSession {
    let auth = auth
    return ScreenSession(
      email: auth?.user?.email, displayName: auth?.user?.displayName, orgName: workspace?.org?.name,
      orgRole: workspace?.org?.role, siteName: workspace?.site?.name, claims: claims,
      origin: config?.consoleOrigin ?? "",
      reauthenticate: { [weak self] password in
        guard let email = await self?.auth?.user?.email else { throw ConsoleAPIError(status: 401, message: "Sign in again.") }
        try await self?.auth?.signIn(email: email, password: password)
      },
      refreshClaims: { [weak self] in await self?.refreshClaims(force: true) },
      account: AccountOperations(
        changePassword: { [weak self] current, new in
          try await self?.auth?.changePassword(current: current, new: new)
        },
        updateDisplayName: { [weak self] name in try await self?.auth?.updateDisplayName(name) },
        unlinkProvider: { [weak self] provider in
          try await self?.auth?.unlinkProvider(provider)
          await self?.refreshClaims(force: true)
        },
        linkGoogle: { [weak self] authenticate in
          let parts = await MainActor.run { (self?.config, self?.auth, self?.auth?.user?.email) }
          guard let config = parts.0, let client = config.google, let auth = parts.1 else {
            throw ConsoleAPIError(status: 0, message: "Connecting Google is not set up in this build.")
          }
          try await GoogleLink.link(
            iosClientID: client.iosClientID, apiKey: config.firebase.apiKey, emulatorHost: config.authEmulatorHost,
            loginHint: parts.2, transport: URLSession.shared,
            firebaseIDToken: { try await auth.idToken(forceRefresh: true) }, authenticate: authenticate)
          await self?.refreshClaims(force: true)
        },
        message: { passwordChangeMessage($0) }),
      googleConfigured: config?.google != nil, passkeyRelyingParty: config?.passkeyRelyingParty)
  }

  func signOut() async {
    await auth?.signOut()
  }

  /// The whole-screen modes a plugin offers this tablet at sign-in (the POS app only).
  var deviceScreens: [NativeScreen] { app == .pos ? registry.screens(for: .pos, placement: .device) : [] }

  /// The mode this tablet is set up as, when its plugin is loaded.
  var deviceScreen: NativeScreen? {
    guard let id = deviceModeID else { return nil }
    return deviceScreens.first { $0.id == id }
  }

  /// Sets this tablet up as a device screen, or (nil) back to a register that signs in.
  func setDeviceMode(_ id: String?) {
    deviceModeID = id
    if let id { UserDefaults.standard.set(id, forKey: Self.deviceModeKey) } else { UserDefaults.standard.removeObject(forKey: Self.deviceModeKey) }
  }

  /// The context a device screen is handed: nobody is signed in, so it holds no member, no workspace and no site, and
  /// calls the console anonymously with its own pairing token. `back` returns the tablet to sign-in.
  func deviceContext() -> NativePluginContext? {
    guard let reader, let api else { return nil }
    return NativePluginContext(
      uid: "", orgID: nil, hostID: nil, orgSlug: nil, hostSlug: nil, firestore: reader, api: api,
      navigate: { _, _ in }, openBesigner: { _ in },
      back: { [weak self] in self?.setDeviceMode(nil) })
  }

  /// The context a plugin's screen or widget is handed in one window.
  func context(for navigation: ShellNavigation) -> NativePluginContext? {
    guard let user = auth?.user, let reader, let api else { return nil }
    return NativePluginContext(
      uid: user.uid,
      orgID: workspace?.org?.id,
      hostID: workspace?.site?.id,
      orgSlug: workspace?.org?.slug,
      hostSlug: workspace?.site?.subdomain.isEmpty == false ? workspace?.site?.subdomain : workspace?.site?.id,
      firestore: reader,
      api: api,
      writer: ReaderMergeWriter(reader),
      staff: auth?.staff,
      navigate: { [weak navigation] screen, params in navigation?.push(.screen(screen, params)) },
      openBesigner: { [weak navigation] path in navigation?.push(.besigner(path)) },
      siteRole: workspace?.site?.role, orgRole: workspace?.org?.role,
      selectSite: { [weak workspace = self.workspace] hostID in workspace?.selectSite(hostID) },
      back: { [weak navigation] in
        guard let navigation else { return }
        _ = navigation.paths[navigation.section]?.popLast()
      },
      slotWidgets: { [registry, app] slot in registry.widgets(for: app, slot: slot) },
      openLink: { [weak self, weak navigation] link in
        guard let self, let navigation else { return }
        self.open(link, in: navigation)
      })
  }

  /// Opens a console link (universal link, `aglyn://`, a notification's
  /// link): natively when a plugin answers it, a Besigner page in the app's
  /// web view, and otherwise a note that the app has no screen for it yet.
  func open(_ link: String, in navigation: ShellNavigation) {
    switch registry.resolve(link) {
    case .screen(let screen, let params)?: navigation.push(.screen(screen, params))
    case .besigner(let path)?: navigation.push(.besigner(path))
    case .unavailable(let path)?:
      // The app's own screens answer the console's own pages.
      if path.hasPrefix("/manage/notifications/settings") {
        navigation.select(.notifications)
        navigation.push(.notificationSettings)
      } else if path.hasPrefix("/manage/notifications") {
        navigation.select(.notifications)
      } else if DeepLinks.splitConsoleScope(path).rest.hasPrefix("/analytics") {
        navigation.push(.analytics)
      } else {
        navigation.push(.unavailable(path))
      }
    case nil: break
    }
  }
}
