// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import Observation

/// The roles a site's content and publishing need, as the console's rules
/// name them (`canWriteHostContent`, `canPublishHostContent`).
public enum SiteRoles {
  public static let content: Set<String> = ["admin", "editor", "author"]
  public static let publish: Set<String> = ["admin", "editor"]
}

/// The signed-in person's role on the picked site, live: their own
/// `users/{uid}/hostMemberships/{hostId}` row, the index the site switcher
/// reads. A screen reads it only to grey out what the rules would refuse;
/// the rules and routes stay the authority.
@MainActor
@Observable
public final class SiteRoleModel {
  public private(set) var role: String?
  @ObservationIgnored private var listener: FirestoreListening?

  public init() {}

  public func start(_ context: NativePluginContext) {
    listener?.remove()
    role = nil
    guard let hostID = context.hostID else { return }
    listener = context.firestore.listenDocument(["users", context.uid, "hostMemberships", hostID]) {
      [weak self] result in
      if case .success(let doc) = result { self?.role = doc?.string("role") }
    }
  }

  public func stop() {
    listener?.remove()
    listener = nil
  }

  public func allows(_ roles: Set<String>) -> Bool { role.map(roles.contains) ?? false }
  public var canEditContent: Bool { allows(SiteRoles.content) }
  public var canPublish: Bool { allows(SiteRoles.publish) }
}
