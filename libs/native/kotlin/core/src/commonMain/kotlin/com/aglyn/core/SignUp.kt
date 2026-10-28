package com.aglyn.core

import io.ktor.http.decodeURLQueryComponent
import io.ktor.http.encodeURLParameter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

/**
 * The plan a visitor picked on the marketing pricing page, carried on the sign-up link (`aglyn://signup?plan=pro&interval=year`,
 * or the console's `/signup?plan=…`): the console's `parseOnboardingPlanIntent` (libs/aglyn/src/lib/app-utils/onboarding-deep-link.ts).
 * Twin of the Apple kit's `OnboardingPlanIntent`.
 */
data class OnboardingPlanIntent(
  val plan: String,
  /** `month` or `year`. */
  val interval: String,
  /** Whether the link said an interval, rather than [interval] being the default. */
  val intervalStated: Boolean,
  /** Enterprise is quoted, not bought: it goes to contact sales. */
  val contactSales: Boolean,
  /** The AI add-on, asked for alongside the plan (`ai=1`). */
  val ai: Boolean = false,
) {
  /** The canonical query (`onboardingPlanQuery`): `plan=pro&interval=year&ai=1`. */
  val query: String
    get() = "plan=${plan.encodeURLParameter()}" + (if (intervalStated) "&interval=$interval" else "") + (if (ai) "&ai=1" else "")

  val label: String get() = PLAN_LABELS[plan] ?: plan.replaceFirstChar { it.uppercase() }

  /** Where a new workspace lands with this intent (`onboardingDestination`). */
  fun destination(orgSlug: String): String =
    if (contactSales) "/$orgSlug/support?topic=enterprise" else "/$orgSlug/billing?$query"

  /** The sign-up form's subheading for this intent. */
  val signUpHeadline: String
    get() = if (contactSales) {
      "Create your account — we’ll get you set up on $label"
    } else {
      "Create your account to start on $label, billed ${if (interval == "year") "yearly" else "monthly"}"
    }

  companion object {
    /** The plans a checkout can sell (`SELF_SERVE_PLANS`). */
    val SELF_SERVE_PLANS = listOf("starter", "pro", "business", "scale", "advanced", "agency")

    /** `PLAN_LABELS` (libs/aglyn/src/lib/app-utils/plan-entitlements.ts). */
    val PLAN_LABELS = mapOf(
      "free" to "Free", "starter" to "Starter", "pro" to "Pro", "business" to "Business", "scale" to "Scale",
      "advanced" to "Advanced", "agency" to "Agency", "enterprise" to "Enterprise",
    )

    /** The intent a link's query carries, or null when it names no plan this console sells. */
    fun parse(params: Map<String, String>): OnboardingPlanIntent? {
      fun read(key: String) = params[key].orEmpty().trim().lowercase()
      val plan = read("plan")
      if (plan.isEmpty()) return null
      if (plan == "enterprise") return OnboardingPlanIntent(plan, "month", intervalStated = false, contactSales = true)
      if (plan !in SELF_SERVE_PLANS) return null
      val interval = read("interval")
      val ai = read("ai")
      return OnboardingPlanIntent(
        plan = plan,
        interval = if (interval == "year" || interval == "annual") "year" else "month",
        intervalStated = interval == "year" || interval == "annual" || interval == "month",
        contactSales = false,
        ai = ai == "1" || ai == "true" || ai == "yes",
      )
    }
  }
}

/**
 * Which campaign produced a sign-up: the three allowlisted `utm_` keys and nothing else (`parseUtmAttribution`,
 * libs/aglyn/src/lib/app-utils/utm-attribution.ts).
 */
data class UtmAttribution(val source: String? = null, val medium: String? = null, val campaign: String? = null) {
  /** The canonical wire form (`utmAttributionQuery`), spaces as `+` as `URLSearchParams` writes them. */
  val query: String
    get() = listOf("utm_source" to source, "utm_medium" to medium, "utm_campaign" to campaign)
      .mapNotNull { (key, value) -> value?.let { "$key=${it.encodeURLParameter(spaceToPlus = true)}" } }
      .joinToString("&")

