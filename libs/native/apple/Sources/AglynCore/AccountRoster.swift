// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// One Aglyn account signed in on this device (Add account, Zach 2026-10-18). The app's own sign-in is the `base` slot;
/// every account added beside it has a slot of its own, whose refresh token the Keychain keeps under that slot. Nothing
/// secret is in here: the roster only says who each slot is, so the account menu can list them without a read.
public struct SignedInAccount: Codable, Equatable, Hashable, Identifiable, Sendable {
  /// The slot the app's own sign-in lives in (the Firebase SDK's, or the REST session's).
  public static let baseSlot = "base"

  /// `base`, or the added account's Keychain slot.
  public let slot: String
  public var uid: String
  public var email: String?
  public var displayName: String?
  /// The workspaces this account belonged to when it was last in use: a tapped push names a workspace, not an account,
  /// so the app finds whose it is here.
  public var orgIDs: [String]
  /// The account's own picture as it was last shown (`readAccountPhoto`, AGL-4010), so the switcher draws each account's
  /// face without reading anyone's profile; nil until it has been on screen, or when it has none.
  public var photoURL: String?

  public var id: String { slot }
  public var isBase: Bool { slot == Self.baseSlot }

  public init(
    slot: String, uid: String, email: String?, displayName: String?, orgIDs: [String] = [], photoURL: String? = nil
  ) {
    self.slot = slot
    self.uid = uid
    self.email = email
    self.displayName = displayName
    self.orgIDs = orgIDs
    self.photoURL = photoURL
  }

  /// The initials the account's photo shows when it has none ("ZG"), from the name, else the address.
  public var initials: String { accountInitials(name: displayName, email: email) }
}

/// "ZG" for Zach Gover, "Z" for zach@…, "?" for nobody.
public func accountInitials(name: String?, email: String?) -> String {
  let words = (name ?? "").split(whereSeparator: { $0 == " " || $0 == "-" }).filter { !$0.isEmpty }
  if let first = words.first {
    let last = words.count > 1 ? words.last : nil
    return (String(first.prefix(1)) + (last.map { String($0.prefix(1)) } ?? "")).uppercased()
  }
  if let email, let first = email.first { return String(first).uppercased() }
  return "?"
}

/// The accounts signed in on this device and which one is in use, kept in the app's defaults per Firebase project.
public struct AccountRosterStorage: @unchecked Sendable {
  public let projectID: String
  private let defaults: UserDefaults

  public init(projectID: String, defaults: UserDefaults = .standard) {
    self.projectID = projectID
    self.defaults = defaults
  }

  private var rosterKey: String { "aglyn.accounts.\(projectID)" }
  private var activeKey: String { "aglyn.accounts.active.\(projectID)" }

  public func load() -> [SignedInAccount] {
    guard let data = defaults.data(forKey: rosterKey),
      let accounts = try? JSONDecoder().decode([SignedInAccount].self, from: data)
    else { return [] }
    return accounts
  }

  public func save(_ accounts: [SignedInAccount]) {
    if accounts.isEmpty {
      defaults.removeObject(forKey: rosterKey)
    } else if let data = try? JSONEncoder().encode(accounts) {
      defaults.set(data, forKey: rosterKey)
    }
  }

  /// The slot in use, `base` when none is named.
  public var activeSlot: String {
    get { defaults.string(forKey: activeKey) ?? SignedInAccount.baseSlot }
    nonmutating set { defaults.set(newValue, forKey: activeKey) }
  }
}

/// The roster after one account signs in, signs out or is refreshed: the base account first, then the added ones in the
/// order they were added; an account already listed (the same person signing in again) keeps its place.
public enum AccountRosterRules {
  public static func upsert(_ account: SignedInAccount, into roster: [SignedInAccount]) -> [SignedInAccount] {
    var next = roster
    if let index = next.firstIndex(where: { $0.slot == account.slot }) {
      var kept = account
      if kept.orgIDs.isEmpty { kept.orgIDs = next[index].orgIDs }
      // The same person signing in again keeps the photo last shown, until their profile is read again.
      if kept.photoURL == nil, kept.uid == next[index].uid { kept.photoURL = next[index].photoURL }
      next[index] = kept
    } else {
      next.append(account)
    }
    return next.filter(\.isBase) + next.filter { !$0.isBase }
  }

  public static func remove(slot: String, from roster: [SignedInAccount]) -> [SignedInAccount] {
    roster.filter { $0.slot != slot }
  }

  /// The account whose workspaces include this one, for a tapped push about it; nil when none or the active one does.
  public static func owner(ofOrg orgID: String?, in roster: [SignedInAccount], activeSlot: String) -> SignedInAccount? {
    guard let orgID, !orgID.isEmpty else { return nil }
    if roster.first(where: { $0.slot == activeSlot })?.orgIDs.contains(orgID) == true { return nil }
    return roster.first { $0.slot != activeSlot && $0.orgIDs.contains(orgID) }
  }
}
