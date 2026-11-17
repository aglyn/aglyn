// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.core

import kotlinx.coroutines.withTimeoutOrNull

/*
 * An invitee who signs up lands in the workspace they were invited to, with no workspace of their own (AGL-4047, the console's
 * #2706). The sign-up form asks everyone for a workspace name, because it cannot know about an invitation before the account
 * exists without telling a stranger which addresses have one. So the choice is made after the account exists, from the verified
 * account's own invitations: while one is waiting, or is being or has just been joined, nothing is created, and the automatic
 * join opens the newest invited workspace. The name the form held is left untouched, so a person whose invitation is withdrawn
 * before any join still gets the workspace they named. The Apple kit's `InviteeLanding.swift`.
 */

/**
 * Newest first (the console's `newestInvitesFirst`). Undated invitations keep their order after every dated one, so an answer
 * without dates reads exactly as it did before.
 */
fun newestInvitesFirst(invites: List<PendingInvite>): List<PendingInvite> =
  invites.withIndex().sortedWith { a, b ->
    val aMs = a.value.createdAtMs
    val bMs = b.value.createdAtMs
    when {
      aMs != null && bMs != null && aMs != bMs -> bMs.compareTo(aMs)
      aMs == null && bMs != null -> 1
      aMs != null && bMs == null -> -1
      else -> a.index.compareTo(b.index)
    }
  }.map { it.value }

/** The newest invitation, or null for none (`latestInvite`). */
fun latestInvite(invites: List<PendingInvite>): PendingInvite? = newestInvitesFirst(invites).firstOrNull()

/** What the first verified session of an account with no workspace settled on (`settleFirstRun`). */
sealed interface FirstRunSettlement {
  /** An invitation is waiting, or being or just joined: nothing was claimed or created (AGL-4047). */
  data object Invited : FirstRunSettlement

  /** No held name to create. */
  data object NothingHeld : FirstRunSettlement

  /** The held name's workspace, and the plan the account remembered, if any. */
  data class Created(val slug: String, val plan: OnboardingPlanIntent?) : FirstRunSettlement

  /** The held name's workspace could not be created. */
  data class Failed(val pending: PendingSignUpWorkspace, val error: String?) : FirstRunSettlement
}

/** How long a verified sign-up waits to learn whether an invitation is waiting for it (`SIGN_UP_INVITE_CHECK_MS`). */
const val SIGN_UP_INVITE_CHECK_MS = 3_000L

/**
 * Is an invitation waiting for this verified account (`hasPendingInvite`)? Asked with the account's own token, so only the holder
 * of a confirmed address ever learns it has one. False on a refusal, a failure or no answer inside the deadline: the caller then
 * provisions as before, which is the worst case this replaces.
 */
suspend fun SignUpService.hasPendingInvite(deadlineMs: Long = SIGN_UP_INVITE_CHECK_MS): Boolean =
  withTimeoutOrNull(deadlineMs) { pendingInvites().isNotEmpty() } ?: false

/**
 * A verified sign-up door's workspace (`provisionAndLandSignUp`): null when an invitation is waiting, and nothing is created,
 * because the automatic join opens the invited workspace and one made here would be one the person never asked for, and the one
 * they would land in instead.
 */
suspend fun SignUpService.provisionVerifiedSignUp(name: String, deadlineMs: Long = SIGN_UP_INVITE_CHECK_MS): SignUpWorkspaceOutcome? {
  if (hasPendingInvite(deadlineMs)) return null
  return createWorkspace(name)
}

/**
 * The first verified session of an account with no workspace (the console's chooser, AGL-2590): the name the sign-up held is
 * claimed once and its workspace created, and the remembered plan is taken for where it lands. With an invitation waiting, or one
 * the automatic join is joining or has just joined ([joiningAnInvite]: it leaves the server's list before its membership reaches
 * the workspace list), the held name is not claimed and nothing is created. [claiming] is called once the account is known to
 * have no invitation, just before the claim, so an invitee never sees "Setting up your workspace…".
 */
suspend fun SignUpService.settleFirstRun(
  uid: String,
  providers: List<String>,
  joiningAnInvite: Boolean,
  deadlineMs: Long = SIGN_UP_INVITE_CHECK_MS,
  claiming: () -> Unit = {},
): FirstRunSettlement {
  if (joiningAnInvite) return FirstRunSettlement.Invited
  if (hasPendingInvite(deadlineMs)) return FirstRunSettlement.Invited
  claiming()
  val pending = claimHeldWorkspace(uid, providers) ?: return FirstRunSettlement.NothingHeld
  val outcome = createWorkspace(pending.name)
  val slug = outcome.slug ?: return FirstRunSettlement.Failed(pending, outcome.error)
  return FirstRunSettlement.Created(slug, consumePlanIntent(uid))
}
