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
  /// The site's favicon as the membership row mirrors it (`favicon`, the host's `seo.favicon`): a reference, a CDN path
  /// or an address, shown through `mediaPreviewURL` as the console's `HostIcon` resolves it.
  public let favicon: String?
  /// The site's custom domain, as the membership row mirrors it (`cname`); older rows lack it.
  public let cname: String?

  public init(
    id: String, orgID: String, name: String, subdomain: String, role: String, favicon: String? = nil, cname: String? = nil
  ) {
    self.id = id
    self.orgID = orgID
    self.name = name
    self.subdomain = subdomain
    self.role = role
    self.favicon = favicon
    self.cname = cname
  }

  /// The address a person knows the site by: its custom domain, else its platform address (the Sites list's rule).
  public var shownAddress: String { cname ?? HostStatus.siteAddress(subdomain) ?? subdomain }

  /// The same once the host document is read (the Sites list's order): the host's own custom domain, else the
  /// membership mirror's, else `<slug>.aglyn.app`, so a mirror written before it carried `cname` still shows the address
  /// the live site answers on.
  public func shownAddress(hostCname: String?) -> String {
    hostCname.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 } ?? shownAddress
  }
}

/// What a workspace's own document says about how it looks: its logos (`logoUrl`, `logoDarkUrl`), its brand color
/// (`brandingProfile.primaryColor`, white-label workspaces) and the plan it is on. The membership index carries none of
/// them, so the console's switcher reads each workspace's document for them, and so does this store.
public struct WorkspaceOrgLogo: Equatable, Hashable, Sendable {
  public let light: String?
  public let dark: String?
  /// `#RRGGBB` when the workspace set a brand color.
  public let brandColor: String?
  /// The effective plan's id (`free`, `pro`, …), nil while unknown.
  public let plan: String?
  /// The plugins the workspace turned on, as stored (`enabledPlugins`); nil when it never chose, which reads as the
  /// defaults (`resolveEnabledPlugins`).
  public let enabledPlugins: [String]?
  /// The plan's payment failed and is owed (`past_due` or `unpaid`): Home says so and opens Billing.
  public let paymentDue: Bool
  /// The workspace's own release-flag overrides (`releaseFlags`), which staff set for one workspace.
  public let releaseFlags: [String: Bool]

  public init(
    light: String?, dark: String?, brandColor: String? = nil, plan: String? = nil, enabledPlugins: [String]? = nil,
    paymentDue: Bool = false, releaseFlags: [String: Bool] = [:]
  ) {
    self.paymentDue = paymentDue
    self.releaseFlags = releaseFlags
    self.light = light
    self.dark = dark
    self.brandColor = brandColor
    self.plan = plan
    self.enabledPlugins = enabledPlugins
  }

  public init(_ doc: FirestoreDocument?) {
    func text(_ key: String) -> String? { doc?.string(key).flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 } }
    let branding = doc?.data["brandingProfile"] as? [String: Any]
    let brand = (branding?["primaryColor"] as? String)?.trimmingCharacters(in: .whitespaces)
    self.init(
      light: text("logoUrl"), dark: text("logoDarkUrl"),
      brandColor: brand.flatMap { $0.range(of: "^#[0-9A-Fa-f]{6}$", options: .regularExpression) != nil ? $0 : nil },
      plan: doc.map { effectivePlan($0.data) },
      enabledPlugins: (doc?.data["enabledPlugins"] as? [Any])?.compactMap { $0 as? String },
      paymentDue: {
        let mirrored = doc?.string("billingStatus")
        let status = (mirrored?.isEmpty == false ? mirrored : nil)
          ?? ((doc?.data["subscription"] as? [String: Any])?["status"] as? String)
        return status == "past_due" || status == "unpaid"
      }(),
      releaseFlags: ((doc?.data["releaseFlags"] as? [String: Any]) ?? [:]).compactMapValues { $0 as? Bool })
  }

  /// The plan as the console names it ("Pro").
  public var planLabel: String? { plan.map { OnboardingPlanIntent.planLabels[$0] ?? $0.capitalized } }
}

/// A site's own plugin choices, as its document keeps them: the plugins it turned off, and the default-off ones it
/// opted into (`resolveHostEnabledPlugins` reads both against the workspace's).
public struct SitePluginChoices: Equatable, Sendable {
  public let disabled: [String]?
  public let enabled: [String]?

