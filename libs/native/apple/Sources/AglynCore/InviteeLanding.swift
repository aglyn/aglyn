// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// An invitee who signs up lands in the workspace they were invited to, with no workspace of their own (AGL-4047, the
/// console's #2706). The sign-up form asks everyone for a workspace name, because it cannot know about an invitation
/// before the account exists without telling a stranger which addresses have one. So the choice is made after the
/// account exists, from the verified account's own invitations: while one is waiting, or is being or has just been
/// joined, nothing is created, and the automatic join opens the newest invited workspace. The name the form held is
/// left untouched, so a person whose invitation is withdrawn before any join still gets the workspace they named.

/// Newest first (the console's `newestInvitesFirst`). Undated invitations keep their order after every dated one, so an
/// answer without dates reads exactly as it did before.
public func newestInvitesFirst(_ invites: [PendingInvite]) -> [PendingInvite] {
  invites.enumerated().sorted { a, b in
    switch (a.element.createdAtMs, b.element.createdAtMs) {
    case let (aMs?, bMs?) where aMs != bMs: return aMs > bMs
    case (nil, _?): return false
    case (_?, nil): return true
    default: return a.offset < b.offset
    }
  }.map(\.element)
}

/// The newest invitation, or nil for none (`latestInvite`).
public func latestInvite(_ invites: [PendingInvite]) -> PendingInvite? {
  newestInvitesFirst(invites).first
}

/// What the first verified session of an account with no workspace settled on (`settleFirstRun`).
public enum FirstRunSettlement: Equatable, Sendable {
  /// An invitation is waiting, or being or just joined: nothing was claimed or created (AGL-4047).
  case invited
  /// No held name to create.
  case nothingHeld
  /// The held name's workspace, and the plan the account remembered, if any.
  case created(slug: String, plan: OnboardingPlanIntent?)
  /// The held name's workspace could not be created.
  case failed(PendingSignUpWorkspace, error: String?)
}

extension SignUpService {
  /// How long a verified sign-up waits to learn whether an invitation is waiting for it (`SIGN_UP_INVITE_CHECK_MS`).
  public static let inviteCheckDeadlineNanoseconds: UInt64 = 3_000_000_000

  /// Is an invitation waiting for this verified account (`hasPendingInvite`)? Asked with the account's own token, so only
  /// the holder of a confirmed address ever learns it has one. False on a refusal, a failure or no answer inside the
  /// deadline: the caller then provisions as before, which is the worst case this replaces.
  public func hasPendingInvite(deadlineNanoseconds: UInt64 = inviteCheckDeadlineNanoseconds) async -> Bool {
    await withTaskGroup(of: Bool.self) { group in
      group.addTask { await !self.pendingInvites().isEmpty }
      group.addTask {
        try? await Task.sleep(nanoseconds: deadlineNanoseconds)
        return false
      }
      let first = await group.next() ?? false
      group.cancelAll()
      return first
    }
  }

  /// A verified sign-up door's workspace (`provisionAndLandSignUp`): nil when an invitation is waiting, and nothing is
  /// created, because the automatic join opens the invited workspace and one made here would be one the person never
  /// asked for, and the one they would land in instead.
  public func provisionVerifiedSignUp(
    name: String, deadlineNanoseconds: UInt64 = inviteCheckDeadlineNanoseconds
  ) async -> SignUpWorkspaceOutcome? {
    if await hasPendingInvite(deadlineNanoseconds: deadlineNanoseconds) { return nil }
    return await createWorkspace(name: name)
  }

  /// The first verified session of an account with no workspace (the console's chooser, AGL-2590): the name the sign-up
  /// held is claimed once and its workspace created, and the remembered plan is taken for where it lands. With an
  /// invitation waiting, or one the automatic join is joining or has just joined (`joiningAnInvite`: it leaves the
  /// server's list before its membership reaches the workspace list), the held name is not claimed and nothing is created.
  /// `claiming` is called once the account is known to have no invitation, just before the claim, so an invitee never
  /// sees "Setting up your workspace…".
  public func settleFirstRun(
    uid: String, providers: [String], reader: FirestoreReader, joiningAnInvite: Bool,
    deadlineNanoseconds: UInt64 = inviteCheckDeadlineNanoseconds, claiming: @MainActor @Sendable () -> Void = {}
  ) async -> FirstRunSettlement {
    if joiningAnInvite { return .invited }
    if await hasPendingInvite(deadlineNanoseconds: deadlineNanoseconds) { return .invited }
    await claiming()
    guard let pending = await claimHeldWorkspace(uid: uid, providers: providers, reader: reader) else { return .nothingHeld }
    let outcome = await createWorkspace(name: pending.name)
    guard let slug = outcome.slug else { return .failed(pending, error: outcome.error) }
    return .created(slug: slug, plan: await consumePlanIntent(uid: uid, reader: reader))
  }
}
