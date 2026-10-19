// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

/// The workspace permissions each role holds when nothing refines it (`CORE_ROLE_GRANTS`).
public enum OrgRoleGrants {
  public static let core: [String] = [
    "org.settings", "org.auditLog", "billing.view", "billing.manage", "members.manage", "hosts.create", "hosts.delete",
    "data.manage", "marketplace.publish", "plugins.install",
  ]

  public static func defaults(_ role: String) -> Set<String> {
    switch role {
    case "owner", "admin": Set(core)
    case "editor": ["data.manage", "marketplace.publish", "plugins.install"]
    default: []
    }
  }
}

/// Whether a member holds one workspace permission, as the console's `resolveOrgPermissions` answers it: the verdict
/// stamped on the member (`resolvedPermissions`, every layer applied) when there is one, else the role's default, then
/// the member's custom role, then the member's own override.
public func orgPermissionGranted(_ key: String, member: [String: Any]?, customRole: [String: Any]?) -> Bool {
  guard let member else { return false }
  if let stamped = (member["resolvedPermissions"] as? [String: Any])?[key] as? Bool { return stamped }
  var granted = OrgRoleGrants.defaults(member["role"] as? String ?? "viewer").contains(key)
  if member["roleId"] as? String != nil, let value = (customRole?["permissions"] as? [String: Any])?[key] as? Bool {
    granted = value
  }
  if let value = (member["permissions"] as? [String: Any])?[key] as? Bool { granted = value }
  return granted
}