  companion object {
    val KEYS = listOf("utm_source", "utm_medium", "utm_campaign")
    private val EMAIL_SHAPED = Regex("""[^\s@]+@[^\s@]+\.[^\s@]+""")

    /** Null when the link carries none. A value that looks like an email address is dropped, and each is capped at 100. */
    fun parse(params: Map<String, String>): UtmAttribution? {
      fun scrub(raw: String?): String? {
        val value = raw.orEmpty().trim()
        return if (value.isEmpty() || EMAIL_SHAPED.containsMatchIn(value)) null else value.take(100)
      }
      val found = UtmAttribution(scrub(params["utm_source"]), scrub(params["utm_medium"]), scrub(params["utm_campaign"]))
      return if (found.source == null && found.medium == null && found.campaign == null) null else found
    }
  }
}

/** `application/x-www-form-urlencoded` decoding, as `URLSearchParams` reads a query. */
fun queryParams(query: String): Map<String, String> = query.removePrefix("?").split('&').filter { it.isNotEmpty() }.associate { pair ->
  val at = pair.indexOf('=')
  val key = if (at < 0) pair else pair.substring(0, at)
  val value = if (at < 0) "" else pair.substring(at + 1)
  runCatching { key.decodeURLQueryComponent(plusIsSpace = true) }.getOrDefault(key) to
    runCatching { value.decodeURLQueryComponent(plusIsSpace = true) }.getOrDefault(value)
}

/**
 * The sign-up form's rules, as the console's form schema states them (libs/shared/data/forms/src/lib/fields.ts and the sign-up
 * page's `signupOrgNameField`). Each answers the first rule a value breaks, in the form's words, or null.
 */
object SignUpRules {
  fun firstName(value: String): String? {
    val trimmed = value.trim()
    return when {
      trimmed.isEmpty() -> "Please enter a first name"
      trimmed.length < 2 -> "Please enter a longer first name"
      else -> null
    }
  }

  fun lastName(value: String): String? = if (value.isBlank()) "Provide your last name" else null

  fun organization(value: String): String? {
    val trimmed = value.trim()
    return when {
      trimmed.isEmpty() -> "Provide your organization/company name"
      WorkspaceName.slug(trimmed).isEmpty() -> WorkspaceName.REFUSAL
      else -> null
    }
  }

  fun email(value: String): String? {
    val trimmed = value.trim()
    return when {
      trimmed.isEmpty() -> "Email address is required"
      !Regex("""[^\s@]+@[^\s@.]+(\.[^\s@.]+)+""").containsMatchIn(trimmed) -> "Enter a valid email (name@domain.com)"
      else -> null
    }
  }

  fun password(value: String): String? = when {
    value.isEmpty() -> "Password is required"
    !Regex("[a-z]").containsMatchIn(value) -> "Must contain at least 1 lowercase letter"
    !Regex("[A-Z]").containsMatchIn(value) -> "Must contain at least 1 uppercase letter"
    !Regex("[0-9]").containsMatchIn(value) -> "Must contain at least 1 number"
    !Regex("[^A-Za-z0-9_]").containsMatchIn(value) -> "Must contain a special character [/!@$]"
    Regex("""\s""").containsMatchIn(value) -> "Password can not have spaces"
    value.length < 6 -> "Length must between 6–30 characters"
    else -> null
  }

  fun confirm(value: String, password: String): String? = when {
    value.isEmpty() -> "Confirm your password."
    value != password -> "Those passwords didn't match. Try again."
    else -> null
  }
}

/**
 * A workspace name has to survive becoming a workspace address (AGL-1115): the console's `generateOrgSlug`. The
 * brand-impersonation screen `isBlockedSubdomain` also runs stays on the server: `/api/orgs/create` refuses such a name in
 * its own words.
 */
object WorkspaceName {
  /** `RESERVED_SUBDOMAINS` and the organization-only `RESERVED_ORG_ONLY`. */
  val RESERVED = setOf(
    "www", "app", "api", "admin", "console", "mail", "demo", "staging", "dev", "test", "docs", "blog", "help",
    "support", "status", "cdn", "assets", "static", "ftp", "smtp", "ns1", "ns2", "aglyn", "billing", "account",
    "login", "signup", "auth", "accounts", "signin", "sso", "secure", "verify", "portal", "webmail", "imap", "mx",
    "com", "net", "staff", "org", "orgs", "workspace", "kiosk",
  )

