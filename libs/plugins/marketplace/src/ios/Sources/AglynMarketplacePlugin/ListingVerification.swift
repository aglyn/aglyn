// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import Foundation
import SwiftUI

/*
 * The publisher's door to the Verified badge (AGL-1217): the console's `ListingVerificationRequest`, on the listing page
 * the publisher opens from Sell, below the listing's own header as the console puts it below the review card. Request
 * verification, Withdraw request, and the decline with when they may ask again. Whether they may ask is
 * `verificationRequestBlock`, ported from listing-verification.ts and replayed from the console's own cases; the route
 * decides again. The Kotlin plugin's ListingVerification.kt draws the same.
 */

/// Days a publisher waits after a decline before asking again (`VERIFICATION_DECLINE_COOLDOWN_DAYS`).
let verificationDeclineCooldownDays = 30.0

/// The console route that takes the ask and its withdrawal.
let verificationRequestRoute = "/api/marketplace/verification-request"

/// A stored time in epoch milliseconds, as `timestampMs` reads it: a Firestore timestamp (a `Date` here), or
/// `{ seconds }` as the cases carry it; nil for anything else.
func verificationTimestampMs(_ value: Any?) -> Double? {
  if let date = value as? Date { return date.timeIntervalSince1970 * 1000 }
  if let seconds = (value as? [String: Any])?["seconds"] as? NSNumber { return seconds.doubleValue * 1000 }
  return nil
}

/// Why a publisher may not ask for the badge right now, nil when they may (`verificationRequestBlock`): not the
/// publishing workspace, already verified, not listed yet, already waiting, or declined within the cooldown. An undated
/// decline fails closed.
func verificationRequestBlock(listing: [String: Any]?, viewerOrgID: String?, nowMs: Double) -> String? {
  guard let listing, let viewerOrgID, !viewerOrgID.isEmpty, listing["profileId"] as? String == viewerOrgID else {
    return "not-publisher"
  }
  let status = listing["reviewStatus"] as? String
  if status == "verified" { return "already-verified" }
  if status != "listed" { return "not-listed" }
  let request = listing["verificationRequest"] as? [String: Any]
  let state = request?["state"] as? String
  if state == "pending" { return "already-pending" }
  if state == "declined" {
    guard let decidedAt = verificationTimestampMs(request?["decidedAt"]) else { return "cooling-down" }
    if (nowMs - decidedAt) / 86_400_000 < verificationDeclineCooldownDays { return "cooling-down" }
  }
  return nil
}

/// What the badge claims, said where someone asks for it. The platform's name, never a white-label brand: it names who
/// did the verifying.
var whatVerifiedClaims: String {
  "Verified says a human at \(ContractValues.shared.platformBrandName) confirmed who you are, "
    + "and that this listing describes what the code does. It is a claim about "
    + "you as a publisher, so it survives a version bump. It is not a security "
    + "guarantee, and it does not review the bytes of any particular release — "
    + "that is what Reviewed means, and it is earned per version."
}

/// The Verified publisher card: drawn for the publisher of a plugin listing that is listed (or whose ask is waiting).
struct ListingVerificationSection: View {
  let context: NativePluginContext
  let listingID: String
  /// The listing document's fields.
  let listing: [String: Any]
  @State private var runner = PluginActionRunner()
  @State private var agreed = false
  /// The action just taken, so the card does not sit unchanged while the listing document catches up.
  @State private var justDid: String?

  private var canAsk: Bool { context.canInWorkspace(publisherProfileKey) }
  private var request: [String: Any]? { listing["verificationRequest"] as? [String: Any] }
  private var state: String? { justDid ?? request?["state"] as? String }
  private var block: String? {
    verificationRequestBlock(listing: listing, viewerOrgID: context.orgID, nowMs: Date().timeIntervalSince1970 * 1000)
  }

  /// Whether the card shows at all: nothing for another workspace's listing or one already verified, and nothing for a
  /// listing still in review that has no ask waiting.
  static func shows(_ block: String?, state: String?) -> Bool {
    block != "not-publisher" && block != "already-verified" && !(block == "not-listed" && state != "pending")
  }

  var body: some View {
    let block = block
    if Self.shows(block, state: state) {
      Section {
        Text(whatVerifiedClaims).font(AglynFont.subheadline).foregroundStyle(.secondary)
        if state == "pending" {
          AglynNotice("Your request is with the review team. Your plugin stays listed and installable while they look.", tone: .info)
          PublisherAgreementCheckbox(isOn: $agreed, enabled: !runner.busy && canAsk)
          Button(runner.busy ? "Withdrawing…" : "Withdraw request") { post("withdraw") }
            .buttonStyle(.aglynSecondary)
            .disabled(runner.busy || !canAsk || !agreed)
            .accessibilityIdentifier("listing-verification-withdraw")
        } else if block == "cooling-down" {
          AglynNotice(declined, tone: .warning)
        } else {
          PublisherAgreementCheckbox(isOn: $agreed, enabled: !runner.busy && canAsk && block == nil)
          Button(runner.busy ? "Requesting…" : "Request verification") { post("request") }
            .buttonStyle(.aglynProminent)
            .disabled(runner.busy || !canAsk || block != nil || !agreed)
            .accessibilityIdentifier("listing-verification-request")
        }
        // Why asking is off, named; not under the cooling-down notice, which has no button to explain.
        if !canAsk && !(block == "cooling-down" && state != "pending") {
          Text(context.refusal(publisherProfileKey)).font(AglynFont.caption).foregroundStyle(.secondary)
        }
        if let error = runner.error { AglynNotice(error, tone: .error) { runner.error = nil } }
      } header: {
        Text("Verified publisher")
      }
      .accessibilityIdentifier("listing-verification")
    }
  }

  /// The decline, and when they may ask again.
  private var declined: String {
    let reason = (request?["declineReason"] as? String).map { "Declined: \($0)" } ?? "A previous request was declined."
    let again = verificationTimestampMs(request?["decidedAt"]).map {
      let date = Date(timeIntervalSince1970: ($0 + verificationDeclineCooldownDays * 86_400_000) / 1000)
      return "You can ask again from \(date.formatted(date: .numeric, time: .omitted))."
    }
    return reason + "\n" + (again ?? "You can ask again \(Int(verificationDeclineCooldownDays)) days after the decision.")
  }

  private func post(_ action: String) {
    let consent = PublisherAgreementConsent.current
    runner.run(onDone: {
      justDid = action == "request" ? "pending" : "withdrawn"
      agreed = false
    }) {
      try await context.api.request(
        verificationRequestRoute, method: .post,
        body: JSONValue.from(["listingId": listingID, "action": action, "agreement": consent.body]))
    }
  }
}
