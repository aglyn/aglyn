/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The plugins' DECLARATIONS (AGL-2939): the light registrations core
 * reads before any plugin surface loads, imported dynamically like the
 * loader manifests. One of the sanctioned @aglyn/plugins-* references
 * outside libs/plugins (AGL-417).
 * Source of truth: plugins.config.json.
 */
/* eslint-disable @nx/enforce-module-boundaries */

let done: Promise<void> | undefined

/** Registers every plugin's client declarations once per process. */
export function registerPluginDeclarations(): Promise<void> {
  done ??= (async () => {
    ;(await import('@aglyn/plugins-bookings/declarations')).registerBookingsDeclarations()
    ;(await import('@aglyn/plugins-commerce/declarations')).registerCommerceDeclarations()
    ;(await import('@aglyn/plugins-marketplace/declarations')).registerMarketplaceDeclarations()
    ;(await import('@aglyn/plugins-crm/declarations')).registerCrmDeclarations()
    ;(await import('@aglyn/plugins-outreach/declarations.console')).registerOutreachConsoleDeclarations()
    ;(await import('@aglyn/plugins-accounting/declarations.console')).registerAccountingConsoleDeclarations()
    ;(await import('@aglyn/plugins-email/declarations')).registerEmailDeclarations()
    ;(await import('@aglyn/plugins-inbox/declarations')).registerInboxDeclarations()
    ;(await import('@aglyn/plugins-marketing/declarations')).registerMarketingDeclarations()
    ;(await import('@aglyn/plugins-workflows/declarations')).registerWorkflowsDeclarations()
    ;(await import('@aglyn/plugins-ai/declarations')).registerAiDeclarations()
    ;(await import('@aglyn/plugins-shipping/declarations.console')).registerShippingConsoleDeclarations()
    ;(await import('@aglyn/plugins-post-purchase/declarations.console')).registerPostPurchaseConsoleDeclarations()
    ;(await import('@aglyn/plugins-review-platforms/declarations.console')).registerReviewPlatformsConsoleDeclarations()
    ;(await import('@aglyn/plugins-loyalty/declarations.console')).registerLoyaltyConsoleDeclarations()
    ;(await import('@aglyn/plugins-waivers/declarations')).registerWaiversDeclarations()
    ;(await import('@aglyn/plugins-tax-engines/declarations.console')).registerTaxEnginesConsoleDeclarations()
    ;(await import('@aglyn/plugins-marketing-platforms/declarations.console')).registerMarketingPlatformsConsoleDeclarations()
    ;(await import('@aglyn/plugins-help-desks/declarations.console')).registerHelpDesksConsoleDeclarations()
    ;(await import('@aglyn/plugins-ad-conversions/declarations.console')).registerAdConversionsConsoleDeclarations()
    ;(await import('@aglyn/plugins-fulfillment-networks/declarations.console')).registerFulfillmentNetworksConsoleDeclarations()
    ;(await import('@aglyn/plugins-couriers/declarations.console')).registerCouriersConsoleDeclarations()
    ;(await import('@aglyn/plugins-marketplaces/declarations.console')).registerMarketplacesConsoleDeclarations()
    ;(await import('@aglyn/plugins-print-on-demand/declarations.console')).registerPrintOnDemandConsoleDeclarations()
    ;(await import('@aglyn/plugins-inventory-sync/declarations.console')).registerInventorySyncConsoleDeclarations()
    ;(await import('@aglyn/plugins-sales-channels/declarations.console')).registerSalesChannelsConsoleDeclarations()
    ;(await import('@aglyn/plugins-funnels/declarations')).registerFunnelsDeclarations()
    ;(await import('@aglyn/plugins-weglot/declarations')).registerWeglotDeclarations()
    ;(await import('@aglyn/plugins-domains/declarations')).registerDomainsDeclarations()
  })()
  return done
}