  /** `BLOCKED_FRAGMENTS`, refused as substrings. */
  private val BLOCKED_FRAGMENTS = listOf("fuck", "shit", "cunt", "nigger", "faggot", "bitch", "porn", "nazi")

  const val REFUSAL =
    "Pick a different name — this one can’t be used as a workspace address. Try adding a word, and avoid reserved names like “admin” or “workspace”."

  fun helper(workspaceDomain: String) = "This becomes your workspace address, e.g. acme-inc.$workspaceDomain"

  /** The address a name becomes, or "" when nothing usable remains. */
  fun slug(name: String): String {
    var slug = stripMarks(name.lowercase())
      .replace(Regex("[^a-z0-9]+"), "-")
      .replace(Regex("-{2,}"), "-")
      .replace(Regex("^-+|-+$"), "")
    slug = slug.take(30).replace(Regex("-+$"), "")
    if (!Regex("^[a-z0-9][a-z0-9-]{2,29}$").matches(slug)) return ""
    val collapsed = slug.replace(Regex("[^a-z0-9]"), "")
    if (slug in RESERVED || BLOCKED_FRAGMENTS.any { it in collapsed }) return ""
    return slug
  }
}

/** The marketing opt-in the sign-up form offers beside the terms (`PLATFORM_MARKETING_CONSENT_TEXT`). */
object MarketingConsent {
  const val TEXT_VERSION = "2026-09-20"
  fun text(brand: String) = "Send me product updates from $brand. You can opt out any time."
}

/** A sign-up's door, the `context` its acceptance is recorded under (`LegalAcceptanceContext`). */
enum class SignUpDoor(val context: String, val acquisitionDoor: String?) {
  PASSWORD("signup-password", null),
  GOOGLE("signup-google", "signup-google"),
}

/** The name a sign-up asked its workspace to have, held on the account until the address is confirmed. */
data class PendingSignUpWorkspace(val name: String, val nameWasTyped: Boolean)

/** What `/api/orgs/create` answered. */
data class SignUpWorkspaceOutcome(val slug: String?, val orgId: String?, val error: String?)

/** How sending the verification email went. */
sealed interface VerificationSend {
  data object Sent : VerificationSend
  data object AlreadyVerified : VerificationSend
  data class Failed(val message: String) : VerificationSend
}

/**
 * The console routes and `users/{uid}` writes every sign-up door makes, in the console's order and with its failure handling:
 * everything after the account exists is best-effort, so a failed record never reads as a failed sign-up
 * (apps/console/app/(auth)/signup/page.tsx). There is no privileged app path: the routes are the console's own. Twin of the
 * Apple kit's `SignUpService`.
 */
