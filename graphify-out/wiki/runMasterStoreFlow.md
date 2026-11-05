# runMasterStoreFlow()

> God node · 11 connections · `extension/store_actor.js`

**Community:** [7-Step Super-Buyer Store Actor](7-Step_Super-Buyer_Store_Actor.md)

## Connections by Relation

### calls
- [reportProgress()](reportProgress.md) `EXTRACTED`
- fillUSCustomerShippingInfo() `EXTRACTED`
- simulateCreditCardPaymentAndCount10s() `EXTRACTED`
- simulatePayPalGatewayAndCount10s() `EXTRACTED`
- simulateBrowseAndPickVariant() `EXTRACTED`
- addToCartAndInitiateCheckout() `EXTRACTED`
- finalizeAndCloseStoreTab() `EXTRACTED`
- triggerStoreFlow() `INFERRED`
- detectStorePlatform() `EXTRACTED`

### contains
- store_actor.js `EXTRACTED`

### implements
- 7-Step Super-Buyer E-Commerce Pixel Warmup Flow (ViewContent -> AddToCart -> Checkout -> PCI/PayPal) `EXTRACTED`

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*