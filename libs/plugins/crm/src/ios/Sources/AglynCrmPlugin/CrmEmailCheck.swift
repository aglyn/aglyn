// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import SwiftUI

/*
 * WHAT IS KNOWN ABOUT A RECORD'S ADDRESS (the Kotlin `CrmEmailCheck.kt`; the
 * console's `email-state.ts`, `crm-email-state-chip.tsx`, `crm-email-check.tsx`
 * and `crm-send-email-button.tsx`): the record's own email state as a chip, the
 * mail gateway in front of the address and what it did with this site's mail
 * (`crm/email-check`), and the composer's warning before a one-to-one send. A
 * state that forbids email switches Send email off, with the reason.
 */

/// The record's email state (`EmailState`), as `readEmailState` holds it to its shape.
struct CrmEmailState: Equatable {
  let status: String
  let atMs: Int64
  let source: String
  let detail: String?
  var enrollmentID: String?
}

private let crmEmailStateSources = ["sequence", "campaign", "member", "check"]

/// `readEmailState`: the state a record holds, or nil when it holds none (most records).
func crmReadEmailState(_ record: [String: Any]?) -> CrmEmailState? {
  guard let raw = record?["emailState"] as? [String: Any], let status = raw["status"] as? String,
    ContractValues.shared.emailStateLabels[status] != nil
  else { return nil }
  let at = (raw["atMs"] as? NSNumber)?.doubleValue ?? 0
  let source = raw["source"] as? String
  let detail = (raw["detail"] as? String).flatMap { $0.isEmpty ? nil : $0 }
  let enrollment = (raw["enrollmentId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
  return CrmEmailState(
    status: status, atMs: at.isFinite && at > 0 ? Int64(at) : 0,
    source: source.map { crmEmailStateSources.contains($0) ? $0 : "campaign" } ?? "campaign", detail: detail, enrollmentID: enrollment)
}

/// `emailStateForbidsEmail`: every verdict but "Email OK" means the address must not be emailed by hand.
func crmEmailStateForbidsEmail(_ state: CrmEmailState?) -> Bool { state.map { $0.status != "ok" } ?? false }

/// `emailStateWhen`: the day the verdict was given ("Nov 14, 2023"), or "" when it is not known.
func crmEmailStateWhen(_ atMs: Int64, timeZone: TimeZone = .current) -> String {
  guard atMs > 0 else { return "" }
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_US")
  formatter.timeZone = timeZone
  formatter.dateStyle = .medium
  formatter.timeStyle = .none
  return formatter.string(from: Date(timeIntervalSince1970: Double(atMs) / 1000))
}

/// `emailStateRefusal`: why the record must not be emailed, in the sentence Send email's reason shows, or nil.
func crmEmailStateRefusal(_ state: CrmEmailState?, timeZone: TimeZone = .current) -> String? {
  guard let state, crmEmailStateForbidsEmail(state) else { return nil }
  let when = crmEmailStateWhen(state.atMs, timeZone: timeZone)
  let since = when.isEmpty ? "" : " on \(when)"
  let said = state.detail.map { " \($0)" } ?? ""
  switch state.status {
  case "undeliverable": return "Email to this address would bounce: its domain has no mail server\(since.isEmpty ? "" : " (checked\(since))").\(said)"
  case "bounced": return "Email to this address bounced\(since): the mailbox does not exist.\(said)"
  case "blocked": return "Their mail gateway blocked email to this address\(since).\(said)"
  case "unsubscribed": return "They unsubscribed\(since).\(said)"
  case "complained": return "They marked an email as spam\(since).\(said)"
  case "do_not_contact": return "On the do-not-contact list\(since).\(said)"
  default: return nil
  }
}

/// The chip's tone per state (`crm-email-state-chip.tsx`): the address failing reads as an error, a person's own act
/// as neutral, a complaint and a "Would bounce" prediction as a warning.
func crmEmailStateTone(_ status: String) -> AglynTone {
  switch status {
  case "ok": .success
  case "undeliverable", "complained": .warning
  case "bounced", "blocked": .error
  default: .neutral
  }
}

/// What `crm/email-check` answers about one address, sent from one site.
struct CrmEmailCheck: Equatable {
  var checked = false
  /// `no_mx`, `null_mx` or `gateway_held`; nil when nothing is wrong.
  var code: String?
  var message: String?
  var gateway: String?
  /// The gateway chip: its label and the server's tone (`refused`, `delivered`, `neutral`, `blocked`).
  var chip: (label: String, tone: String)?
  /// `banned` or `locked` on the house workspace's sites; nil everywhere else.
  var accountLock: String?

  static func == (lhs: CrmEmailCheck, rhs: CrmEmailCheck) -> Bool {
    lhs.checked == rhs.checked && lhs.code == rhs.code && lhs.message == rhs.message && lhs.gateway == rhs.gateway
      && lhs.chip?.label == rhs.chip?.label && lhs.chip?.tone == rhs.chip?.tone && lhs.accountLock == rhs.accountLock
  }
}

/// `readAnswer`: the route's answer held to its shape.
func crmEmailCheck(_ payload: JSONValue?) -> CrmEmailCheck {
  var check = CrmEmailCheck()
  check.checked = payload?["checked"]?.boolValue == true
  let code = payload?["code"]?.stringValue
  check.code = ["no_mx", "null_mx", "gateway_held"].contains(code ?? "") ? code : nil
  check.message = payload?["message"]?.stringValue
  check.gateway = payload?["gateway"]?.stringValue
  if let label = payload?["chip"]?["label"]?.stringValue, let tone = payload?["chip"]?["tone"]?.stringValue { check.chip = (label, tone) }
  let lock = payload?["accountLock"]?.stringValue
  check.accountLock = lock == "banned" || lock == "locked" ? lock : nil
  return check
}

/// `crmEmailCheckWarning`: the composer's warning before a one-to-one send, or nil.
func crmEmailCheckWarning(_ check: CrmEmailCheck?) -> String? {
  guard let check, check.code != nil, let message = check.message else { return nil }
  if check.code == "gateway_held" { return "\(message) A one-to-one email still goes, but it is likely to be refused too." }
  return "\(message) Sending will not reach them."
}

/// The gateway chip's tone (`TONE_COLOR`).
func crmGatewayTone(_ tone: String) -> AglynTone {
  switch tone {
  case "refused", "blocked": .error
  case "delivered": .success
  default: .neutral
  }
}

/// The gateway chip, or nil: none without a verdict, and none for a "blocked" domain when the record already says
/// "Would bounce" (the chip would say the same).
func crmGatewayChip(_ check: CrmEmailCheck?, state: CrmEmailState?) -> (label: String, tone: AglynTone)? {
  guard let chip = check?.chip else { return nil }
  if chip.tone == "blocked" && state?.status == "undeliverable" { return nil }
  return (chip.label, crmGatewayTone(chip.tone))
}

/// The account-lock chip (`CrmAccountLockChip`): why a record whose consent reads as given is skipped by every send.
func crmAccountLockChip(_ check: CrmEmailCheck?) -> (label: String, tone: AglynTone, reason: String)? {
  let brand = ContractValues.shared.platformBrandName
  switch check?.accountLock {
  case "banned":
    return (
      "Account banned", .error,
      "This address belongs to a \(brand) account banned for abuse. Nothing is sent to it — no campaign, sequence or one-to-one email — whatever its consent says. Lifting the ban restores it."
    )
  case "locked":
    return (
      "Account locked", .warning,
      "This address belongs to a locked \(brand) account. Our campaigns and sequences skip it until the lock is lifted; its consent is unchanged."
    )
  default: return nil
  }
}

/// Checks fetched in the last minute, by site and address: the record draws its chips and then opens the composer,
/// and both ask about the same address (the console's `remembered`).
@MainActor private var crmEmailChecksRemembered: [String: (atMs: Double, answer: CrmEmailCheck?)] = [:]

extension CrmAPI {
  /// `crm/email-check` for `email` from this scope's site, nil when it could not be had: a check that fails says
  /// nothing rather than something wrong.
  @MainActor func emailCheck(_ email: String?) async -> CrmEmailCheck? {
    let address = (email ?? "").trimmingCharacters(in: .whitespaces).lowercased()
    guard !address.isEmpty else { return nil }
    let key = "\(scope.hostID)|\(address)"
    let now = Date().timeIntervalSince1970 * 1000
    if let hit = crmEmailChecksRemembered[key], hit.atMs + 60_000 >= now { return hit.answer }
    let answer = (try? await api.request(CrmRoutes.emailCheck, method: .post, body: emailCheckBody(address))).map(crmEmailCheck)
    crmEmailChecksRemembered[key] = (now, answer)
    return answer
  }
}

/// The record's address chips (`contact-detail-page.tsx`, `lead-properties-card.tsx`): its email state first, then
/// the mail gateway, then an account lock; with the reason Send email is off under them, as the console's tooltip.
struct CrmEmailChips: View {
  let state: CrmEmailState?
  let check: CrmEmailCheck?

  var body: some View {
    let stateChip = state.map { (ContractValues.shared.emailStateLabels[$0.status] ?? $0.status, crmEmailStateTone($0.status)) }
    let gateway = crmGatewayChip(check, state: state)
    let lock = crmAccountLockChip(check)
    if stateChip != nil || gateway != nil || lock != nil {
      VStack(alignment: .leading, spacing: AglynSpace.half) {
        ViewThatFits(in: .horizontal) {
          HStack(spacing: AglynSpace.half) { chips(stateChip, gateway, lock) }
          VStack(alignment: .leading, spacing: AglynSpace.half) { chips(stateChip, gateway, lock) }
        }
        if let state, let refusal = crmEmailStateRefusal(state) {
          Text(refusal).font(AglynFont.caption).foregroundStyle(.secondary).accessibilityIdentifier("crm-email-state-reason")
        } else if let reason = lock?.reason {
          Text(reason).font(AglynFont.caption).foregroundStyle(.secondary)
        } else if let message = check?.message, gateway != nil {
          Text(message).font(AglynFont.caption).foregroundStyle(.secondary)
        }
      }
    }
  }

  @ViewBuilder
  private func chips(_ state: (String, AglynTone)?, _ gateway: (label: String, tone: AglynTone)?, _ lock: (label: String, tone: AglynTone, reason: String)?)
    -> some View
  {
    if let state { StatusChip(state.0, tone: state.1).accessibilityIdentifier("crm-email-state") }
    if let gateway { StatusChip(gateway.label, tone: gateway.tone).accessibilityIdentifier("crm-email-gateway") }
    if let lock { StatusChip(lock.label, tone: lock.tone).accessibilityIdentifier("crm-account-lock") }
  }
}