  public init(disabled: [String]?, enabled: [String]?) {
    self.disabled = disabled
    self.enabled = enabled
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

  /// Every workspace the store knows: the window the switcher pages through, plus the ones read on their own (a pin or
  /// a recent workspace past the window), A to Z.
  public var orgs: [WorkspaceOrg] {
    guard !extraOrgs.isEmpty else { return windowOrgs }
    let inWindow = Set(windowOrgs.map(\.id))
    return (windowOrgs + extraOrgs.values.filter { !inWindow.contains($0.id) }).sorted {
      $0.name.localizedStandardCompare($1.name) == .orderedAscending
    }
  }
  /// The membership window, A to Z.
  public private(set) var windowOrgs: [WorkspaceOrg] = []
  /// Workspaces read one by one (`loadOrgs`), by id.
  public private(set) var extraOrgs: [String: WorkspaceOrg] = [:]
  /// How many workspaces the person belongs to (the server's count), nil until it has answered.
  public private(set) var orgCount: Int?
  /// Whether the workspace window is full, so the list is not known to be complete (the console's `hasMoreOrgs`);
  /// `loadMoreOrgs` grows it.
  public private(set) var hasMoreOrgs = false
  /// How many memberships the listener holds: a page, not a ceiling (the console's `ORG_PAGE_SIZE`, AGL-2336).
  public private(set) var orgWindowSize = WorkspaceStore.orgWindow
  public private(set) var sites: [WorkspaceSite] = []
  /// Each workspace's logos read so far, by workspace id: the shown workspace's always, the others' once the switcher
  /// asks for them (`loadLogos`).
  public private(set) var orgLogos: [String: WorkspaceOrgLogo] = [:]
  public private(set) var error: String?
  /// The shown site's own plugin choices (`disabledPlugins`, `enabledPlugins`), read live; nil until read.
  public private(set) var sitePlugins: SitePluginChoices?
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
  @ObservationIgnored private var logoListeners: [String: FirestoreListening] = [:]
  @ObservationIgnored private var orgReads: [String: FirestoreListening] = [:]
  @ObservationIgnored private var siteDocListener: FirestoreListening?
  @ObservationIgnored private var watchedHostID: String?
  /// A workspace picked by id before its membership row was read (a search result past the window).
  @ObservationIgnored private var waitingPick: WorkspacePick?
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
    if orgCount == nil { Task { await countOrgs() } }
    orgListener = reader.listen(
      FirestoreQuery(["users", uid, "orgs"], limit: window)
    ) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs):
        self.error = nil
        self.hasMoreOrgs = docs.count >= window
        self.windowOrgs = docs.map { Self.org(from: $0) }.sorted {
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

  /// Asks the server how many workspaces the person belongs to (the rail's "All workspaces (N)").
  public func countOrgs() async {
    if let count = try? await reader.count(FirestoreQuery(["users", uid, "orgs"])) { orgCount = count }
  }

  /// Reads each of these workspaces' membership rows that the window does not hold (a pin or a recent workspace past
  /// the first page), once, so the rail can show them and the switcher can pick them. A row that is gone stays unread,
  /// so a workspace the person left never shows.
  public func loadOrgs(_ orgIDs: [String]) {
    let inWindow = Set(windowOrgs.map(\.id))
    for orgID in orgIDs where !orgID.isEmpty && !inWindow.contains(orgID) && extraOrgs[orgID] == nil && orgReads[orgID] == nil {
      let listener = reader.listenDocument(["users", uid, "orgs", orgID]) { [weak self] result in
        guard let self else { return }
        if case .success(let doc?) = result { self.extraOrgs[orgID] = Self.org(from: doc) }
        self.orgReads[orgID]?.remove()
        self.orgReads[orgID] = nil
        if let waiting = self.waitingPick, waiting.orgID == orgID {
          self.waitingPick = nil
          if self.extraOrgs[orgID] != nil { self.select(orgID: orgID, hostID: waiting.hostID) }
        }
      }
      if extraOrgs[orgID] != nil { listener.remove() } else { orgReads[orgID] = listener }
    }
  }

  public func stop() {
    siteDocListener?.remove()
    siteDocListener = nil
    watchedHostID = nil
    orgReads.values.forEach { $0.remove() }
    orgReads = [:]
    orgListener?.remove()
    siteListener?.remove()
    orgListener = nil
    siteListener = nil
    sitesFor = nil
    logoListeners.values.forEach { $0.remove() }
    logoListeners = [:]
  }

  /// The shown workspace's logo, as its document has it; nil until read, or when it has none.
  public var orgLogo: WorkspaceOrgLogo? { effective.orgID.flatMap { orgLogos[$0] } }

  /// Reads each of these workspaces' logos from its own document, once (the console's switcher reads its rows' logos
  /// the same way, `useOrgRows`). The shown workspace's is read live, so a new logo reaches the footer.
  public func loadLogos(_ orgIDs: [String], live: Bool = false) {
    for orgID in orgIDs where logoListeners[orgID] == nil && (live || orgLogos[orgID] == nil) {
      let listener = reader.listenDocument(["orgs", orgID]) { [weak self] result in
        guard let self else { return }
        if case .success(let doc) = result { self.orgLogos[orgID] = WorkspaceOrgLogo(doc) }
        if !live {
          self.logoListeners[orgID]?.remove()
          self.logoListeners[orgID] = nil
        }
      }
      // An answer from the cache can land before the listener is kept; a one-time read then ends at once.
      if !live && orgLogos[orgID] != nil { listener.remove() } else { logoListeners[orgID] = listener }
    }
  }

  /// Picks a workspace by id whether or not the window holds it: one past the window is read first, then picked.
  public func open(orgID: String, hostID: String? = nil) {
    if orgs.contains(where: { $0.id == orgID }) {
      select(orgID: orgID, hostID: hostID)
    } else {
      waitingPick = WorkspacePick(orgID: orgID, hostID: hostID)
      loadOrgs([orgID])
    }
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
      if let orgID { loadLogos([orgID], live: true) }
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

  /// Keeps a live read of the shown site's document for its plugin choices.
  private func watchSite() {
    let hostID = effective.hostID
    guard hostID != watchedHostID else { return }
    watchedHostID = hostID
    siteDocListener?.remove()
    siteDocListener = nil
    sitePlugins = nil
    guard let hostID else { return }
    siteDocListener = reader.listenDocument(["hosts", hostID]) { [weak self] result in
      guard let self, self.watchedHostID == hostID, case .success(let doc) = result else { return }
      func ids(_ key: String) -> [String]? { (doc?.data[key] as? [Any])?.compactMap { $0 as? String } }
      self.sitePlugins = SitePluginChoices(disabled: ids("disabledPlugins"), enabled: ids("enabledPlugins"))
    }
  }

  /// Remembers what is actually shown, so a stale pick heals on disk too.
  private func persist() {
    watchSite()
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
      subdomain: subdomain, role: doc.string("role") ?? "",
      favicon: doc.string("favicon").flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 },
      cname: doc.string("cname").flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 })
  }

  /// Whether the site that was on screen (`shownOrgID`'s `shownHostID`) has left that workspace's loaded sites: deleted
  /// (here, on the web or on another device) or taken away from the person. The shell then shows the whole workspace's
  /// Sites, never another site in its place: whatever screen of the gone site was open, its Danger zone included, would
  /// otherwise stay open on the next site.
  nonisolated public static func shownSiteRemoved(
    shownOrgID: String?, shownHostID: String?, orgID: String?, sites: [WorkspaceSite], ready: Bool
  ) -> Bool {
    guard let shownHostID, ready, orgID == shownOrgID else { return false }
    return !sites.contains { $0.id == shownHostID }
  }

  /// Follows the site a window shows and says when it has gone (`shownSiteRemoved`), so the window leaves for the
  /// workspace's Sites. It remembers the picked site whatever the scope: a Sites row picks the site before the window
  /// steps inside it, so a site remembered only while inside was never remembered at all. Only a window inside the
  /// site leaves; one on the whole workspace already shows it.
  public struct ShownSiteWatch: Equatable, Sendable {
    public private(set) var shown: WorkspacePick?
    public init() {}

    /// Notes what is on screen now; true when the window inside the site it showed should leave for Sites.
    public mutating func update(
      orgID: String?, pickedHostID: String?, sites: [WorkspaceSite], ready: Bool, inSite: Bool
    ) -> Bool {
      let removed = WorkspaceStore.shownSiteRemoved(
        shownOrgID: shown?.orgID, shownHostID: shown?.hostID, orgID: orgID, sites: sites, ready: ready)
      if ready { shown = WorkspacePick(orgID: orgID, hostID: pickedHostID) }
      return removed && inSite
    }
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
