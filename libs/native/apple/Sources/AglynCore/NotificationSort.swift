// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// The feed's orders, as the console's headers sort it (`NOTIFICATION_SORTS`, apps/console/utils/notification-filters.ts,
/// AGL-3680): When newest first (the default), and oldest first, Notification (`title`), Type and Status (`read`, New first
/// or Read first). Every one but the default is `alone`: with a filter on, the feed keeps newest first and says why.
public enum NotificationSort: String, CaseIterable, Identifiable, Sendable {
  case newest, oldest, titleAscending, titleDescending, typeAscending, typeDescending, newFirst, readFirst

  public var id: String { rawValue }

  /// The field the feed's query orders by.
  public var path: String {
    switch self {
    case .newest, .oldest: "createdAt"
    case .titleAscending, .titleDescending: "title"
    case .typeAscending, .typeDescending: "type"
    case .newFirst, .readFirst: "read"
    }
  }

  public var descending: Bool {
    switch self {
    case .newest, .titleDescending, .typeDescending, .readFirst: true
    default: false
    }
  }

  /// The console's name for the order (its header), as its notice says it.
  public var label: String {
    switch self {
    case .newest: "When"
    case .oldest: "When, oldest first"
    case .titleAscending, .titleDescending: "Notification"
    case .typeAscending, .typeDescending: "Type"
    case .newFirst, .readFirst: "Status"
    }
  }

  /// How the Sort menu offers it.
  public var menu: String {
    switch self {
    case .newest: "Newest first"
    case .oldest: "Oldest first"
    case .titleAscending: "Notification, A to Z"
    case .titleDescending: "Notification, Z to A"
    case .typeAscending: "Type, A to Z"
    case .typeDescending: "Type, Z to A"
    case .newFirst: "Status, new first"
    case .readFirst: "Status, read first"
    }
  }

  /// Sorts only with no filter on: paired with Type or Status it would need an index per pair.
  public var alone: Bool { self != .newest }

  /// The order the feed runs in: the one asked, unless it sorts only with no filter on and a filter is.
  public func inForce(filtered: Bool) -> NotificationSort { alone && filtered ? .newest : self }

  /// The console's words when an order gives way to a filter: "Sorted by When: Type sorts only with no filter on."
  public func notice(filtered: Bool) -> String? {
    inForce(filtered: filtered) == self ? nil : "Sorted by \(NotificationSort.newest.label): \(label) sorts only with no filter on."
  }
}
