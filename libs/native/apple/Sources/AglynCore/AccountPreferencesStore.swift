// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import Foundation
import Observation

/// What pinning or unpinning a site did (the console's `PinToggleOutcome`).
public enum SitePinToggle: Sendable, Equatable {
  case pinned, unpinned
  /// Every pin the account keeps is in this workspace: ask which to replace.
  case full
  /// Nothing to do (no site or no workspace).
  case none
}

/// The preferences a person keeps on their account (`users/{uid}`, AGL-3943): pins, recent workspaces, starred and
/// recent items, workspace colors and the apps' theme. Read live, so a pin made in the console or on another device
/// reaches this one; written through the shared rules (`pinOrg`, `toggleStarred`, …) so every writer keeps the caps the
/// Firestore rules hold. Each change is shown at once and written in the background; a refused write puts the stored
/// value back on the next snapshot.
@MainActor
@Observable
public final class AccountPreferencesStore {
  public let uid: String
  /// Every pin as stored, which may be more than five for an account that pinned before the cap.
  public private(set) var storedPins: [String] = []
  /// Every site pin, each with its workspace (`pinnedHosts`, AGL-4005): as many a workspace as the person likes, one
  /// account-wide bound (AGL-4165). Shown at once on a pin; a refused write puts the stored list back.
  public private(set) var storedHostPins: [PinnedHost] = []
  public private(set) var recentOrgs: [String] = []
  public private(set) var starred: [StarredItem] = []
  public private(set) var recents: [RecentItem] = []
  public private(set) var workspaceColors: [String: String] = [:]
  public private(set) var appTheme: AppThemePrefs = ContractValues.shared.defaultAppTheme
  /// The phone's tab bar per site and per workspace (AGL-4006).
  public private(set) var tabBars: [TabBarPins] = []
  /// The profile's own picture, name and notification sound fields (`photoUrl`, `firstName`, `lastName`,
  /// `notificationSound`), the picture and name read through `photo(…)` and
  /// `name(…)` so the person shows as the console shows them (AGL-4010).
  public private(set) var identity: [String: String] = [:]
  /// False until the account's document has arrived once.
  public private(set) var loaded = false
  /// The last write that did not save, in words for the screen.
  public private(set) var writeError: String?

  /// The pins in force: the first five stored.
  public var pinned: [String] { effectivePinnedOrgs(storedPins) }
  /// Whether this account must be asked once which five pins to keep.
  public var mustPickPins: Bool { pinnedOrgsOverCap(storedPins) }

  @ObservationIgnored private let reader: FirestoreReader
  @ObservationIgnored private var listener: FirestoreListening?
  @ObservationIgnored private let now: () -> Date
  /// The site pins as the account document last said, which a refused write falls back to.
  @ObservationIgnored private var confirmedHostPins: [PinnedHost] = []

  public init(uid: String, reader: FirestoreReader, now: @escaping () -> Date = Date.init) {
    self.uid = uid
    self.reader = reader
    self.now = now
  }

  public func start() {
    guard listener == nil else { return }
    listener = reader.listenDocument(["users", uid]) { [weak self] result in
      guard let self, case .success(let doc) = result else { return }
      self.apply(doc?.data)
    }
  }

  public func stop() {
    listener?.remove()
    listener = nil
  }

  /// Takes a stored document's values, each read through the shared rules.
  func apply(_ data: [String: Any]?) {
    storedPins = readPinnedOrgs(data)
    confirmedHostPins = readPinnedHosts(data)
    if confirmedHostPins != storedHostPins { storedHostPins = confirmedHostPins }
    recentOrgs = readRecentOrgs(data)
    starred = readStarred(data)
    recents = readRecents(data)
    workspaceColors = readWorkspaceColors(data)
    appTheme = readAppTheme(data)
    tabBars = readTabBars(data)
    var identity: [String: String] = [:]
    let fields = ContractValues.shared
    for key in [fields.accountPhotoField, "firstName", "lastName", fields.notificationSoundField] {
      if let value = data?[key] as? String { identity[key] = value }
    }
    if identity != self.identity { self.identity = identity }
    loaded = true
  }

  /// The person's own picture: the profile's, else the sign-in record's, else nil (draw initials). A library pick is
  /// a `/api/media/cdn/...` path the caller resolves with `mediaPreviewURL`.
  public func photo(authPhotoURL: String?) -> String? { readAccountPhoto(identity, authPhotoURL: authPhotoURL) }

  /// The person's own name: the profile's first and last name, else the sign-in record's display name, else the email.
  public func name(authDisplayName: String?, email: String?) -> String {
    readAccountName(identity, authDisplayName: authDisplayName, email: email)
  }

