// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import Observation
import SwiftUI

/// The plan card's meters (AGL-3992; P10, Figma plan card 98:1048): the console's Billing › Usage meters, each read from
/// the source the page reads and held to the same entitlement, which the card rotates through slowly. Which meter leads
/// for the screen in front and how the rest follow is the shared contract's (`plan-card-meters.ts`), so the Apple and
/// Kotlin cards agree. A meter whose read failed, or that the plan does not cap, is left out.
@MainActor
@Observable
final class PlanMeters {
  struct Meter: Equatable, Identifiable {
    let id: String
    let label: String
    let used: Double
    let limit: Double
    let unit: String
    var share: Double { used / limit }
    /// The console meter's own readout: "412.3 / 1024 MB", "3 / 3".
    var figures: String { "\(jsNumberString(used)) / \(jsNumberString(limit))\(unit.isEmpty ? "" : " \(unit)")" }
  }

  private(set) var readings: [PlanCardReading] = []
  private(set) var plan = "Free"
  @ObservationIgnored private var loadedFor: String?

  /// The meters to draw, in the contract's order for this context.
  func meters(context: String?) -> [Meter] {
    let values = ContractValues.shared
    let byID = Dictionary(readings.map { ($0.meter, $0) }, uniquingKeysWith: { first, _ in first })
    return planCardMeterOrder(readings, context: context).compactMap { id in
      guard let reading = byID[id], let used = reading.used, let limit = reading.limit else { return nil }
      return Meter(
        id: id, label: values.planCardMeterLabels[id] ?? id, used: used, limit: limit, unit: values.planCardMeterUnits[id] ?? "")
    }
  }

  func load(_ model: AppModel, hostID: String?) async {
    let sites = model.workspace?.sites.map(\.id) ?? []
    let key = "\(model.workspace?.org?.id ?? ""):\(hostID ?? ""):\(sites.joined(separator: ","))"
    guard let api = model.api, let reader = model.reader, let org = model.workspace?.org, loadedFor != key else { return }
    loadedFor = key
    readings = []
    guard let ent = try? await api.request("/api/orgs/entitlements", query: [("orgId", org.id)]) else { return }
    let quotas = ent["quotas"]
    plan = ent["plan"]?.stringValue.map { OnboardingPlanIntent.planLabels[$0] ?? $0.capitalized } ?? "Free"
    /// A quota as the entitlements route sends it: a number, or null for an unlimited one.
    func quota(_ name: String) -> Double? { quotas?[name]?.numberValue }
    let month = String(ISO8601DateFormatter().string(from: Date()).prefix(7))

    let limits = (
      bandwidth: quota("bandwidthGb"), emailSends: quota("emailSendsPerMonth"), dataStorage: quota("dataStorageMbPerOrg"),
      seats: quota("managersPerOrg"), pages: quota("screensPerHost"), forms: quota("formsPerHost"), sites: quota("hostLimit"))
    let scopes = sites.map { ("hostId", $0) } + [("orgId", org.id)]
    // Every read at once; each answers its own meter, or nil when it could not.
    async let storage = Self.storage(api, orgID: org.id)
    async let bandwidth = Self.bandwidth(api, scopes: scopes, limit: limits.bandwidth)
    async let emailSends = Self.emailSends(reader, orgID: org.id, month: month, limit: limits.emailSends)
    async let aiCredits = Self.aiCredits(api, orgID: org.id)
    async let dataStorage = Self.dataStorage(reader, orgID: org.id, month: month, limit: limits.dataStorage)
    async let seats = Self.seats(api, orgID: org.id, limit: limits.seats)
    async let pages = Self.pages(api, hostID: hostID, limit: limits.pages)
    async let forms = Self.forms(reader, hostID: hostID, limit: limits.forms)
    let siteCount = PlanCardReading(meter: "sites", used: Double(sites.count), limit: limits.sites)

    let all = await [storage, bandwidth, emailSends, aiCredits, dataStorage, seats, pages, forms].compactMap { $0 } + [siteCount]
    guard loadedFor == key else { return }
    readings = all
  }

  /// Storage (organization): the pool `/api/media/storage` answers, in MB to a tenth, against its allowance.
  private static func storage(_ api: ConsoleAPIClient, orgID: String) async -> PlanCardReading? {
    guard let body = try? await api.request("/api/media/storage", query: [("orgId", orgID)]),
      let usedBytes = body["usedBytes"]?.numberValue
    else { return nil }
    let limit = body["unlimited"]?.boolValue == true ? nil : body["allowanceMb"]?.numberValue
    return PlanCardReading(meter: "storage", used: (usedBytes / (1024 * 1024) * 10).rounded() / 10, limit: limit)
  }