class SignUpService(
  internal val api: ConsoleApiClient,
  private val writer: FirestoreWriter,
  private val reader: FirestoreReader,
  private val now: () -> Long = ::nowMillis,
  /** How long the `users/{uid}` writes are waited on (`SIGN_UP_WRITES_DEADLINE_MS`). */
  private val writesDeadlineMs: Long = 4_000,
) {
  /** The signups lockdown's notice (AGL-1510), or null when signups are open; an unreadable answer means open. */
  suspend fun signupsPaused(): String? {
    val answer = quietly { api.request("/api/lockdown-status", query = mapOf("feature" to "signups"), anonymous = true) } as? JsonObject
      ?: return null
    if ((answer["locked"] as? JsonPrimitive)?.booleanOrNull != true) return null
    return (answer["message"] as? JsonPrimitive)?.contentOrNull ?: "New signups are temporarily paused."
  }

  /**
   * Records the clickwrap acceptance (`postLegalAcceptance`). The server stamps the version it publishes and its own clock;
   * the app shows the live documents, so it names no version of its own.
   */
  suspend fun recordAcceptance(door: SignUpDoor): Boolean =
    runCatchingRequest { api.request("/api/auth/legal-acceptance", ApiMethod.POST, buildJsonObject { put("context", door.context) }) }

  /** Where the account came from (`rememberAccountAcquisition`); the server decides whether there is anything to record. */
  suspend fun recordAcquisition(door: String?) {
    runCatchingRequest { api.request("/api/auth/acquisition", ApiMethod.POST, buildJsonObject { if (door != null) put("door", door) }) }
  }

  /** The plan, the campaign and the typed name on the account, waited on for no longer than the deadline. */
  suspend fun remember(uid: String, plan: OnboardingPlanIntent?, campaign: UtmAttribution?, firstName: String? = null, lastName: String? = null) {
    val path = "users/$uid"
    val stamp = now()
    val writes = buildList<suspend () -> Unit> {
      if (plan != null) add { writer.merge(path, mapOf("onboardingPlanIntent" to mapOf("query" to plan.query, "createdAtMs" to stamp))) }
      if (campaign != null && campaign.query.isNotEmpty()) {
        add { writer.merge(path, mapOf("signupCampaign" to mapOf("query" to campaign.query, "createdAtMs" to stamp))) }
      }
      val first = firstName.orEmpty().trim()
      val last = lastName.orEmpty().trim()
      if (first.isNotEmpty() || last.isNotEmpty()) add { writer.merge(path, mapOf("firstName" to first, "lastName" to last)) }
    }
    settle(writes)
  }

  /** Holds the typed workspace name with the account until the address is confirmed, bound to the password provider. */
  suspend fun holdWorkspace(uid: String, pending: PendingSignUpWorkspace) {
    val name = pending.name.trim()
    if (name.isEmpty()) return
    val stored = mapOf("name" to name, "nameWasTyped" to pending.nameWasTyped, "provider" to "password", "createdAtMs" to now())
    settle(listOf { writer.merge("users/$uid", mapOf(FIELD to stored)) })
  }

  /** Takes the held name, once (`claimPendingSignUpWorkspace`): cleared whatever is decided, honoured inside its window and binding. */
  suspend fun claimHeldWorkspace(uid: String, providers: List<String>): PendingSignUpWorkspace? {
    val held = quietly { reader.get("users/$uid") }?.data?.get(FIELD) as? Map<*, *> ?: return null
    try {
      writer.merge("users/$uid", mapOf(FIELD to null))
    } catch (error: CancellationException) {
      throw error
    } catch (_: Throwable) {
      return null
    }
    return honour(held, providers, now())
  }

  /** Takes the plan the account remembers from sign-up, once (`consumeOnboardingPlanIntent`). */
  suspend fun consumePlanIntent(uid: String): OnboardingPlanIntent? {
    val stored = quietly { reader.get("users/$uid") }?.data?.get("onboardingPlanIntent") as? Map<*, *> ?: return null
    val query = stored["query"] as? String ?: return null
    if (query.isEmpty()) return null
    quietly { writer.merge("users/$uid", mapOf("onboardingPlanIntent" to null)) }
    val created = (stored["createdAtMs"] as? Number)?.toLong() ?: 0
    if (created <= 0 || now() - created > MAX_AGE_MS) return null
    return OnboardingPlanIntent.parse(queryParams(query))
  }

  /** Creates the workspace (`createSignUpWorkspace`). A 409 means the address was taken and nothing was created. */
  suspend fun createWorkspace(name: String): SignUpWorkspaceOutcome = try {
    val answer = api.request("/api/orgs/create", ApiMethod.POST, buildJsonObject { put("name", name.trim()) }) as? JsonObject
    SignUpWorkspaceOutcome(answer.string("slug"), answer.string("orgId"), null)
  } catch (error: CancellationException) {
    throw error
  } catch (error: ConsoleApiError) {
    SignUpWorkspaceOutcome(null, null, (error.body as? JsonObject).string("error"))
  } catch (_: Throwable) {
    SignUpWorkspaceOutcome(null, null, null)
  }

  /** Records the product-updates opt-in (`postPlatformMarketingConsent`), only ever when it was ticked. */
  suspend fun recordMarketingOptIn(): Boolean = runCatchingRequest {
    api.request(
      "/api/auth/marketing-consent", ApiMethod.POST,
      buildJsonObject {
        put("decision", "granted")
        put("source", "console-signup")
        put("textVersion", MarketingConsent.TEXT_VERSION)
      },
    )
  }

  /** Sends the verification email (`/verify-email`'s `sendLink`); [automatic] is the page's first, cooled-down send. */
  suspend fun sendVerification(automatic: Boolean): VerificationSend = try {
    val answer = api.request("/api/auth/send-verification", ApiMethod.POST, buildJsonObject { put("auto", automatic) }) as? JsonObject
    if ((answer?.get("alreadyVerified") as? JsonPrimitive)?.booleanOrNull == true) VerificationSend.AlreadyVerified else VerificationSend.Sent
  } catch (error: CancellationException) {
    throw error
  } catch (error: ConsoleApiError) {
    when {
      error.status == 429 -> VerificationSend.Failed("Too many requests — wait a moment before requesting another link.")
      error.status != 0 -> VerificationSend.Failed(
        (error.body as? JsonObject).string("error") ?: "We couldn’t send the verification email. Try again shortly.",
      )
      else -> VerificationSend.Failed("We couldn’t send the verification email. Try again shortly.")
    }
  } catch (_: Throwable) {
    VerificationSend.Failed("We couldn’t send the verification email. Try again shortly.")
  }

  /** Sends a password reset link (`/account-recovery`): the console's own branded email, never Firebase's default. */
  suspend fun sendPasswordReset(email: String) {
    api.request("/api/auth/send-password-reset", ApiMethod.POST, buildJsonObject { put("email", email.trim()) }, anonymous = true)
  }

  /**
   * Whether [email]'s domain signs in through a workspace's single sign-on (`/api/auth/sso-lookup`, the console's `/sso`
   * discovery): such an address lives in that workspace's identity pool, so a password sign-in in the project pool is not its
   * account. An unreadable answer is no.
   */
  suspend fun usesSingleSignOn(email: String): Boolean {
    val trimmed = email.trim().lowercase()
    if ('@' !in trimmed) return false
    val answer = quietly { api.request("/api/auth/sso-lookup", query = mapOf("email" to trimmed), anonymous = true) } as? JsonObject
      ?: return false
    return (answer["ssoEnabled"] as? JsonPrimitive)?.booleanOrNull == true && !answer.string("tenantId").isNullOrEmpty()
  }

  /** The confirmed alternative address an account signs in with (`/api/auth/resolve-identifier`), or null. */
  suspend fun resolveIdentifier(typed: String): String? {
    val answer = quietly {
      api.request("/api/auth/resolve-identifier", ApiMethod.POST, buildJsonObject { put("identifier", typed) }, anonymous = true)
    } as? JsonObject
    val email = answer.string("email") ?: return null
    return if (email.lowercase() == typed.trim().lowercase()) null else email
  }

  /** Waits for the writes, but never longer than the deadline (`settleSignUpWrites`). */
  private suspend fun settle(writes: List<suspend () -> Unit>) {
    if (writes.isEmpty()) return
    withTimeoutOrNull(writesDeadlineMs) {
      coroutineScope { writes.map { write -> async { quietly { write() } } }.awaitAll() }
    }
  }

  companion object {
    const val FIELD = "pendingSignUpWorkspace"

    /** How long a held name or plan stays honourable (seven days, the console's `MAX_AGE_MS`). */
    const val MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000

    fun honour(held: Map<*, *>, providers: List<String>, nowMs: Long): PendingSignUpWorkspace? {
      val name = held["name"] as? String
      if (name.isNullOrEmpty()) return null
      val created = (held["createdAtMs"] as? Number)?.toLong() ?: 0
      if (created <= 0 || nowMs - created > MAX_AGE_MS) return null
      val provider = held["provider"] as? String
      if (provider.isNullOrEmpty() || provider !in providers) return null
      return PendingSignUpWorkspace(name, held["nameWasTyped"] == true)
    }
  }
}