  private var nowMs: Int { Int(now().timeIntervalSince1970 * 1000) }

  private func write(_ fields: [String: Any]) {
    let (reader, uid) = (reader, uid)
    Task { [weak self] in
      do {
        // Each field is replaced whole (the web SDK's `updateDoc`): a merge would keep a cleared workspace color.
        do {
          try await reader.updateDocument(["users", uid], fields)
        } catch {
          try await reader.setDocument(["users", uid], fields, merge: true)
        }
        self?.writeError = nil
      } catch {
        self?.writeError = "That change was not saved. Check the connection and try again."
      }
    }
  }

  // MARK: Pins

  /// Pins a workspace, or answers `.full` so the caller asks "Pinned is full. Replace one?".
  @discardableResult
  public func pin(_ orgID: String) -> PinOrgOutcome {
    let result = pinOrg(storedPins, orgID)
    if result.outcome == .pinned { setPins(result.pinned) }
    return result.outcome
  }

  public func unpin(_ orgID: String) { setPins(unpinOrg(storedPins, orgID)) }

  public func replacePin(_ replacing: String, with orgID: String) {
    setPins(replacePinnedOrg(storedPins, replacing: replacing, with: orgID))
  }

  public func movePin(_ orgID: String, by offset: Int) { setPins(movePinnedOrg(storedPins, orgID, offset: offset)) }

  /// Drag to reorder: the pins in the new order (the ids must be the current pins).
  public func reorderPins(_ order: [String]) {
    guard Set(order) == Set(pinned), order.count == pinned.count else { return }
    setPins(order)
  }

  /// The answer to "Keep which 5 pins?".
  public func keepPins(_ keep: [String]) { setPins(keepPinnedOrgs(storedPins, keep: keep)) }

  private func setPins(_ next: [String]) {
    guard next != storedPins else { return }
    storedPins = next
    write([ContractValues.shared.pinnedOrgsField: next])
  }

  // MARK: Site pins (AGL-4005, AGL-4165)

  /// One workspace's pinned site ids, in the order pinned.
  public func pinnedHosts(in orgID: String) -> [String] { workspacePinnedHosts(storedHostPins, orgID: orgID) }

  /// Whether this workspace holds every site pin the account keeps, so one more asks which to replace. Short of that a
  /// workspace is never full.
  public func hostPinsFull(in orgID: String) -> Bool {
    pinnedHosts(in: orgID).count >= ContractValues.shared.pinnedHostsMax
  }

  /// Pins a site, or unpins one that is pinned (the console's `usePinnedHosts().toggle`). Past the account-wide bound it
  /// answers `.full` and writes nothing, so the caller asks "Pinned is full. Replace one?".
  ///
  /// A pin or an unpin adds or removes ONE entry (`arrayUnion` / `arrayRemove`), so two devices pinning different sites
  /// never overwrite each other's list; a write that moves more (a site that changed workspace, the bound making room)
  /// writes the list.
  @discardableResult
  public func toggleHostPin(_ hostID: String, orgID: String) -> SitePinToggle {
    guard !hostID.isEmpty, !orgID.isEmpty else { return .none }
    if pinnedHosts(in: orgID).contains(hostID) {
      let removed = storedHostPins.filter { $0.hostId == hostID }
      writeHostPins(unpinHost(storedHostPins, hostID), FirestoreArrayChange.remove(removed.map(\.fields)))
      return .unpinned
    }
    let pin = PinnedHost(hostId: hostID, orgId: orgID)
    let result = pinHost(storedHostPins, pin)
    switch result.outcome {
    case .pinned:
      let appended = result.pinnedHosts.count == storedHostPins.count + 1
      let value: Any = appended ? FirestoreArrayChange.union([pin.fields]) : result.pinnedHosts.map(\.fields)
      writeHostPins(result.pinnedHosts, value)
      return .pinned
    case .full: return .full
    default: return .none
    }
  }

  /// Puts `hostID` where `replacing` was: the answer to "Pinned is full. Replace one?".
  public func replaceHostPin(_ replacing: String, with hostID: String, orgID: String) {
    let next = replacePinnedHost(storedHostPins, replacing: replacing, with: PinnedHost(hostId: hostID, orgId: orgID))
    guard next != storedHostPins else { return }
    writeHostPins(next, next.map(\.fields))
  }

