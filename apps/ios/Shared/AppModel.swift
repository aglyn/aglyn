// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
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
  /// The signed-in person's pins, recents, stars, workspace colors and theme (`users/{uid}`), synced with the console.
  private(set) var preferences: AccountPreferencesStore?
  /// The signed-in person's invitations, joined on their own (AGL-4023): never an Accept step.
  private(set) var invites: InviteAutoJoin?
  /// The workspace and site (by address) of a link opened before anyone was signed in on this launch.
  @ObservationIgnored private var pendingLinkScope: (orgSlug: String, hostSlug: String?)?
  /// The signed-in token's claims: the staff section shows only when they say staff.
  private(set) var claims = TokenClaims()
  /// Bumped by Refresh (⌘R); live lists re-subscribe on it.
  private(set) var refreshToken = 0
  /// The screen this tablet was set up as instead of a register (a customer display or a self-service
  /// kiosk), remembered across launches so it comes back with nobody signed in. The POS app only.
  private(set) var deviceModeID: String?
  /// The signed-out screens and what a sign-up carries across them.
  let authFlow = AuthFlow()
  /// The tabs closed in this run, for ⌘⇧T and Recently Closed.
  let closedTabs = ClosedTabs()
  /// What the person may do in the workspace in hand (Create new's prerequisites).
  let orgAccess = OrgAccess()
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
    preferences?.stop()
    preferences = nil
    invites = nil
    // A support session reads the customer's workspaces but never registers this device's notifications under their account.
    if auth?.impersonation == nil { push.signedIn(uid: user?.uid, reader: reader) }
    // Crash reports name the person by Firebase uid only, and never the customer a support session is reading as.
    Telemetry.user(auth?.impersonation == nil ? user?.uid : nil)
    claims = TokenClaims()
    Task { await refreshClaims(force: false) }
    guard let user, let reader else { return }
    let store = WorkspaceStore(uid: user.uid, reader: reader)
    store.start()
    let preferences = AccountPreferencesStore(uid: user.uid, reader: reader)
    preferences.start()
    self.preferences = preferences
    if let service = signUpService { invites = InviteAutoJoin(service: service) }
    if let (orgSlug, hostSlug) = pendingLinkScope {
      pendingLinkScope = nil
      store.select(orgSlug: orgSlug, hostSlug: hostSlug)
    }
    workspace = store
  }

  func refresh() {
    refreshToken += 1
  }

  /// Joins every invitation waiting for the signed-in person, as the console does on every load (AGL-4023): once their
  /// address is confirmed (the server lists none before), never during a support session. A workspace joined while none
  /// is open opens.
  func joinInvites() async {
    guard let invites, auth?.user?.emailVerified == true else { return }
    let joined = await invites.run(impersonating: auth?.impersonation != nil)
    guard let first = joined.first else { return }
    workspace?.reload()
    if workspace?.org == nil { workspace?.open(orgID: first) }
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
      googleConfigured: config?.google != nil, passkeyRelyingParty: config?.passkeyRelyingParty,
      orgPermissions: orgAccess.workspacePermissions, sitePermissions: orgAccess.pickedSitePermissions,
      permissionsSiteID: orgAccess.pickedSiteID,
      enabledPlugins: workspace?.orgLogo.map { resolveEnabledPlugins($0.enabledPlugins) })
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

  /// The site a window stands in: the picked one while it is inside a site, none while it looks at the whole workspace
  /// (Aglyn POS always sells for its store).
  func scopedSite(_ navigation: ShellNavigation) -> WorkspaceSite? {
    app == .pos || navigation.inSite ? workspace?.site : nil
  }

  /// The context a plugin's screen or widget is handed in one window.
  func context(for navigation: ShellNavigation) -> NativePluginContext? {
    // A tab behind another, or one whose workspace and site are still coming back, reads its own (P9).
    if let frozen = navigation.frozenContext,
      !navigation.front || workspace?.org?.id != frozen.orgID || scopedSite(navigation)?.id != frozen.hostID
    {
      return frozen
    }
    return liveContext(for: navigation)
  }

  /// The context for where the app's workspace store stands now.
  func liveContext(for navigation: ShellNavigation) -> NativePluginContext? {
    guard let user = auth?.user, let reader, let api else { return nil }
    var context = NativePluginContext(
      uid: user.uid,
      orgID: workspace?.org?.id,
      hostID: scopedSite(navigation)?.id,
      orgSlug: workspace?.org?.slug,
      hostSlug: scopedSite(navigation).map { $0.subdomain.isEmpty ? $0.id : $0.subdomain },
      firestore: reader,
      api: api,
      writer: ReaderMergeWriter(reader),
      staff: auth?.staff,
      navigate: { [weak navigation] screen, params in navigation?.push(.screen(screen, params)) },
      openBesigner: { [weak navigation] path in navigation?.push(.besigner(path)) },
      siteRole: scopedSite(navigation)?.role, orgRole: workspace?.org?.role,
      selectSite: { [weak self, weak workspace = self.workspace, weak navigation] hostID in
        workspace?.selectSite(hostID)
        guard hostID != nil, let navigation else { return }
        navigation.inSite = true
        // Opening a site from a workspace screen (a Sites row) drills into it, on its Home; a screen of the site that
        // asked for one stays where it is. Sites pushed over Home is a workspace screen too: on a phone it stayed on the
        // stack, and its `new=1` opened Create site again as the picked site rebuilt it (AGL-4129).
        let sitesInFront: Bool
        switch navigation.paths[navigation.section]?.last {
        case .screen(let screen, _), .area(let screen, _): sitesInFront = screen == siteSitesScreen
        default: sitesInFront = false
        }
        if let self, sitesInFront || (navigation.section != .home && ShellScope(model: self, navigation: navigation).row(for: navigation.section) == nil) {
          navigation.enterSite()
        }
      },
      back: { [weak navigation] in
        guard let navigation else { return }
        _ = navigation.paths[navigation.section]?.popLast()
      },
      slotWidgets: { [registry, app] slot in registry.widgets(for: app, slot: slot) },
      openLink: { [weak self, weak navigation] link in
        guard let self, let navigation else { return }
        self.open(link, in: navigation)
      },
      permission: { [weak self] key, hostID in self?.orgAccess.holds(key, onSite: hostID) ?? false })
    context.sites = (workspace?.sites ?? []).map {
      NativeSiteRef(id: $0.id, name: $0.name, subdomain: $0.subdomain, role: $0.role)
    }
    return context
  }

  /// Opens a console link (universal link, `aglyn://`, a notification's or a push's link, a search row's): on the
  /// workspace and site it names, then the whole path to it, as navigating there by hand builds it (AGL-4059): the
  /// sidebar's mode, the area row, each screen on the way pushed, so the head's crumbs and Back walk up from it. A Besigner
  /// page opens in the app's web view over the page it edits; a page the app has no screen for says so over its area.
  func open(_ link: String, in navigation: ShellNavigation) {
    guard let (scope, path) = NavPaths.link(link, routes: registry.deepLinks, lists: navPathLists, inSite: navigation.inSite)
    else { return }
    // A link that names a workspace and site by address reads them, not whichever is picked (AGL-3911, AGL-4215).
    if let org = scope.orgSlug { enterScope(orgSlug: org, hostSlug: scope.hostSlug, in: navigation) }
    go(path, in: navigation)
  }

  /// Opens a Starred or Recent item (the sidebar's, Home's, the title bar's, the search's): onto its workspace and site,
  /// then the same path a link to it opens (AGL-4059). Returns that path.
  @discardableResult
  func open(_ item: AccountItemRef, in navigation: ShellNavigation) -> NavPath {
    if item.orgId != workspace?.org?.id { workspace?.open(orgID: item.orgId, hostID: item.hostId) }
    if let hostID = item.hostId {
      workspace?.selectSite(hostID)
      if app == .aglyn { navigation.inSite = true }
    } else if app == .aglyn {
      navigation.inSite = false
    }
    let path = NavPaths.place(item, routes: registry.deepLinks, lists: navPathLists)
    go(path, in: navigation)
    return path
  }

  /// Opens a screen of the scope in use (a screens-and-settings match in the search, a record row that names a screen):
  /// the same path a link to it opens, under the row it was matched in.
  func open(screen: String, params: NativeParams, rowID: String?, in navigation: ShellNavigation) {
    guard !screen.isEmpty else { return }
    let path = NavPaths.place(
      screen: screen, params: params, rowID: rowID, inSite: scopedSite(navigation) != nil, routes: registry.deepLinks,
      lists: navPathLists)
    go(path, in: navigation)
  }

  /// The lists a place is looked up in: the manifest's rows this build has a screen for (a plugin that is off still
  /// opens its place under its own row), and the staff list for staff.
  var navPathLists: NavPathLists {
    let staff = claims.isStaff ? ResolvedNavList(groups: staffNavGroups, id: .unknown) : nil
    return NavPaths.lists(staff: staff) { [registry] in registry.screen($0) != nil }
  }

  /// The staff list, as its own mode: the console's staff pages, for staff only.
  var staffNavGroups: [NativeNavGroup] {
    guard claims.isStaff else { return [] }
    let rows = ScreenCatalog.shared.group("staff").map { spec in
      NativeNavRow(
        console: NativeNavConsoleRef(id: spec.id, surface: .nativeOnly), icon: NativeNavIcon(android: "", apple: spec.icon),
        id: spec.id, label: spec.label, screen: spec.id)
    }
    return rows.isEmpty ? [] : [NativeNavGroup(foldable: false, id: "staff", rows: rows)]
  }

  /// Puts a resolved path on screen: the sidebar's mode, the area's section, and each level pushed over it. On a phone an
  /// area opens as Home's tile does (AGL-4006): on its own tab when the tab bar holds it, else pushed on Home with its
  /// section chips, a settings area under its mode's list. Aglyn POS has no areas: the place opens over what is on screen.
  func go(_ path: NavPath, in navigation: ShellNavigation) {
    let steps = path.pushed.map(Self.route)
    if app != .aglyn {
      switch path.area {
      case .shell(.notifications): navigation.select(.notifications)
      case .shell(.notificationSettings):
        navigation.select(.notifications)
        navigation.push(.notificationSettings)
      case .shell(.home): if steps.isEmpty { navigation.select(.home) }
      case .row(_, let screen, let params): if steps.isEmpty { navigation.push(Self.route(.screen(screen, params))) }
      }
      if let last = steps.last { navigation.push(last) }
      return
    }
    let land = { (section: ShellSection, stack: [Route]) in
      navigation.select(section)
      navigation.paths[section] = stack
    }
    switch path.area {
    case .shell(.home):
      navigation.mode = .main
      land(.home, steps)
    case .shell(.notifications):
      navigation.mode = .main
      land(.notifications, steps)
    case .shell(.notificationSettings):
      navigation.mode = .main
      land(.notifications, [.notificationSettings] + steps)
    case .row(let rowID, let screen, let params):
      let section = ShellSection.opening(screen, params)
      guard navigation.compact else {
        navigation.mode = Self.mode(path.mode)
        land(section, steps)
        return
      }
      let settings = path.mode == .workspaceSettings || path.mode == .siteSettings
      navigation.mode = settings ? Self.mode(path.mode) : .main
      if !settings, let tab = navigation.tabSection?(rowID) {
        // The tab opens on its row's own place; one of its sections (Orders' Reservations) is pushed over it, as its
        // chip does.
        let sectionOverTab = NavPaths.opensSection(path, lists: navPathLists) ? ShellNavigation.areaRoute(section) : nil
        land(tab, (sectionOverTab.map { [$0] } ?? []) + steps)
      } else {
        let area = ShellNavigation.areaRoute(section) ?? Self.route(.screen(screen, params))
        land(.home, (settings ? [.modeList] : []) + [area] + steps)
      }
    }
  }

  private static func mode(_ mode: NavPathMode) -> ShellMode {
    switch mode {
    case .main: .main
    case .workspaceSettings: .workspaceSettings
    case .siteSettings: .siteSettings
    case .staff: .admin
    }
  }

  private static func route(_ step: NavStep) -> Route {
    switch step {
    case .screen(let screen, _) where screen == NativeNav.analytics: .analytics
    case .screen(let screen, let params): .screen(screen, params)
    case .besigner(let path): .besigner(path)
    case .unavailable(let path): .unavailable(path)
    }
  }

  /// Moves onto the workspace and site a link names by address, and into the site when it names one (a workspace's own
  /// page opens on the whole workspace). A first segment that is none of the person's workspaces (a stored link's site
  /// id, when its site was not known) moves nothing, so it never undoes the site a notification already opened.
  private func enterScope(orgSlug: String, hostSlug: String?, in navigation: ShellNavigation) {
    guard select(orgSlug: orgSlug, hostSlug: hostSlug), app == .aglyn else { return }
    navigation.inSite = hostSlug != nil
  }

  /// Moves the switcher onto the workspace and site a link names by address; a link that launched the app before the
  /// session was restored waits for the person's workspace store. False when the person's workspaces are here and
  /// none is that one.
  @discardableResult
  private func select(orgSlug: String, hostSlug: String?) -> Bool {
    if let workspace {
      return workspace.select(orgSlug: orgSlug, hostSlug: hostSlug)
    }
    pendingLinkScope = (orgSlug, hostSlug)
    return true
  }

  /// Follows a link that says which workspace and site it is about (a notification row, a tapped push): onto them
  /// first, so the screen it opens reads that site (AGL-3911), then the link in the form the console follows it.
  func follow(_ link: String?, orgID: String?, hostID: String?, in navigation: ShellNavigation) {
    var link = link
    if let workspace {
      let orgID = orgID ?? workspace.sites.first { $0.id == hostID }?.orgID
      if let orgID, orgID != workspace.org?.id || (hostID != nil && hostID != workspace.site?.id) {
        workspace.open(orgID: orgID, hostID: hostID ?? (orgID == workspace.org?.id ? workspace.site?.id : nil))
      }
      if hostID != nil { navigation.inSite = true }
      // Host notifications store `/{hostDocId}/…`; the console follows them at `/{orgSlug}/hosts/{subdomain}/…`. A site
      // in another workspace is not among the sites on screen yet: the row's own ids stand in for the slugs (the store
      // matches a workspace and a site by id as well), so the link still names that site and the store picks it as
      // soon as its workspace's sites arrive, rather than reading the site id as a workspace (AGL-4215).
      let site = workspace.sites.first { $0.id == hostID }
      let org = workspace.orgs.first { $0.id == (orgID ?? site?.orgID) }
      let hostSlug = site.map { $0.subdomain.isEmpty ? $0.id : $0.subdomain } ?? hostID
      link = DeepLinks.notificationLink(link, orgSlug: org?.slug ?? orgID, hostID: hostID, hostSubdomain: hostSlug)
    }
    if let link { open(link, in: navigation) }
  }
}

extension AppModel {
  /// A stored picture (a site's favicon, a workspace's logo) as an address on the console this app talks to: the
  /// shared resolver every screen uses (`mediaPreviewURL`).
  func mediaURL(_ value: String?, hostID: String?, width: Int = 160) -> URL? {
    guard let origin = api?.origin else { return nil }
    return mediaPreviewURL(value, origin: origin, hostID: hostID, width: width)
  }
}