private fun JsonObject?.string(key: String): String? = (this?.get(key) as? JsonPrimitive)?.contentOrNull

private suspend fun <T> quietly(block: suspend () -> T): T? = try {
  block()
} catch (error: CancellationException) {
  throw error
} catch (_: Throwable) {
  null
}

private suspend fun runCatchingRequest(block: suspend () -> JsonElement?): Boolean = try {
  block()
  true
} catch (error: CancellationException) {
  throw error
} catch (_: Throwable) {
  false
}

/** Lowercase letters with their accents removed, as `normalize('NFKD').replace(/[̀-ͯ]/g, '')` leaves them. */
internal expect fun stripMarks(value: String): String

/** An invitation addressed to any confirmed address on the signed-in account (`GET /api/orgs/invites?mine=1`). */
data class PendingInvite(val id: String, val orgId: String, val orgName: String?, val role: String?, val handoff: Boolean) {
  /** "You've been invited to Acme as admin." (the console's `inviteSentence`). */
  val sentence: String
    get() = if (handoff) {
      "You've been invited to take over ${orgName ?: "a workspace"} as its owner."
    } else {
      "You've been invited to ${orgName ?: "an organization"}" + (role?.let { " as $it" } ?: "") + "."
    }
}

/** The account's pending invitations; none when they cannot be read. */
suspend fun SignUpService.pendingInvites(): List<PendingInvite> {
  val answer = quietly { api.request("/api/orgs/invites", query = mapOf("mine" to "1")) } as? JsonObject
    ?: return emptyList()
  val rows = answer["invites"] as? kotlinx.serialization.json.JsonArray ?: return emptyList()
  return rows.mapNotNull { element ->
    val row = element as? JsonObject ?: return@mapNotNull null
    val id = row.string("\$id") ?: return@mapNotNull null
    val org = row.string("orgId")?.ifEmpty { null } ?: return@mapNotNull null
    PendingInvite(id, org, row.string("orgName"), row.string("role"), row["handoff"] is JsonObject)
  }
}

