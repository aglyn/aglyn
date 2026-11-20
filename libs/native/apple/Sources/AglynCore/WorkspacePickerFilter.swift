// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// The workspace picker's filters (the console's `WORKSPACE_FILTER_FIELDS`, apps/console/utils/workspace-list.ts): the
/// workspace's plan, the person's role in it, and whether they pinned it, each an exact match over the workspaces loaded.
public struct WorkspacePickerFilter: Equatable, Sendable {
  public var plan: String?
  public var role: String?
  public var pinned: Bool?

  public init(plan: String? = nil, role: String? = nil, pinned: Bool? = nil) {
    self.plan = plan
    self.role = role
    self.pinned = pinned
  }

  /// How many filters are on.
  public var count: Int { [plan != nil, role != nil, pinned != nil].filter { $0 }.count }
  public var isOn: Bool { count > 0 }

  /// Whether a workspace passes: `plan` is its resolved plan (nil until read, which no Plan filter admits).
  public func admits(_ org: WorkspaceOrg, plan orgPlan: String?, pinned isPinned: Bool) -> Bool {
    if let plan, orgPlan != plan { return false }
    if let role, org.role != role { return false }
    if let pinned, isPinned != pinned { return false }
    return true
  }

  /// The headers the console's panel uses.
  public static let headers = ["plan": "Plan", "role": "Your role", "pinned": "Pinned"]

  /// The plans in the console's order (`PLAN_LABELS`), by their labels.
  public static var plans: [Choice] {
    ["free", "starter", "pro", "business", "scale", "advanced", "agency", "enterprise"].map {
      Choice(value: $0, label: BundleWords.planLabels[$0] ?? $0.capitalized)
    }
  }

  public static let roles: [Choice] = [
    Choice(value: "owner", label: "Owner"), Choice(value: "admin", label: "Admin"),
    Choice(value: "editor", label: "Editor"), Choice(value: "viewer", label: "Viewer"),
  ]

  /// One value a filter offers, by its label.
  public struct Choice: Identifiable, Equatable, Sendable {
    public let value: String
    public let label: String
    public var id: String { value }
  }
}
