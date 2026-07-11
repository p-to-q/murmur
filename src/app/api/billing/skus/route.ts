/**
 * GET /api/billing/skus
 *
 * Returns top-up SKUs priced in the user's detected currency.
 * Accepts an optional `?currency=CNY` override for testing.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import {
  CUSTOM_TOPUP_MIN_CNY,
  CUSTOM_TOPUP_MIN_USD,
  CUSTOM_TOPUP_MAX_CNY,
  CUSTOM_TOPUP_MAX_USD,
  CUSTOM_TOPUP_NOTES_PER_CNY,
  CUSTOM_TOPUP_NOTES_PER_USD,
  TOPUP_SKUS,
  getRegionalPrice,
  type Currency,
} from "@murmur/core";

import { detectCurrencyFromHeaders } from "@/lib/geo/region";

// nodejs (not edge): the shared rate limiter's production store is
// Postgres-backed, and the postgres driver needs Node's net/tls/crypto,
// which the edge runtime cannot bundle.
export const runtime = "nodejs";

const ROUTE = "/api/billing/skus";
const RATE_LIMIT = { capacity: 60, refillWindowMs: 60_000 };

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const clientIp = clientIpFromHeaders(request.headers);

  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "read:ip",
    userId: clientIp,
    requestId,
    options: RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  const override = request.nextUrl.searchParams.get("currency");
  const currency: Currency =
    override?.toUpperCase() === "CNY"
      ? "CNY"
      : detectCurrencyFromHeaders(request.headers);

  const skus = TOPUP_SKUS.map((sku) => {
    const regional = getRegionalPrice(sku, currency);
    return {
      id: sku.id,
      notes: sku.notes,
      bonusNotes: sku.bonusNotes ?? 0,
      priceCents: regional.priceCents,
      currency: regional.currency,
      display: regional.display,
      highlight: sku.highlight ?? null,
    };
  });

  const custom =
    currency === "CNY"
      ? {
          minAmount: CUSTOM_TOPUP_MIN_CNY,
          maxAmount: CUSTOM_TOPUP_MAX_CNY,
          notesPerUnit: CUSTOM_TOPUP_NOTES_PER_CNY,
          currency: "CNY" as const,
        }
      : {
          minAmount: CUSTOM_TOPUP_MIN_USD,
          maxAmount: CUSTOM_TOPUP_MAX_USD,
          notesPerUnit: CUSTOM_TOPUP_NOTES_PER_USD,
          currency: "USD" as const,
        };

  return NextResponse.json(
    { currency, skus, custom },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=300",
        "X-Request-Id": requestId,
      },
    },
  );
}
