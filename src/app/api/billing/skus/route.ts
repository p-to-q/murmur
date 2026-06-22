/**
 * GET /api/billing/skus
 *
 * Returns top-up SKUs priced in the user's detected currency.
 * Accepts an optional `?currency=CNY` override for testing.
 */

import { NextRequest, NextResponse } from "next/server";
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

export const runtime = "edge";

export function GET(request: NextRequest) {
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
      },
    },
  );
}
