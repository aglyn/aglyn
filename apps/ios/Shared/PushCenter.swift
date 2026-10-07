// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Observation
import SwiftUI
import UserNotifications

#if os(iOS)
  import UIKit
#elseif os(macOS)
  import AppKit
#endif

/// Push straight from APNs: asks once after sign-in, registers with APNs,
/// keeps this install's row in `users/{uid}/devices` current, drops it on
/// sign-out, and turns a tapped push into a link the shell opens.
///
/// APNs hands out a token only to a build signed with the `aps-environment`
/// entitlement, which needs the team signing Zach is setting up; until then
/// registration fails quietly and nothing is written.
@MainActor
@Observable
final class PushCenter: NSObject {
  /// A tapped push's link, waiting for the window to open it.
  var pendingLink: String?
  /// What the person answered when asked; nil until known.
  private(set) var authorization: UNAuthorizationStatus?

  @ObservationIgnored private let registration: PushDeviceRegistration
  @ObservationIgnored private var uid: String?
  @ObservationIgnored private var reader: FirestoreReader?
  @ObservationIgnored private var token: Data?

  init(app: AglynAppID) {
    registration = PushDeviceRegistration(app: app)
    super.init()
    UNUserNotificationCenter.current().delegate = self
  }

  /// Follows the signed-in person: asks for permission (the system asks only
  /// once) and registers with APNs. A token APNs already handed out is
  /// written for the new person at once.
  func signedIn(uid: String?, reader: FirestoreReader?) {
    self.uid = uid
    self.reader = reader
    guard uid != nil else { return }
    #if DEBUG
      // Screenshot and UI-test runs keep the system's permission sheet away.
      if UserDefaults.standard.bool(forKey: "AglynNoPushPrompt") { return }
    #endif
    Task {
      let center = UNUserNotificationCenter.current()
      let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
      authorization = await center.notificationSettings().authorizationStatus
      guard granted else { return }
      #if os(iOS)
        UIApplication.shared.registerForRemoteNotifications()
      #elseif os(macOS)
        NSApplication.shared.registerForRemoteNotifications()
      #endif
      if let token { await write(token) }
    }
  }

  /// Drops this install's row while the person can still write it.
  func signingOut() async {
    guard let uid, let reader else { return }
    await registration.unregister(uid: uid, reader: reader)
  }

  func didRegister(token: Data) {
    self.token = token
    Task { await write(token) }
  }

  func didFailToRegister(_ error: Error) {
    print("Aglyn: APNs registration did not complete: \(error.localizedDescription)")
  }

  private func write(_ token: Data) async {
    guard let uid, let reader else { return }
    do {
      try await registration.register(token: token, uid: uid, reader: reader)
    } catch {
      print("Aglyn: the push device row was not saved: \(error)")
    }
  }
}

extension PushCenter: UNUserNotificationCenterDelegate {
  /// A push that arrives while the app is open still shows as a banner.
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    [.banner, .sound, .list]
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    let data = MobilePushData(userInfo: response.notification.request.content.userInfo)
    await MainActor.run {
      if let link = data?.link { self.pendingLink = link }
    }
  }
}

#if os(iOS)
  /// Hands APNs' answers to the app's `PushCenter`.
  final class PushAppDelegate: NSObject, UIApplicationDelegate {
    @MainActor static var push: PushCenter?

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
      MainActor.assumeIsolated { Self.push?.didRegister(token: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
      MainActor.assumeIsolated { Self.push?.didFailToRegister(error) }
    }
  }
#elseif os(macOS)
  final class PushAppDelegate: NSObject, NSApplicationDelegate {
    @MainActor static var push: PushCenter?

    func application(_ application: NSApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
      MainActor.assumeIsolated { Self.push?.didRegister(token: deviceToken) }
    }

    func application(_ application: NSApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
      MainActor.assumeIsolated { Self.push?.didFailToRegister(error) }
    }
  }
#endif
