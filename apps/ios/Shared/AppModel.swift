// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynPluginManifest
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
  /// Bumped by Refresh (⌘R); live lists re-subscribe on it.
  private(set) var refreshToken = 0

  init(app: AglynAppKind) {
    self.app = app
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
    let result = NativePluginLoader.load(NativePluginManifest.entries, into: registry)
    pluginFailures = result.failed
    for failure in result.failed {
      print("Aglyn: plugin \(failure.pluginID) did not load: \(failure.error)")
    }
  }

  var brandName: String { config?.brandName ?? AglynConfig.defaultBrandName }

  /// Follows the signed-in person: a new workspace store per person, none signed out.
  func userChanged(_ user: AglynUser?) {
    guard user?.uid != workspace?.uid else { return }
    workspace?.stop()
    workspace = nil
    push.signedIn(uid: user?.uid, reader: reader)
    guard let user, let reader else { return }
    let store = WorkspaceStore(uid: user.uid, reader: reader)
    store.start()
    workspace = store
  }

  func refresh() {
    refreshToken += 1
  }

  func signOut() async {
    await auth?.signOut()
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
      navigate: { [weak navigation] screen, params in navigation?.push(.screen(screen, params)) },
      openConsolePath: { [weak self, weak navigation] path, scope in
        guard let self, let navigation else { return }
        navigation.push(.console(self.scopedConsolePath(path, scope: scope)))
      })
  }

  func scopedConsolePath(_ path: String, scope: ConsolePathScope) -> String {
    let rest = path.hasPrefix("/") ? path : "/\(path)"
    switch scope {
    case .absolute: return rest
    case .org: return workspace?.org.map { "/\($0.slug)\(rest)" } ?? rest
    case .site:
      guard let org = workspace?.org, let site = workspace?.site else { return rest }
      return "/\(org.slug)/hosts/\(site.subdomain.isEmpty ? site.id : site.subdomain)\(rest)"
    }
  }

  /// Opens a console link (universal link, `aglyn://`, a notification's
  /// link): natively when a plugin answers it, otherwise in the console WebView.
  func open(_ link: String, in navigation: ShellNavigation) {
    switch registry.resolve(link) {
    case .screen(let screen, let params)?: navigation.push(.screen(screen, params))
    case .console(let path)?: navigation.push(.console(path))
    case nil: break
    }
  }
}
