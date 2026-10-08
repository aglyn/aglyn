// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// A release flag's published value: on, a rollout percentage, and the plans it is limited to.
public struct ReleaseFlagValue: Equatable, Sendable {
  public let enabled: Bool
  public let rolloutPercent: Int
  public let plans: [String]

  public init(enabled: Bool, rolloutPercent: Int, plans: [String]) {
    self.enabled = enabled
    self.rolloutPercent = rolloutPercent
    self.plans = plans
  }
}

/// `releaseFlagBucket`: FNV-1a over `flag:subject`, 0 to 99.
public func releaseFlagBucket(_ flag: String, _ subject: String) -> Int {
  var hash: UInt32 = 0x811c_9dc5
  for unit in "\(flag):\(subject)".utf16 {
    hash ^= UInt32(unit)
    hash = hash &* 0x0100_0193
  }
  return Int(hash % 100)
}

/// `isReleaseFlagOnForOrg`: the org's override first, then the plan targeting, then on, then the rollout bucket.
public func isReleaseFlagOn(
  _ flag: String, value: ReleaseFlagValue, orgID: String?, plan: String?, overrides: [String: Any]?
) -> Bool {
  if let override = overrides?[flag] as? Bool { return override }
  if !value.plans.isEmpty {
    guard let plan, value.plans.contains(plan) else { return false }
  }
  if value.enabled { return true }
  let percent = min(100, max(0, value.rolloutPercent))
  guard percent > 0, let orgID, !orgID.isEmpty else { return false }
  if percent >= 100 { return true }
  return releaseFlagBucket(flag, orgID) < percent
}

/// Whether a release flag is on for a workspace as the console decides it, from the published value;
/// `staff` previews every flag, as the console's staff session does.
public func releaseFlagOn(_ flag: String, org: [String: Any]?, orgID: String?, staff: Bool) -> Bool {
  if staff { return true }
  let value = ReleaseFlagDefaults.byKey[flag] ?? ReleaseFlagValue(enabled: false, rolloutPercent: 0, plans: [])
  return isReleaseFlagOn(flag, value: value, orgID: orgID, plan: effectivePlan(org), overrides: org?["releaseFlags"] as? [String: Any])
}