  /// Bandwidth (this month): every site's and the org library's, summed as the Usage page sums them; one unreadable
  /// scope and the meter waits rather than reading low.
  private static func bandwidth(_ api: ConsoleAPIClient, scopes: [(String, String)], limit: Double?) async -> PlanCardReading? {
    var total = 0.0
    for scope in scopes {
      guard let body = try? await api.request("/api/billing/host-usage", query: [(scope.0, scope.1)]),
        let gb = body["bandwidthGb"]?.numberValue
      else { return nil }
      total += gb
    }
    return PlanCardReading(meter: "bandwidth", used: (total * 100).rounded() / 100, limit: limit)
  }

  /// Campaign emails (this month): the org's counter for the month, where a plan sells a band.
  private static func emailSends(_ reader: FirestoreReader, orgID: String, month: String, limit: Double?) async -> PlanCardReading? {
    guard let limit, limit > 0,
      let document = await readDocument(reader, ["orgs", orgID, "counters", "campaignEmailSends"])
    else { return nil }
    return PlanCardReading(meter: "emailSends", used: (document?.data[month] as? NSNumber)?.doubleValue ?? 0, limit: limit)
  }

  /// AI credits (this month): the pool `/api/ai/billing/credits` answers.
  private static func aiCredits(_ api: ConsoleAPIClient, orgID: String) async -> PlanCardReading? {
    guard let body = try? await api.request("/api/ai/billing/credits", query: [("orgId", orgID)]),
      let used = body["credits"]?["used"]?.numberValue
    else { return nil }
    return PlanCardReading(meter: "aiCredits", used: used, limit: body["credits"]?["limit"]?.numberValue)
  }

  /// Data storage: the monthly rollup's figure, this month's or else last month's.
  private static func dataStorage(_ reader: FirestoreReader, orgID: String, month: String, limit: Double?) async -> PlanCardReading? {
    guard let limit else { return nil }
    let previous = Calendar(identifier: .gregorian).date(byAdding: .month, value: -1, to: Date()) ?? Date()
    for key in [month, String(ISO8601DateFormatter().string(from: previous).prefix(7))] {
      guard let document = await readDocument(reader, ["orgs", orgID, "usage", key]) else { return nil }
      if let used = (document?.data["dataStorageMb"] as? NSNumber)?.doubleValue {
        return PlanCardReading(meter: "dataStorage", used: used, limit: limit)
      }
    }
    return nil
  }

  /// Team seats (incl. you): the manager seats `/api/orgs/members?counts=1` counts.
  private static func seats(_ api: ConsoleAPIClient, orgID: String, limit: Double?) async -> PlanCardReading? {
    guard let limit, let body = try? await api.request("/api/orgs/members", query: [("orgId", orgID), ("counts", "1")]),
      let used = body["managerSeats"]?.numberValue
    else { return nil }
    return PlanCardReading(meter: "seats", used: used, limit: limit)
  }

  /// Pages: the site's billable screens, as `/api/hosts/usage` counts them.
  private static func pages(_ api: ConsoleAPIClient, hostID: String?, limit: Double?) async -> PlanCardReading? {
    guard let hostID, let limit, let body = try? await api.request("/api/hosts/usage", query: [("hostId", hostID)]),
      let used = body["screens"]?.numberValue
    else { return nil }
    return PlanCardReading(meter: "pages", used: used, limit: limit)
  }

  /// Saved forms: the site's form catalog, counted.
  private static func forms(_ reader: FirestoreReader, hostID: String?, limit: Double?) async -> PlanCardReading? {
    guard let hostID, let limit, let used = try? await reader.count(FirestoreQuery(["hosts", hostID, "forms"])) else { return nil }
    return PlanCardReading(meter: "forms", used: Double(used), limit: limit)
  }

  /// One document, read once: nil when the read failed, `.some(nil)` when it does not exist.
  private static func readDocument(_ reader: FirestoreReader, _ path: [String]) async -> FirestoreDocument?? {
    await withCheckedContinuation { continuation in
      var listener: FirestoreListening?
      var answered = false
      listener = reader.listenDocument(path) { result in
        guard !answered else { return }
        answered = true
        listener?.remove()
        switch result {
        case .success(let document): continuation.resume(returning: .some(document))
        case .failure: continuation.resume(returning: nil)
        }
      }
    }
  }

