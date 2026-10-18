// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import Observation

public struct WorkspaceOrg: Equatable, Hashable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let slug: String
  public let role: String

  public init(id: String, name: String, slug: String, role: String) {
    self.id = id
    self.name = name
    self.slug = slug
    self.role = role
  }
}

public struct WorkspaceSite: Equatable, Hashable, Identifiable, Sendable {
  public let id: String
  public let orgID: String
  public let name: String
  public let subdomain: String
  public let role: String

  public init(id: String, orgID: String, name: String, subdomain: String, role: String) {
    self.id = id
    self.orgID = orgID
    self.name = name
    self.subdomain = subdomain
    self.role = role
  }
}

/// The workspace and site the person picked.
public struct WorkspacePick: Equatable, Codable, Sendable {
  public var orgID: String?
  public var hostID: String?

  public init(orgID: String?, hostID: String?) {
    self.orgID = orgID
    self.hostID = hostID
  }
}

/// The workspace (org) and site switcher's state.
///
/// Reads the same per-user indexes the console's switchers read, under the
/// same rules: `users/{uid}/orgs` for workspaces and
/// `users/{uid}/hostMemberships` (where `orgId ==`, by `nameLower`, the
/// console's own indexed query) for sites. The pick is remembered per person
/// on the device, and a remembered org or site the person no longer belongs
/// to is dropped rather than shown.
@MainActor
@Observable
public final class WorkspaceStore {
  /// The workspace window the switcher loads; matches the console's first page.
  public static let orgWindow = 50
  public static let siteWindow = 100

  public private(set) var orgs: [WorkspaceOrg] = []
  /// Whether the workspace window is full, so the list is not known to be complete (the console's `hasMoreOrgs`);
  /// `loadMoreOrgs` grows it.
  public private(set) var hasMoreOrgs = false
  /// How many memberships the listener holds: a page, not a ceiling (the console's `ORG_PAGE_SIZE`, AGL-2336).
  public private(set) var orgWindowSize = WorkspaceStore.orgWindow
  public private(set) var sites: [WorkspaceSite] = []
  public private(set) var error: String?
  /// False until the org list (and, with an org, its sites) has arrived once.
  public var ready: Bool { orgsLoaded && (orgs.isEmpty || sitesLoaded) }

  public var effective: WorkspacePick {
    orgsLoaded
      ? Self.reconcile(picked, orgs: orgs, sites: sitesLoaded ? sites : nil)
      : WorkspacePick(orgID: nil, hostID: nil)
  }
  public var org: WorkspaceOrg? { orgs.first { $0.id == effective.orgID } }
  public var site: WorkspaceSite? { sites.first { $0.id == effective.hostID } }

  public let uid: String
  @ObservationIgnored private let reader: FirestoreReader
  @ObservationIgnored private let defaults: UserDefaults
  private var picked: WorkspacePick
  private var orgsLoaded = false
  private var sitesLoaded = false
  @ObservationIgnored private var orgListener: FirestoreListening?
  @ObservationIgnored private var siteListener: FirestoreListening?
  @ObservationIgnored private var sitesFor: String?
  /// The site a console link named by its address (`/{orgSlug}/hosts/{hostSlug}/…`) before its workspace's sites arrived.
  @ObservationIgnored private var pendingHostSlug: String?
  /// The workspace a console link named by address before the person's workspaces arrived (a link that launched the app).
  @ObservationIgnored private var pendingOrgSlug: String?

  public static func storageKey(_ uid: String) -> String { "aglyn.workspace.\(uid)" }

  public init(uid: String, reader: FirestoreReader, defaults: UserDefaults = .standard) {
    self.uid = uid
    self.reader = reader
    self.defaults = defaults
    if let raw = defaults.data(forKey: Self.storageKey(uid)),
      let restored = try? JSONDecoder().decode(WorkspacePick.self, from: raw)
    {
      picked = restored
    } else {
      picked = WorkspacePick(orgID: nil, hostID: nil)
    }
  }

