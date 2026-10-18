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
  /// The transport the REST calls to Firebase go over: it adds the App Check token.
  let firebaseHTTP: HTTPTransport
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
  /// The signed-out screens and what a sign-up carries across them.
  let authFlow = AuthFlow()
  /// The first verified session's workspace settling (the held sign-up name, AGL-2590).
  var firstRun: FirstRunState = .idle
  /// Whose first run has been settled, so it runs once per person per launch.
  @ObservationIgnored var firstRunSettledFor: String?

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
      // Every REST call to Firebase carries the App Check token production enforces (AGL-3818).
      let firebaseHTTP = AppCheckTransport(appCheck: AglynFirebase.appCheck)
      self.firebaseHTTP = firebaseHTTP
      let auth = AuthSession.make(config, appCheck: AglynFirebase.appCheck)
      self.auth = auth
      // A REST sign-in has no SDK user for Firestore to read as, so Firestore goes over REST too.
      let rest = RestFirestoreReader(
        projectID: config.firebase.projectID, emulatorHost: config.firestoreEmulatorHost, transport: firebaseHTTP,
        idToken: { try await auth.idToken(forceRefresh: false) })
      // The SDK reads as the SDK's signed-in person, the staff member; a support session (signed in as a customer, over REST)
      // reads through the customer's own token instead, so the rules treat the staff member exactly as they treat the customer.
      self.reader =
        auth.transport == .rest
        ? rest
        : SwitchingFirestoreReader(normal: FirebaseFirestoreReader(), impersonated: rest, flag: auth.impersonationFlag)
      self.api = ConsoleAPIClient(origin: config.consoleOrigin) { force in
        try await auth.idToken(forceRefresh: force)
      }
      auth.onBeforeSignOut { await push.signingOut() }
    } else {
      self.config = nil
      self.firebaseHTTP = URLSession.shared
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
    // A support session reads the customer's workspaces but never registers this device's notifications under their account.
    if auth?.impersonation == nil { push.signedIn(uid: user?.uid, reader: reader) }
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
      impersonate: { [weak self] token, tenantId in
        try await self?.auth?.beginImpersonation(token: token, tenantId: tenantId)
      },
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
          let parts = await MainActor.run { (self?.config, self?.auth, self?.auth?.user?.email, self?.firebaseHTTP) }
          guard let config = parts.0, let client = config.google, let auth = parts.1, let http = parts.3 else {
            throw ConsoleAPIError(status: 0, message: "Connecting Google is not set up in this build.")
          }
          try await GoogleLink.link(
            iosClientID: client.iosClientID, apiKey: config.firebase.apiKey, emulatorHost: config.authEmulatorHost,
            loginHint: parts.2, transport: http,
            firebaseIDToken: { try await auth.idToken(forceRefresh: true) }, authenticate: authenticate)
          await self?.refreshClaims(force: true)
        },
        message: { passwordChangeMessage($0) }),
      googleConfigured: config?.google != nil, passkeyRelyingParty: config?.passkeyRelyingParty)
  }

  func signOut() async {
    await auth?.signOut()
    authFlow.reset()
    authFlow.pendingVerificationCode = nil
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
    case .screen(let screen, let params)?:
      // A link that names a workspace and site by address reads them, not whichever is picked (AGL-3911).
      if let org = params["orgSlug"] { workspace?.select(orgSlug: org, hostSlug: params["hostSlug"]) }
      navigation.push(.screen(screen, params))
    case .besigner(let path)?: navigation.push(.besigner(path))
    case .unavailable(let path)?:
      // The app's own screens answer the console's own pages.
      let scope = DeepLinks.splitConsoleScope(path.split(separator: "?", maxSplits: 1).first.map(String.init) ?? path)
      if let jobID = DeepLinks.rootQuery(path)?["aiJob"], !jobID.isEmpty, registry.screen("ai.job") != nil {
        // An AI job's notice that built nothing of its own to open (`/{hostId}?aiJob=…`) opens that job (AGL-3911).
        if let org = scope.orgSlug { workspace?.select(orgSlug: org, hostSlug: scope.hostSlug) }
        navigation.push(.screen("ai.job", ["jobId": jobID]))
      } else if path.hasPrefix("/manage/notifications/settings") {
        navigation.select(.notifications)
        navigation.push(.notificationSettings)
      } else if path.hasPrefix("/manage/notifications") {
        navigation.select(.notifications)
      } else if scope.rest.hasPrefix("/analytics") {
        navigation.push(.analytics)
      } else if scope.hostSlug != nil, scope.rest == "/" {
        // A site's own dashboard (a "you have access to this site" notice) is Home.
        navigation.select(.home)
      } else {
        navigation.push(.unavailable(path))
      }
    case nil: break
    }
  }

  /// Follows a link that says which workspace and site it is about (a notification row, a tapped push): onto them
  /// first, so the screen it opens reads that site (AGL-3911), then the link in the form the console follows it.
  func follow(_ link: String?, orgID: String?, hostID: String?, in navigation: ShellNavigation) {
    var link = link
    if let workspace {
      let orgID = orgID ?? workspace.sites.first { $0.id == hostID }?.orgID
      if let orgID, orgID != workspace.org?.id || (hostID != nil && hostID != workspace.site?.id) {
        workspace.select(orgID: orgID, hostID: hostID ?? (orgID == workspace.org?.id ? workspace.site?.id : nil))
      }
      // Host notifications store `/{hostDocId}/…`; the console follows them at `/{orgSlug}/hosts/{subdomain}/…`.
      let site = workspace.sites.first { $0.id == hostID }
      let org = workspace.orgs.first { $0.id == (orgID ?? site?.orgID) }
      link = DeepLinks.notificationLink(link, orgSlug: org?.slug, hostID: hostID, hostSubdomain: site?.subdomain)
    }
    if let link { open(link, in: navigation) }
  }
}
