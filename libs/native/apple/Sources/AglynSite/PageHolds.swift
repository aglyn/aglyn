// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

// A site's held and flagged pages (the console's `PageHoldChips` and `PageHoldBanner`, AGL-3374): what the automated
// safety review holds, flags or did not approve, from `GET /api/hosts/page-holds`. A chip per status on the page's
// row, and on the page itself a banner per hold saying what happened, what visitors see meanwhile, and the three things
// the owner can do: View details (the notice on Holds & reviews), Request a review (there too), Contact support. There
// is no release: that is staff's decision, and nothing here can make it. The Kotlin kit's PageHolds.kt.

/// What a hold is shown on: the page, or a layout or component a held page renders.
public struct HeldPageTarget: Equatable, Sendable {
  public let type: String
  public let id: String

  public init(type: String, id: String) {
    self.type = type
    self.id = id
  }
}

/// One open page hold, as the route hands it over (`PageHoldView`).
public struct PageHold: Equatable, Identifiable, Sendable {
  public let noticeID: String
  /// `page-held` or `page-flagged`.
  public let kind: String
  /// `held`, `in-review`, `rejected`…; nil when the notice has no review row.
  public let status: String?
  public let chipLabel: String
  /// `warning`, `error` or `info`.
  public let chipColor: String
  public let label: String
  public let details: [String]
  public let visitorSentence: String
  public let targets: [HeldPageTarget]
  public let reference: String?
  public let reviewable: Bool
  public let reviewRequestedAt: Date?
  public var id: String { noticeID }

  public init(
    noticeID: String, kind: String, status: String?, chipLabel: String, chipColor: String, label: String,
    details: [String] = [], visitorSentence: String, targets: [HeldPageTarget], reference: String? = nil,
    reviewable: Bool = false, reviewRequestedAt: Date? = nil
  ) {
    self.noticeID = noticeID
    self.kind = kind
    self.status = status
    self.chipLabel = chipLabel
    self.chipColor = chipColor
    self.label = label
    self.details = details
    self.visitorSentence = visitorSentence
    self.targets = targets
    self.reference = reference
    self.reviewable = reviewable
    self.reviewRequestedAt = reviewRequestedAt
  }

  init?(_ json: JSONValue) {
    guard let id = json["noticeId"]?.stringValue, !id.isEmpty else { return nil }
    self.init(
      noticeID: id, kind: json["kind"]?.stringValue ?? "page-held", status: json["status"]?.stringValue,
      chipLabel: json["chip"]?["label"]?.stringValue ?? "Held", chipColor: json["chip"]?["color"]?.stringValue ?? "warning",
      label: json["label"]?.stringValue ?? "a page on your site",
      details: json["details"]?.arrayValue?.compactMap(\.stringValue) ?? [],
      visitorSentence: json["visitorSentence"]?.stringValue ?? "",
      targets: json["targets"]?.arrayValue?.compactMap { target in
        guard let type = target["type"]?.stringValue, let id = target["id"]?.stringValue else { return nil }
        return HeldPageTarget(type: type, id: id)
      } ?? [],
      reference: json["reference"]?.stringValue, reviewable: json["reviewable"]?.boolValue == true,
      reviewRequestedAt: json["reviewRequestedAtMs"]?.numberValue.map { Date(timeIntervalSince1970: $0 / 1000) })
  }

  public var tone: AglynTone {
    switch chipColor {
    case "error": .error
    case "info": .info
    default: .warning
    }
  }
}

/// `holdsForTarget`: the holds shown on one document.
public func holdsForTarget(_ holds: [PageHold], _ target: HeldPageTarget) -> [PageHold] {
  holds.filter { $0.targets.contains(target) }
}

/// One chip per status, however many holds share it, in the order first seen (`PageHoldChips`).
public func pageHoldChips(_ holds: [PageHold]) -> [PageHold] {
  var seen = Set<String>()
  return holds.filter { seen.insert($0.chipLabel).inserted }
}

