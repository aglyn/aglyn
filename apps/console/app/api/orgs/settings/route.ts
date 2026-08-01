/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { after } from 'next/server'
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import type { AglynOrgBilling } from '@aglyn/aglyn/server'
import {
  canManageOrg,
  checkEntitlement,
  isValidOrgSlug,
  normalizeAddress,
  normalizePhone,
} from '@aglyn/aglyn/server'
import {
  changeOrgSlug,
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  listOrgMembers,
  logOrgActivity,
  OrgSlugTakenError,
  resolveOrgMembership,
  transferOrgOwnership,
} from '@aglyn/tenant-data-admin'

/**
 * Org settings mutations (AGL-236). Rename goes through the API rather
 * than a client write because the name is denormalized onto every
 * member's `users/{uid}/orgs` reverse-index entry — the switcher and
 * breadcrumbs read it from there.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const orgId = String(body?.orgId ?? '')
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const membership = await resolveOrgMembership(decoded.uid, orgId)
    if (
      decoded['staff'] !== true &&
      !canManageOrg(membership?.member.role)
    ) {
      return Response.json({ error: 'Org settings require the admin role' }, { status: 403 })
    }

    if (body?.action === 'rename') {
      const name = String(body?.name ?? '')
        .trim()
        .slice(0, 80)
      if (!name) return Response.json({ error: 'Missing name' }, { status: 400 })
      const firestore = firebaseAdmin.app().firestore()
      await firestore
        .collection('orgs')
        .doc(orgId)
        .set(
          {
            name,
            updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      const members = await listOrgMembers(orgId)
      const batch = firestore.batch()
      for (const member of members) {
        batch.set(
          firestore
            .collection('users')
            .doc(member.$id)
            .collection('orgs')
            .doc(orgId),
          { orgName: name },
          { merge: true },
        )
      }
      await batch.commit()
      void logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        `Renamed organization to "${name}"`,
        { type: 'org', id: orgId },
      )
      return Response.json({ ok: true, name }, { status: 200 })
    }

    // Default sharing for new resources (AGL-1048). Does NOT touch a
    // single existing doc — only what the next dataset or upload starts
    // as. Retroactively narrowing an org's library from a settings toggle
    // would break live pages with no confirmation, which is exactly what
    // AGL-1044/1045's per-resource flow exists to prevent.
    if (body?.action === 'set-default-resource-scope') {
      const value = String(body?.defaultResourceScope ?? '')
      if (value !== 'org' && value !== 'host') {
        return Response.json(
          { error: 'defaultResourceScope must be "org" or "host"' },
          { status: 400 },
        )
      }
      await firebaseAdmin
        .app()
        .firestore()
        .collection('orgs')
        .doc(orgId)
        .set({ defaultResourceScope: value }, { merge: true })
      return Response.json({ ok: true }, { status: 200 })
    }

    // Plugin switchboard (AGL-416): which plugins the workspace loads.
    // Ids are opaque strings (first-party catalog + future realm-trusted
    // marketplace ids); always-on ids are re-unioned at read time by
    // resolveEnabledPlugins, so a hostile write can't switch off the base
    // component library.
    if (body?.action === 'set-enabled-plugins') {
      const raw = body?.enabledPlugins
      if (!Array.isArray(raw) || raw.length > 100) {
        return Response.json({ error: 'Invalid plugin list' }, { status: 400 })
      }
      const enabledPlugins = Array.from(
        new Set(
          raw.map((id: unknown) => String(id).trim().slice(0, 60)).filter(Boolean),
        ),
      )
      await firebaseAdmin
        .app()
        .firestore()
        .collection('orgs')
        .doc(orgId)
        .set(
          {
            enabledPlugins,
            updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      void logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        `Updated enabled plugins (${enabledPlugins.length} on)`,
        { type: 'org', id: orgId },
      )
      return Response.json({ ok: true, enabledPlugins }, { status: 200 })
    }

    // Org profile (AGL-363): logo + contact details, admin-writable.
    // Logo URLs must be https; contact fields are plain strings, length
    // capped — they surface on invoices, the community profile, and the
    // admin console.
    if (body?.action === 'update-profile') {
      const clean = (value: unknown, max = 200) =>
        String(value ?? '')
          .trim()
          .slice(0, max)
      const logoUrl = clean(body?.logoUrl, 500)
      if (logoUrl && !/^https:\/\//i.test(logoUrl)) {
        return Response.json({ error: 'Logo URLs must be https://' }, { status: 400 })
      }
      // The org's address is STRUCTURED (AGL-1133). It was a 400-character
      // free-text blob, which reads as an address to a human and is unusable
      // to anything else: Stripe Tax cannot compute from it and it cannot be
      // placed on an invoice programmatically.
      //
      // Converting the existing field rather than adding a `billingAddress`
      // beside it, because a third address — personal, contact, billing —
      // is the exact variant sprawl this issue exists to stop. Safe to
      // convert: measured on production 2026-07-31, all four orgs have
      // `contact.address` unset, so there is nothing to migrate.
      const address = normalizeAddress({
        line1: clean(body?.contactAddressLine1),
        line2: clean(body?.contactAddressLine2),
        city: clean(body?.contactAddressCity),
        state: clean(body?.contactAddressState),
        postalCode: clean(body?.contactAddressPostalCode, 20),
        country: clean(body?.contactAddressCountry, 2),
      })
      const rawPhone = clean(body?.contactPhone, 40)
      const contact = {
        email: clean(body?.contactEmail),
        // Normalized on save like the personal profile, so one org's phone
        // is not stored in a different format from its owner's.
        phone: rawPhone ? (normalizePhone(rawPhone) ?? rawPhone) : '',
        website: clean(body?.contactWebsite),
        address,
      }
      if (
        contact.address &&
        !contact.address.country &&
        clean(body?.contactAddressCountry, 2)
      ) {
        // normalizeAddress drops anything that is not ISO-3166 alpha-2. Say
        // so rather than silently saving an address Stripe Tax cannot use.
        return Response.json(
          { error: 'Country must be a two-letter code, e.g. US' },
          { status: 400 },
        )
      }
      if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
        return Response.json({ error: 'Enter a valid contact email' }, { status: 400 })
      }
      const orgFirestore = firebaseAdmin.app().firestore()
      const orgDocRef = orgFirestore.collection('orgs').doc(orgId)
      await orgDocRef.set(
        {
          logoUrl: logoUrl || firebaseAdmin.firestore.FieldValue.delete(),
          contact,
          updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      // Push to the Stripe customer ON CHANGE (AGL-1133). Checkout collects
      // an address at purchase; nothing carried a later EDIT across, so an
      // org that moved kept the old address on every future invoice —
      // which is the case that actually matters for tax.
      //
      // `after()` rather than a bare `void promise`. The first version used
      // the latter to keep the save fast, and it silently never ran: on
      // serverless the function can be frozen once the response is sent, so
      // work scheduled after it is not guaranteed to execute. Measured —
      // Firestore had the new address and Stripe still had the old one.
      //
      // Still best-effort inside: a settings save is the user's action and
      // must not fail because Stripe was slow, and Firestore is already
      // correct so a missed sync self-heals on the next save.
      after(async () => {
        const secretKey = process.env.STRIPE_SECRET_KEY
        const customerId = (await orgDocRef.get()).get('stripeCustomerId') as
          | string
          | undefined
        if (!secretKey || !customerId) return
        const params = new URLSearchParams()
        if (contact.address) {
          const a = contact.address
          // Stripe rejects an address without a country, so send one only
          // when it is complete enough to be accepted at all.
          if (a.country) {
            if (a.line1) params.set('address[line1]', a.line1)
            if (a.line2) params.set('address[line2]', a.line2)
            if (a.city) params.set('address[city]', a.city)
            if (a.state) params.set('address[state]', a.state)
            if (a.postalCode) params.set('address[postal_code]', a.postalCode)
            params.set('address[country]', a.country)
          }
        }
        if (contact.phone) params.set('phone', contact.phone)
        if (![...params.keys()].length) return
        try {
          const response = await fetch(
            `https://api.stripe.com/v1/customers/${customerId}`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${secretKey}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: params.toString(),
            },
          )
          if (!response.ok) {
            console.error(
              '[orgs/settings] Stripe customer sync failed',
              orgId,
              (await response.json().catch(() => null))?.error?.message,
            )
          }
        } catch (error) {
          console.error('[orgs/settings] Stripe customer sync threw', orgId, error)
        }
      })
      void logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        'Updated organization profile',
        { type: 'org', id: orgId },
      )
      return Response.json({ ok: true }, { status: 200 })
    }

    // White-label brand (White-Label Phase 2): the org's `brandingProfile`,
    // admin-writable but gated on the `whiteLabel` entitlement (Agency tier /
    // Enterprise override) — the same gate `resolveBrandingProfile` reads, so
    // the server never stores a profile it would ignore anyway, and a
    // non-entitled org can't stage a brand it isn't paying for. Image/support
    // URLs must be https; the color must be a CSS hex. The whole
    // `brandingProfile` map is replaced (merge is top-level), so a cleared
    // field drops out and falls back to the Aglyn default at resolve time.
    if (body?.action === 'update-branding') {
      const firestore = firebaseAdmin.app().firestore()
      const orgSnapshot = await firestore.collection('orgs').doc(orgId).get()
      if (
        !checkEntitlement(
          orgSnapshot.data() as Partial<AglynOrgBilling>,
          'whiteLabel',
        )
      ) {
        return Response.json(
          { error: 'White-label branding requires the Agency plan' },
          { status: 403 },
        )
      }
      const input = (body?.brandingProfile ?? {}) as Record<string, unknown>
      const clean = (value: unknown, max: number) =>
        String(value ?? '')
          .trim()
          .slice(0, max)
      const productName = clean(input.productName, 80)
      const fromName = clean(input.fromName, 80)
      const supportUrl = clean(input.supportUrl, 500)
      const logoUrl = clean(input.logoUrl, 500)
      const faviconUrl = clean(input.faviconUrl, 500)
      const emailLogoUrl = clean(input.emailLogoUrl, 500)
      const primaryColor = clean(input.primaryColor, 32)
      const customConsoleDomain = clean(input.customConsoleDomain, 253).toLowerCase()
      const urlFields: Array<[string, string]> = [
        ['Support URL', supportUrl],
        ['Logo URL', logoUrl],
        ['Favicon URL', faviconUrl],
        ['Email logo URL', emailLogoUrl],
      ]
      for (const [label, url] of urlFields) {
        if (url && !/^https:\/\//i.test(url)) {
          return Response.json(
            { error: `${label} must be an https:// URL` },
            { status: 400 },
          )
        }
      }
      if (primaryColor && !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(primaryColor)) {
        return Response.json(
          { error: 'Primary color must be a hex color like #1a73e8' },
          { status: 400 },
        )
      }
      if (
        customConsoleDomain &&
        !/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(customConsoleDomain)
      ) {
        return Response.json(
          { error: 'Enter a valid custom console domain' },
          { status: 400 },
        )
      }
      // Keep only the fields that were actually set — a blank drops out and
      // the resolver fills that gap with the Aglyn default at read time.
      const profile: Record<string, string> = Object.fromEntries(
        Object.entries({
          productName,
          fromName,
          supportUrl,
          logoUrl,
          faviconUrl,
          emailLogoUrl,
          primaryColor,
          customConsoleDomain,
        }).filter(([, value]) => value.length > 0),
      )
      await firestore
        .collection('orgs')
        .doc(orgId)
        .set(
          {
            brandingProfile: profile,
            updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      void logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        'Updated white-label brand settings',
        { type: 'org', id: orgId },
      )
      return Response.json({ ok: true }, { status: 200 })
    }

    // Workspace URL change (AGL-236): owner-only — the slug is the org's
    // public identity. The old URL keeps resolving via a tombstone.
    if (body?.action === 'change-slug') {
      const isOwner = membership?.member.role === 'owner'
      if (decoded['staff'] !== true && !isOwner) {
        return Response.json({ error: 'Changing the workspace URL requires the owner' }, { status: 403 })
      }
      const slug = String(body?.slug ?? '')
        .trim()
        .toLowerCase()
      if (!isValidOrgSlug(slug)) {
        return Response.json({
          error:
            'Workspace URL must be 3–30 lowercase letters, digits, or ' +
            'dashes and not a reserved name',
        }, { status: 400 })
      }
      try {
        const { previousSlug } = await changeOrgSlug(orgId, slug)
        void logOrgActivity(
          orgId,
          { uid: decoded.uid, email: decoded.email },
          `Changed workspace URL to "${slug}"`,
          { type: 'org', id: orgId },
        )
        return Response.json({ ok: true, slug, previousSlug }, { status: 200 })
      } catch (error) {
        if (error instanceof OrgSlugTakenError) {
          return Response.json({ error: 'That workspace URL is taken' }, { status: 409 })
        }
        throw error
      }
    }

    // Ownership transfer (AGL-232): owner-only; the target must already
    // be a member. The previous owner steps down to admin.
    if (body?.action === 'transfer-ownership') {
      const isOwner = membership?.member.role === 'owner'
      if (decoded['staff'] !== true && !isOwner) {
        return Response.json({ error: 'Transferring ownership requires the owner' }, { status: 403 })
      }
      const targetUid = String(body?.targetUid ?? '')
      if (!targetUid) {
        return Response.json({ error: 'Missing targetUid' }, { status: 400 })
      }
      const orgSnapshot = await firebaseAdmin
        .app()
        .firestore()
        .collection('orgs')
        .doc(orgId)
        .get()
      try {
        await transferOrgOwnership(
          orgId,
          String(orgSnapshot.get('ownerUid') ?? decoded.uid),
          targetUid,
        )
        const targetSnapshot = await firebaseAdmin
          .app()
          .firestore()
          .collection('orgs')
          .doc(orgId)
          .collection('members')
          .doc(targetUid)
          .get()
        const targetName =
          targetSnapshot.get('displayName') ??
          targetSnapshot.get('email') ??
          targetUid
        void logOrgActivity(
          orgId,
          { uid: decoded.uid, email: decoded.email },
          `Transferred ownership to ${targetName}`,
          { type: 'member', id: targetUid, name: targetName },
        )
        return Response.json({ ok: true, ownerUid: targetUid }, { status: 200 })
      } catch (error: any) {
        return Response.json({ error: error?.message ?? 'Transfer failed' }, { status: 409 })
      }
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Org settings operation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