  public func start() {
    guard orgListener == nil else { return }
    let window = orgWindowSize
    orgListener = reader.listen(
      FirestoreQuery(["users", uid, "orgs"], limit: window)
    ) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs):
        self.error = nil
        self.hasMoreOrgs = docs.count >= window
        self.orgs = docs.map { Self.org(from: $0) }.sorted {
          $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
        self.orgsLoaded = true
        if let slug = self.pendingOrgSlug {
          let hostSlug = self.pendingHostSlug
          (self.pendingOrgSlug, self.pendingHostSlug) = (nil, nil)
          self.select(orgSlug: slug, hostSlug: hostSlug)
        }
        self.syncSites()
      case .failure:
        self.error = "Could not load your workspaces."
      }
    }
  }

  /// Grows the workspace window by a page (the console's `loadMoreOrgs`) and listens again with it.
  public func loadMoreOrgs() {
    orgWindowSize += Self.orgWindow
    orgListener?.remove()
    orgListener = nil
    start()
  }

  /// Reads the workspaces (and the shown workspace's sites) again now, as after this person created a workspace:
  /// a listener that polls would otherwise show none until its next read. What is shown stays until the answer lands.
  public func reload() {
    orgListener?.remove()
    siteListener?.remove()
    orgListener = nil
    siteListener = nil
    sitesFor = nil
    start()
  }

  public func stop() {
    orgListener?.remove()
    siteListener?.remove()
    orgListener = nil
    siteListener = nil
    sitesFor = nil
  }

  public func selectOrg(_ orgID: String) {
    pendingOrgSlug = nil
    pendingHostSlug = nil
    picked = WorkspacePick(orgID: orgID, hostID: nil)
    syncSites()
  }

  /// Picks a workspace and one of its sites at once, as a notification about
  /// that site does; the site holds once the workspace's sites name it.
  public func select(orgID: String, hostID: String?) {
    pendingOrgSlug = nil
    pendingHostSlug = nil
    picked = WorkspacePick(orgID: orgID, hostID: hostID)
    syncSites()
  }

  public func selectSite(_ hostID: String?) {
    pendingOrgSlug = nil
    pendingHostSlug = nil
    picked.hostID = hostID
    persist()
  }

  /// Picks the workspace and site a console link names by address (`/{orgSlug}/hosts/{hostSlug}/…`), so the screen it
  /// opens reads them; each is matched (the workspace by slug or id, the site by subdomain or id) at once when the
  /// lists are here and otherwise as soon as they arrive, as for a link that launched the app. Returns false, changing
  /// nothing, when the person's workspaces are here and none is that one.
  @discardableResult
  public func select(orgSlug: String, hostSlug: String?) -> Bool {
    guard orgsLoaded else {
      pendingOrgSlug = orgSlug
      pendingHostSlug = hostSlug
      return true
    }
    guard let org = orgs.first(where: { $0.slug == orgSlug || $0.id == orgSlug }) else { return false }
    let sitesHere = sitesLoaded && sitesFor == org.id
    let site = hostSlug.flatMap { slug in sitesHere ? sites.first { $0.subdomain == slug || $0.id == slug } : nil }
    if let site {
      if org.id != effective.orgID || site.id != effective.hostID { select(orgID: org.id, hostID: site.id) }
    } else if org.id != effective.orgID {
      select(orgID: org.id, hostID: nil)
      pendingHostSlug = hostSlug
    } else if hostSlug != nil, !sitesHere {
      pendingHostSlug = hostSlug
    }
    return true
  }

  /// Keeps the site listener on the org that is actually shown.
  private func syncSites() {
    let orgID = Self.reconcile(picked, orgs: orgs, sites: nil).orgID
    // A remembered org that is gone (or none yet) gives way to the first one,
    // and that org's first site is then picked like any other.
    if orgsLoaded && orgID != picked.orgID { picked = WorkspacePick(orgID: orgID, hostID: nil) }
    if orgID != sitesFor {
      siteListener?.remove()
      siteListener = nil
      sitesFor = orgID
      sites = []
      sitesLoaded = false
      if let orgID {
        siteListener = reader.listen(
          FirestoreQuery(
            ["users", uid, "hostMemberships"], equals: [("orgId", orgID)],
            order: [.init("nameLower")], limit: Self.siteWindow)
        ) { [weak self] result in
          guard let self, self.sitesFor == orgID else { return }
          switch result {
          case .success(let docs):
            self.error = nil
            self.sites = docs.map { Self.site(from: $0) }
            self.sitesLoaded = true
            if let slug = self.pendingHostSlug {
              self.pendingHostSlug = nil
              if let site = self.sites.first(where: { $0.subdomain == slug || $0.id == slug }) { self.picked.hostID = site.id }
            }
            self.persist()
          case .failure:
            self.error = "Could not load the sites in this workspace."
          }
        }
      }
    }
    persist()
  }

  /// Remembers what is actually shown, so a stale pick heals on disk too.
  private func persist() {
    guard orgsLoaded, let data = try? JSONEncoder().encode(effective) else { return }
    defaults.set(data, forKey: Self.storageKey(uid))
  }

  public static func org(from doc: FirestoreDocument) -> WorkspaceOrg {
    let slug = doc.string("slug")
    return WorkspaceOrg(
      id: doc.id, name: doc.string("orgName") ?? slug ?? doc.id, slug: slug ?? doc.id,
      role: doc.string("role") ?? "")
  }

  public static func site(from doc: FirestoreDocument) -> WorkspaceSite {
    let subdomain = doc.string("subdomain") ?? ""
    return WorkspaceSite(
      id: doc.id, orgID: doc.string("orgId") ?? "",
      name: doc.string("displayName") ?? (subdomain.isEmpty ? doc.id : subdomain),
      subdomain: subdomain, role: doc.string("role") ?? "")
  }

  /// Which org and site to show, given what is remembered and what exists.
  public static func reconcile(
    _ picked: WorkspacePick, orgs: [WorkspaceOrg], sites: [WorkspaceSite]?
  ) -> WorkspacePick {
    let orgID = orgs.contains { $0.id == picked.orgID } ? picked.orgID : orgs.first?.id
    if orgID != picked.orgID { return WorkspacePick(orgID: orgID, hostID: nil) }
    guard let sites else { return WorkspacePick(orgID: orgID, hostID: picked.hostID) }
    let hostID = sites.contains { $0.id == picked.hostID } ? picked.hostID : sites.first?.id
    return WorkspacePick(orgID: orgID, hostID: hostID)
  }
}