/** Accepts or declines an invitation, as the console's dialog does (`POST /api/orgs/invites`). */
suspend fun SignUpService.answer(invite: PendingInvite, accept: Boolean) {
  api.request(
    "/api/orgs/invites", ApiMethod.POST,
    buildJsonObject {
      put("orgId", invite.orgId)
      put("action", if (accept) "accept" else "decline")
      put("inviteId", invite.id)
    },
  )
}

/** The name a door that collected none derives for its workspace (`derivePersonalOrgName`). */
fun derivedWorkspaceName(displayName: String?, email: String?): String =
  displayName?.trim()?.ifEmpty { null } ?: email.orEmpty().substringBefore('@').trim()

/** The words a failed sign-up shows, by Identity Toolkit / Firebase Auth error code (`AuthErrorMessage`). */
fun signUpErrorMessage(code: String?, brand: String = AglynConfig.DEFAULT_BRAND_NAME): String {
  if (code == APP_CHECK_REFUSED || isAppCheckRefusalText(code)) return APP_CHECK_REFUSAL_MESSAGE
  return when (code?.uppercase()?.substringBefore(' ')?.removePrefix("ERROR_")) {
    "EMAIL_EXISTS", "EMAIL_ALREADY_IN_USE" -> "Account with email already exists. Sign in instead."
    "WEAK_PASSWORD" -> "Password is too weak. Enter a stronger password and try again."
    "INVALID_EMAIL" -> "Unable to perform action. Email provided is invalid."
    "TOO_MANY_ATTEMPTS_TRY_LATER", "TOO_MANY_REQUESTS" -> "Account blocked from too many attempts. Try again later."
    "USER_DISABLED" -> "This account is currently disabled. Contact $brand support to restore access, or to appeal the decision."
    "NEED_CONFIRMATION", "ACCOUNT_EXISTS_WITH_DIFFERENT_CREDENTIAL", "FEDERATED_USER_ID_ALREADY_LINKED", "CREDENTIAL_ALREADY_IN_USE" ->
      "Authentication credential already in use with different credential."
    "NETWORK", "NETWORK_REQUEST_FAILED" -> "Unable to connect. Check your internet connection and try again."
    "INTERNAL", "INTERNAL_ERROR", "BLOCKING_FUNCTION_ERROR_RESPONSE" ->
      "Something went wrong on our end — no account was created and nothing you entered was saved. Please try again, and if it keeps happening contact $brand support."
    "EXPIRED_OOB_CODE", "EXPIRED_ACTION_CODE" -> "This link has expired. Request a new password reset link and try again."
    "INVALID_OOB_CODE", "INVALID_ACTION_CODE" -> "This link is invalid or has already been used. Request a new password reset link."
    else -> "An error has occurred. Please try again — if it keeps happening, contact $brand support."
  }
}

/** Whether a sign-in failed on the credentials alone, the one refusal a confirmed secondary address may retry. */
fun isCredentialRefusal(code: String?): Boolean = code?.uppercase()?.substringBefore(' ')?.removePrefix("ERROR_") in setOf(
  "INVALID_LOGIN_CREDENTIALS", "EMAIL_NOT_FOUND", "INVALID_EMAIL", "INVALID_PASSWORD", "USER_NOT_FOUND", "INVALID_CREDENTIAL",
  "WRONG_PASSWORD",
)
