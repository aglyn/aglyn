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

/** Registers every plugin's server declarations once per process. */
export function registerPluginServerDeclarations(): Promise<void> {
  done ??= (async () => {
    ;(await import('@aglyn/plugins-forms/declarations.server')).registerFormsServerDeclarations()
    ;(await import('@aglyn/plugins-forms/declarations.console-server')).registerFormsConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-bookings/declarations.console-server')).registerBookingsConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-commerce/declarations.server')).registerCommerceServerDeclarations()
    ;(await import('@aglyn/plugins-commerce/declarations.console-server')).registerCommerceConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-marketplace/declarations.server')).registerMarketplaceServerDeclarations()
    ;(await import('@aglyn/plugins-crm/declarations')).registerCrmDeclarations()
    ;(await import('@aglyn/plugins-crm/declarations.server')).registerCrmServerDeclarations()
    ;(await import('@aglyn/plugins-crm/declarations.console-server')).registerCrmConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-outreach/declarations.console-server')).registerOutreachConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-accounting/declarations.server')).registerAccountingServerDeclarations()
    ;(await import('@aglyn/plugins-accounting/declarations.console-server')).registerAccountingConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-data/declarations.server')).registerDataServerDeclarations()
    ;(await import('@aglyn/plugins-data/declarations.console-server')).registerDataConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-email/declarations.console-server')).registerEmailConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-events-calendar/declarations.console-server')).registerEventsCalendarConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-logic/declarations.server')).registerLogicServerDeclarations()
    ;(await import('@aglyn/plugins-logic/declarations.console-server')).registerLogicConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-marketing/declarations.server')).registerMarketingServerDeclarations()
    ;(await import('@aglyn/plugins-redirects/declarations.console-server')).registerRedirectsConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-workflows/declarations')).registerWorkflowsDeclarations()
    ;(await import('@aglyn/plugins-workflows/declarations.server')).registerWorkflowsServerDeclarations()
    ;(await import('@aglyn/plugins-ai/declarations')).registerAiDeclarations()
    ;(await import('@aglyn/plugins-ai/declarations.server')).registerAiServerDeclarations()
    ;(await import('@aglyn/plugins-fonts/declarations.server')).registerFontsServerDeclarations()
    ;(await import('@aglyn/plugins-themes/declarations.console-server')).registerThemesConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-sms/declarations.server')).registerSmsServerDeclarations()
    ;(await import('@aglyn/plugins-shipping/declarations.server')).registerShippingServerDeclarations()
    ;(await import('@aglyn/plugins-post-purchase/declarations.server')).registerPostPurchaseServerDeclarations()
    ;(await import('@aglyn/plugins-loyalty/declarations.server')).registerLoyaltyServerDeclarations()
    ;(await import('@aglyn/plugins-tax-engines/declarations.server')).registerTaxEnginesServerDeclarations()
    ;(await import('@aglyn/plugins-marketing-platforms/declarations.server')).registerMarketingPlatformsServerDeclarations()
    ;(await import('@aglyn/plugins-marketing-platforms/declarations.console-server')).registerMarketingPlatformsConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-zapier/declarations.server')).registerZapierServerDeclarations()
    ;(await import('@aglyn/plugins-zapier/declarations.console-server')).registerZapierConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-fulfillment-networks/declarations.server')).registerFulfillmentNetworksServerDeclarations()
    ;(await import('@aglyn/plugins-fulfillment-networks/declarations.console-server')).registerFulfillmentNetworksConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-marketplaces/declarations.server')).registerMarketplacesServerDeclarations()
    ;(await import('@aglyn/plugins-marketplaces/declarations.console-server')).registerMarketplacesConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-print-on-demand/declarations.server')).registerPrintOnDemandServerDeclarations()
    ;(await import('@aglyn/plugins-print-on-demand/declarations.console-server')).registerPrintOnDemandConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-inventory-sync/declarations.server')).registerInventorySyncServerDeclarations()
    ;(await import('@aglyn/plugins-inventory-sync/declarations.console-server')).registerInventorySyncConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-delivery-apps/declarations.console-server')).registerDeliveryAppsConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-sales-channels/declarations.server')).registerSalesChannelsServerDeclarations()
    ;(await import('@aglyn/plugins-video-delivery/declarations.server')).registerVideoDeliveryServerDeclarations()
    ;(await import('@aglyn/plugins-stock-photos/declarations.console-server')).registerStockPhotosConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-funnels/declarations.server')).registerFunnelsServerDeclarations()
    ;(await import('@aglyn/plugins-funnels/declarations.console-server')).registerFunnelsConsoleServerDeclarations()
  })()
  return done
}