  /// Shows `next` at once and writes `value` (a one-entry array change, or the whole list) the way the console does
  /// (`setDoc(…, { merge: true })`). A write the rules refuse puts the stored list back.
  private func writeHostPins(_ next: [PinnedHost], _ value: Any) {
    storedHostPins = next
    let (reader, uid) = (reader, uid)
    Task { [weak self] in
      do {
        try await reader.setDocument(["users", uid], [ContractValues.shared.pinnedHostsField: value], merge: true)
        self?.writeError = nil
      } catch {
        guard let self else { return }
        self.storedHostPins = self.confirmedHostPins
        self.writeError = "That pin was not saved. Check the connection and try again."
      }
    }
  }

  // MARK: Recent workspaces

  /// Notes a workspace was opened, newest first; nothing is written when it is already first.
  public func opened(orgID: String) {
    let next = recordRecentOrg(recentOrgs, orgID)
    guard next != recentOrgs, loaded else { return }
    recentOrgs = next
    write([ContractValues.shared.recentOrgsField: next])
  }

  // MARK: Starred and recents

  public func isStarred(_ item: AccountItemRef) -> Bool { starred.contains { $0.key == item.key } }

  /// Stars or unstars an item; `.full` when fifty are starred already.
  @discardableResult
  public func toggleStar(_ item: AccountItemRef) -> StarOutcome {
    let result = toggleStarred(starred, item, nowMs: nowMs)
    if result.outcome != .full {
      starred = result.starred
      write([ContractValues.shared.starredField: result.starred.map(\.fields)])
    }
    return result.outcome
  }

  public func setColor(_ color: StarColor?, forStar key: String) {
    let next = setStarColor(starred, key: key, color: color)
    guard next != starred else { return }
    starred = next
    write([ContractValues.shared.starredField: next.map(\.fields)])
  }

  /// Notes an item was opened; a repeat of the newest is not written again.
  public func opened(_ item: AccountItemRef) {
    guard loaded else { return }
    if let first = recents.first, first.key == item.key, first.label == item.label { return }
    let next = recordRecent(recents, item, nowMs: nowMs)
    recents = next
    write([ContractValues.shared.recentsField: next.map(\.fields)])
  }

  // MARK: Workspace colors and theme

  /// Picks a color for a workspace (`#RRGGBB`), or clears the pick with nil.
  public func setWorkspaceColor(_ color: String?, for orgID: String) {
    var next = workspaceColors
    if let color, isAccountColor(color) { next[orgID] = color.uppercased() } else { next[orgID] = nil }
    guard next != workspaceColors else { return }
    workspaceColors = next
    write([ContractValues.shared.workspaceColorsField: next])
  }

  public func setAppTheme(_ theme: AppThemePrefs) {
    guard theme != appTheme else { return }
    appTheme = theme
    write([ContractValues.shared.appThemeField: theme.fields])
  }

  // MARK: The phone's tab bar (AGL-4006)

  /// One site's or the whole workspace's pinned areas, in the person's order.
  public func tabAreas(scope: String) -> [String] { tabBarAreas(tabBars, scope: scope) }

  /// Pins an area to a scope's tab bar (long-press a tile → Add to tab bar); `.full` with four there already.
  @discardableResult
  public func pinTab(_ area: String, scope: String) -> TabPinOutcome {
    let result = pinTabArea(tabBars, scope: scope, area: area)
    if result.outcome == .pinned { setTabBars(result.tabBars) }
    return result.outcome
  }

  public func unpinTab(_ area: String, scope: String) { setTabBars(unpinTabArea(tabBars, scope: scope, area: area)) }

  public func moveTab(_ area: String, scope: String, by offset: Int) {
    setTabBars(moveTabArea(tabBars, scope: scope, area: area, offset: offset))
  }

  /// The Tab bar sheet's answer: these areas, in this order.
  public func setTabs(_ areas: [String], scope: String) { setTabBars(setTabAreas(tabBars, scope: scope, areas: areas)) }

  /// The default before anyone pins: an opened area takes a free spot and stays. Not before the document arrived, so a
  /// launch never writes over pins it has not read yet.
  public func openedArea(_ area: String, scope: String) {
    guard loaded else { return }
    setTabBars(autoPinTabArea(tabBars, scope: scope, area: area))
  }

  /// Forgets one scope's tab bar, as if nothing had been pinned or opened there: a debug launch's fresh start
  /// (`-AglynFreshTabBar`), so the first-open default can be driven on a seeded stack.
  public func forgetTabBar(scope: String) {
    guard loaded else { return }
    setTabBars(tabBars.filter { $0.scope != scope })
  }

  private func setTabBars(_ next: [TabBarPins]) {
    guard next != tabBars else { return }
    tabBars = next
    write([ContractValues.shared.tabBarsField: next.map { ["scope": $0.scope, "areas": $0.areas, "chosen": $0.chosen] }])
  }
}
