# Restore Purchases Implementation

## Overview

The "Restore Purchases" feature allows users to regain access to previously purchased content without paying again. This is a **mandatory requirement** for Apple App Store and recommended for Google Play.

## Requirements

### App Store (Apple)
- **Mandatory**: All apps with non-consumable purchases or auto-renewable subscriptions MUST include a restore mechanism.
- **Visibility**: The restore option must be easy for users to find.
- **Product Types**:
  - ✅ Non-consumable products (permanent unlocks)
  - ✅ Auto-renewable subscriptions
  - ❌ Consumable products (cannot be restored)

### Google Play
- **Recommended**: While not strictly mandatory, it's a best practice for user experience.
- User can reinstall or switch devices and regain purchases.

## Architecture

### 1. Multi-Provider Support

Murmur supports multiple payment providers:
- `stripe` - Web payments (credit cards)
- `wechat_pay` - WeChat Pay (China)
- `apple_iap` - Apple In-App Purchases
- `google_play` - Google Play Billing
- `revenuecat` - Unified IAP SDK (wraps Apple/Google)

### 2. Database Schema

See `src/lib/db/schema/purchases.ts`:

```typescript
{
  id:           "pur_..."           // ULID
  userId:       "user_123"
  provider:     "apple_iap" | "google_play" | "stripe" | ...
  productId:    "notes_100"         // SKU
  providerRef:  "1000000123456789"  // Provider transaction ID
  amountCents:  499
  currency:     "USD"
  notesGranted: 100
  status:       "pending" | "succeeded" | "refunded" | "failed"
  rawPayload:   { ... }             // Original webhook data
  createdAt:    timestamp
  updatedAt:    timestamp
}
```

### 3. Restore Flow

```
[User clicks "Restore Purchases"]
         ↓
[Client: POST /api/purchases/restore]
         ↓
[Server: Query payment providers]
    ├── Apple IAP: verifyReceipt() or AppTransaction
    ├── Google Play: purchases.products.get()
    ├── RevenueCat: GET /v1/subscribers/{userId}
    └── Stripe: GET /v1/charges?customer={id}
         ↓
[Compare provider data with local DB]
         ↓
[Add missing purchases + grant notes]
         ↓
[Return restored purchase list]
         ↓
[Client: Show success message + refresh balance]
```

## Implementation Phases

### Phase 1: Basic Structure (✅ Done)
- Create `/api/purchases/restore` route
- Query existing purchases from DB
- Return purchase history

### Phase 2: Provider Integration (TODO)
- **RevenueCat**: Call REST API `/v1/subscribers/{userId}`
- **Apple IAP**: Verify receipt or use AppTransaction (StoreKit 2)
- **Google Play**: Query Google Play Developer API
- **Stripe**: Query Stripe API for customer charges

### Phase 3: Reconciliation (TODO)
- Compare provider data with local DB
- Identify missing purchases (user purchased but not in our DB)
- Create purchase records + update notes ledger
- Handle edge cases (refunds, duplicates)

### Phase 4: UI Polish (TODO)
- Loading states
- Success/error messages (i18n)
- Toast notifications instead of alert()
- Haptic feedback (mobile)

## API Contract

### Request
```http
POST /api/purchases/restore
Authorization: Bearer {session_token}
Content-Type: application/json
```

### Response (Success)
```json
{
  "restored": [
    {
      "id": "pur_01H8...",
      "productId": "notes_100",
      "provider": "apple_iap",
      "notesGranted": 100,
      "createdAt": "2026-06-07T12:00:00Z"
    }
  ],
  "totalNotes": 100,
  "newPurchases": 0  // Purchases not previously in DB
}
```

### Response (Error)
```json
{
  "error": "restore_failed",
  "message": "Failed to restore purchases",
  "details": {
    "provider": "apple_iap",
    "reason": "receipt_invalid"
  }
}
```

## Security Considerations

1. **Receipt Verification**: Always verify receipts server-side, never trust client data.
2. **Idempotency**: Multiple restore calls should not duplicate purchases.
3. **Rate Limiting**: Limit restore requests to prevent abuse (e.g., 5/hour per user).
4. **Audit Log**: Log all restore attempts for fraud detection.

## User Experience

### Best Practices
- **Placement**: Include restore button on purchase screen (Topup page).
- **Visibility**: Make it easy to find but not prominent (secondary action).
- **Feedback**: Show clear success/failure messages.
- **Loading State**: Indicate progress during restore (can take 2-5 seconds).

### Error Handling
- Network errors → "Please check your connection"
- No purchases found → "No purchases to restore"
- Provider unavailable → "Service temporarily unavailable"

## Testing

### Test Cases
1. **New user, no purchases** → "No purchases to restore"
2. **User with existing purchases** → Return all purchases
3. **User reinstalls app** → Restore purchases from provider
4. **User switches devices** → Restore purchases from provider
5. **Refunded purchase** → Should not be restored
6. **Network error** → Show retry option

## References

- [Apple: Restoring Purchases](https://developer.apple.com/documentation/storekit/in-app_purchase/original_api_for_in-app_purchase/restoring_purchased_products)
- [Google: Restore Purchases](https://developer.android.com/google/play/billing/integrate#restore)
- [RevenueCat: Restoring Purchases](https://www.revenuecat.com/docs/getting-started/restoring-purchases)
- [A Complete Guide to Restoring Purchases](https://apphud.com/blog/restoring-purchases)
- [RevenueCat: Do I need a Restore Purchases button?](https://community.revenuecat.com/featured-articles-55/do-i-need-a-restore-purchases-button-391)

## Current Status

- ✅ API route created
- ✅ Basic DB query implemented
- ✅ UI button added
- ⏳ Provider integration (TODO)
- ⏳ Reconciliation logic (TODO)
- ⏳ Production-ready error handling (TODO)