/// What the banner says (`pageHoldBannerCopy`): what happened to which page, the facts beside it, and what visitors get
/// meanwhile. On a layout or component the hold is on a PAGE that renders it, so the page is named first.
public func pageHoldBannerCopy(_ hold: PageHold, target: HeldPageTarget, timeZone: TimeZone = .current) -> (title: String, lines: [String]) {
  let what =
    hold.status == "rejected"
    ? "was not approved after review, and is not being served"
    : hold.kind == "page-flagged"
      ? "was flagged by our automated safety review and is being looked at by a person"
      : "is held for review by our automated safety review"
  let name = hold.label.prefix(1).uppercased() + hold.label.dropFirst()
  let title = target.type == "screen" ? "\(name) \(what)." : "\(name), which uses this \(target.type), \(what)."
  var lines = hold.details + [hold.visitorSentence]
  if let at = hold.reviewRequestedAt {
    var style = Date.FormatStyle(date: .numeric, time: .shortened)
    style.timeZone = timeZone
    lines.append("A review was requested on \(at.formatted(style)).")
  }
  if let reference = hold.reference { lines.append("Reference \(reference).") }
  return (title, lines.filter { !$0.isEmpty })
}

/// The route's answer.
public struct PageHoldsAnswer: Equatable, Sendable {
  public let holds: [PageHold]
  public let orgID: String?
  /// Whether THIS reader may ask for a review ("Holds and reviews" over the whole workspace).
  public let canRequestReview: Bool
}

public func fetchPageHolds(api: ConsoleAPIClient, hostID: String) async throws -> PageHoldsAnswer {
  let answer = try await api.request("/api/hosts/page-holds", method: .get, query: [("hostId", hostID)])
  return PageHoldsAnswer(
    holds: answer?["holds"]?.arrayValue?.compactMap(PageHold.init) ?? [], orgID: answer?["orgId"]?.stringValue,
    canRequestReview: answer?["canRequestReview"]?.boolValue == true)
}

/// The console links a banner's buttons follow: Holds & reviews for View details, the notice there with its review
/// request open for Request a review (`?notice=`, which the native Holds screen opens as the request), and the support
/// tickets.
public func pageHoldDetailsLink(orgSlug: String) -> String { "/\(orgSlug)/settings/holds" }
public func pageHoldReviewLink(orgSlug: String, noticeID: String) -> String { "/\(orgSlug)/settings/holds?notice=\(noticeID)" }
public func pageHoldSupportLink(orgSlug: String) -> String { "/\(orgSlug)/support/tickets" }

/// The chips on a page's row.
struct PageHoldChips: View {
  let holds: [PageHold]

  var body: some View {
    ForEach(pageHoldChips(holds)) { hold in
      StatusChip(hold.chipLabel, tone: hold.tone)
        .help(holdsForChip(hold).map { "\($0.label): \($0.visitorSentence)" }.joined(separator: " "))
        .accessibilityIdentifier("page-hold-chip")
    }
  }

  private func holdsForChip(_ chip: PageHold) -> [PageHold] { holds.filter { $0.chipLabel == chip.chipLabel } }
}

/// The banner on a page: one notice per hold on it.
struct PageHoldBanner: View {
  let context: NativePluginContext
  let answer: PageHoldsAnswer?
  let target: HeldPageTarget

  var body: some View {
    if let answer {
      ForEach(holdsForTarget(answer.holds, target)) { hold in
        let copy = pageHoldBannerCopy(hold, target: target)
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          HStack(spacing: AglynSpace.one) {
            StatusChip(hold.chipLabel, tone: hold.tone)
            Text(copy.title).font(AglynFont.strongSubheadline)
          }
          ForEach(copy.lines, id: \.self) { Text($0).font(AglynFont.subheadline) }
          if hold.reviewable && !answer.canRequestReview {
            Text("Requesting a review takes the \"Holds and reviews\" permission, which owners and admins hold by default.")
              .font(AglynFont.caption).foregroundStyle(.secondary)
          }
          if let orgSlug = context.orgSlug {
            AglynWrapRow(spacing: AglynSpace.one, lineSpacing: AglynSpace.one) {
              Button("View details") { _ = context.openLink(pageHoldDetailsLink(orgSlug: orgSlug)) }
                .buttonStyle(.aglynSecondary).accessibilityIdentifier("page-hold-details")
              if hold.reviewable && answer.canRequestReview && answer.orgID != nil {
                // The request itself is made on the notice, where its note is written (Holds & reviews).
                Button("Request a review") { _ = context.openLink(pageHoldReviewLink(orgSlug: orgSlug, noticeID: hold.noticeID)) }
                  .buttonStyle(.aglynSecondary).accessibilityIdentifier("page-hold-request-review")
              }
              Button("Contact support") { _ = context.openLink(pageHoldSupportLink(orgSlug: orgSlug)) }
                .buttonStyle(.borderless).accessibilityIdentifier("page-hold-support")
            }
          }
        }
        .padding(AglynSpace.two)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(hold.tone.color.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("page-hold-banner")
      }
    }
  }
}