  /// The dismissal's key: this workspace, and the meters at their warning share with their limits, so a new crossing
  /// (or a new limit) shows the card again.
  static func dismissKey(orgID: String, meters: [Meter]) -> String {
    let near = meters.filter { $0.share >= ContractValues.shared.planCardWarningShare }
      .map { "\($0.id)@\(jsNumberString($0.limit))" }.sorted().joined(separator: ",")
    return "aglyn.planCard.\(orgID).\(near)"
  }
}

/// The plan card at the foot of the sidebar: a slow carousel of the workspace's usage meters, the one that fits the screen
/// in front first, with page dots. It pauses under the pointer, a touch or VoiceOver, and steps only by hand under Reduce
/// Motion. Upgrade opens Billing at the plans; the card itself opens Billing › Usage.
struct PlanCard: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
  @State private var meters = PlanMeters()
  @State private var index = 0
  @State private var hovering = false
  @State private var touching = false
  @State private var dismissed = false

  /// The screen in front, as the nav manifest names it, for the contract's context.
  private var screen: String? {
    switch navigation.section {
    case .home: ContractValues.shared.planCardHomeScreen
    case .analytics: "shell.analytics"
    case .plugin(let id): id
    case .place(let id, _): id
    default: nil
    }
  }

  var body: some View {
    let site = model.scopedSite(navigation)
    let context = planCardContext(screen, inSite: navigation.inSite)
    let shown = meters.meters(context: context)
    // A stack, never a bare Group: a Group with nothing in it hands its task to no view, so the meters were never read.
    VStack(spacing: 0) {
      Color.clear.frame(height: 0)
      if let orgID = model.workspace?.org?.id, !dismissed,
        planCardShows(meters.readings, offersUpgrade: model.offersUpgrade),
        !UserDefaults.standard.bool(forKey: PlanMeters.dismissKey(orgID: orgID, meters: shown)), !shown.isEmpty
      {
        card(shown, site: site, orgID: orgID)
      }
    }
    .task(id: "\(model.workspace?.org?.id ?? ""):\(site?.id ?? ""):\(model.workspace?.sites.count ?? 0)") {
      dismissed = false
      await meters.load(model, hostID: site?.id)
    }
    // A new context starts at its own meter.
    .onChange(of: context) { _, _ in index = 0 }
    .task(id: "\(shown.map(\.id).joined(separator: ","))|\(reduceMotion)|\(voiceOver)") {
      // The slow advance: one meter every PLAN_CARD_ADVANCE_MS, never under Reduce Motion or VoiceOver, held while the
      // pointer or a finger is on the card.
      guard shown.count > 1, !reduceMotion, !voiceOver else { return }
      let interval = UInt64(ContractValues.shared.planCardAdvanceMs) * 1_000_000
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: interval)
        if Task.isCancelled { return }
        if !hovering && !touching {
          withAnimation(.easeInOut(duration: 0.6)) { index = (index + 1) % shown.count }
        }
      }
    }
  }

  private func card(_ shown: [PlanMeters.Meter], site: WorkspaceSite?, orgID: String) -> some View {
    let meter = shown[min(index, shown.count - 1)]
    let full = meter.used >= meter.limit
    return VStack(alignment: .leading, spacing: 8) {
      Text("\(site?.name ?? model.workspace?.org?.name ?? "") · \(meters.plan) plan")
        .font(.system(size: 12)).foregroundStyle(AglynColor.secondaryText).lineLimit(1)
      // The meter, cross-faded as the card moves on (Figma plan card 98:1048: the title and Upgrade, the bar, then the
      // figures with the page dots at the trailing edge).
      // One layer per meter in a ZStack, so the outgoing and incoming meters cross-fade in place rather than stack.
      ZStack(alignment: .topLeading) {
      VStack(alignment: .leading, spacing: 8) {
        HStack(spacing: 8) {
          Text(meter.label).font(.system(size: AglynShellMetrics.rowText, weight: .semibold))
            .foregroundStyle(AglynColor.textPrimary).lineLimit(1)
          Spacer(minLength: 0)
          Button("Upgrade") { upgrade() }
            .buttonStyle(.plain)
            .font(.system(size: AglynShellMetrics.rowText))
            .foregroundStyle(AglynColor.tint)
            .accessibilityIdentifier("plan-card-upgrade")
        }
        // The console's meter: the accent below 80%, amber from 80%, red at the limit.
        GeometryReader { proxy in
          ZStack(alignment: .leading) {
            Capsule().fill(AglynColor.sunken)
            Capsule()
              .fill(
                full
                  ? AglynColor.error
                  : meter.share >= ContractValues.shared.planCardWarningShare
                    ? AglynColor.intent({ $0.warning }, \.main) : AglynColor.primary)
              .frame(width: proxy.size.width * min(1, meter.share))
          }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
      }
      .id(meter.id)
      .transition(.opacity)
      }
      // The figures never truncate: with many meters the dots take their own row under them.
      ViewThatFits(in: .horizontal) {
        HStack(spacing: 8) {
          figures(meter)
          Spacer(minLength: 0)
          if shown.count > 1 { dots(shown) }
        }
        VStack(alignment: .leading, spacing: 4) {
          figures(meter)
          if shown.count > 1 { dots(shown).frame(maxWidth: .infinity) }
        }
      }
      .frame(minHeight: 16)
    }
    .padding(Self.cardPadding)
    .background(RoundedRectangle(cornerRadius: AglynShellMetrics.cardRadius, style: .continuous).fill(AglynColor.paper))
    .overlay(RoundedRectangle(cornerRadius: AglynShellMetrics.cardRadius, style: .continuous).strokeBorder(AglynColor.divider))
    .contentShape(RoundedRectangle(cornerRadius: AglynShellMetrics.cardRadius, style: .continuous))
    // The card opens Billing › Usage, where every meter is.
    .onTapGesture { openUsage() }
    .onHover { hovering = $0 }
    .simultaneousGesture(
      DragGesture(minimumDistance: 0).onChanged { _ in touching = true }.onEnded { _ in touching = false })
    .contextMenu {
      Button("Hide until a limit is near", systemImage: "eye.slash") {
        UserDefaults.standard.set(true, forKey: PlanMeters.dismissKey(orgID: orgID, meters: shown))
        dismissed = true
      }
    }
    .padding(EdgeInsets(top: 0, leading: AglynShellMetrics.rowInset, bottom: 12, trailing: AglynShellMetrics.rowInset))
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(meter.label), \(meter.figures) on the \(meters.plan) plan")
    .accessibilityValue(shown.count > 1 ? "\(index + 1) of \(shown.count)" : "")
    .accessibilityAdjustableAction { direction in
      switch direction {
      case .increment: index = (index + 1) % shown.count
      case .decrement: index = (index - 1 + shown.count) % shown.count
      @unknown default: break
      }
    }
    .accessibilityAction(named: "Upgrade") { upgrade() }
    .accessibilityAction(named: "Open usage") { openUsage() }
    .accessibilityIdentifier("plan-card")
  }

  private func figures(_ meter: PlanMeters.Meter) -> some View {
    ZStack(alignment: .leading) {
      Text(meter.figures).font(.system(size: 12)).foregroundStyle(AglynColor.secondaryText).monospacedDigit()
        .lineLimit(1).fixedSize()
        .id("figures-\(meter.id)")
        .transition(.opacity)
    }
  }

  /// The card's inset: Figma's Compact 10, Touch 12.
  #if os(macOS)
    static let cardPadding: CGFloat = 10
  #else
    static let cardPadding: CGFloat = 12
  #endif

  /// The page dots: the meter in front in the accent; each one steps to its meter.
  private func dots(_ shown: [PlanMeters.Meter]) -> some View {
    HStack(spacing: 4) {
      ForEach(Array(shown.enumerated()), id: \.element.id) { offset, meter in
        Button {
          withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.4)) { index = offset }
        } label: {
          Circle()
            .fill(offset == index ? AglynColor.primary : AglynColor.divider)
            .frame(width: 6, height: 6)
            .padding(3)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(meter.label)
        .accessibilityIdentifier("plan-card-dot-\(meter.id)")
      }
    }
  }

  /// Billing, at the plans (the console's "Upgrade" link).
  private func upgrade() {
    navigation.enter(.workspaceSettings, first: .plugin("core.billing"))
  }

  /// Billing › Usage, every meter the card rotates through.
  private func openUsage() {
    navigation.enter(.workspaceSettings, first: .plugin("core.billing.usage"))
  }
}

extension AppModel {
  /// Whether the workspace menu offers "Upgrade plan", as the console's menu does: once the plan is known, below the top
  /// plans (Agency, Enterprise), for an owner or admin who can open Billing.
  var offersUpgrade: Bool {
    guard let org = workspace?.org, let plan = workspace?.orgLogos[org.id]?.plan,
      registry.screen("core.billing") != nil
    else { return false }
    return !["agency", "enterprise"].contains(plan) && ["owner", "admin"].contains(org.role)
  }
}
