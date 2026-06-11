"use client";

/**
 * CheckoutScreen — provider handoff page.
 *
 * Specced in docs/page-redesign.md §10 + docs/page-contracts.md §9.
 *
 * State machine: idle → requesting → succeeded | canceled | failed.
 *
 * Real flow (Stripe):
 *   1. Land here with `?sku=…` → POST /api/billing/checkout → redirect to
 *      the Stripe-hosted page.
 *   2. Stripe sends the user back with `?status=success|canceled`; the
 *      ledger grant itself happens server-side via /api/billing/webhook.
 *
 * Dev without STRIPE_SECRET_KEY: the API answers 503 stripe_not_configured
 * and we simulate the post-payment return leg so the routing UX stays
 * exercisable end-to-end.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import {
  getCustomTopupQuote,
  getTopupSku,
  topupNotesGranted,
  TOPUP_SKUS,
} from "@murmur/core";

import { useTranslator } from "@/lib/i18n";
import { PageBackdrop } from "@/components/murmur/page-backdrop";

type Phase = "requesting" | "succeeded" | "canceled" | "failed";

const PROCESSING_INTERVAL_MS = 900;
const DEFAULT_SKU_ID = "topup_120_notes";

export function CheckoutScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslator();

  const skuId = params?.get("sku") ?? DEFAULT_SKU_ID;
  const customAmountParam = params?.get("customAmountUsd");
  const returnStatus = params?.get("status");
  const purchase = useMemo(
    () => {
      const customAmountUsd = customAmountParam ? Number(customAmountParam) : Number.NaN;
      const customQuote = Number.isFinite(customAmountUsd)
        ? getCustomTopupQuote(customAmountUsd)
        : null;
      if (customQuote) {
        return {
          kind: "custom" as const,
          id: customQuote.id,
          display: customQuote.display,
          notesGranted: customQuote.notesGranted,
          customAmountUsd: customQuote.amountUsd,
        };
      }

      const sku = getTopupSku(skuId) ?? getTopupSku(DEFAULT_SKU_ID) ?? TOPUP_SKUS[0]!;
      return {
        kind: "sku" as const,
        id: sku.id,
        display: sku.display,
        notesGranted: topupNotesGranted(sku),
      };
    },
    [customAmountParam, skuId],
  );
  const skuNotes = purchase.notesGranted;

  const [phase, setPhase] = useState<Phase>(() =>
    returnStatus === "success"
      ? "succeeded"
      : returnStatus === "canceled"
        ? "canceled"
        : "requesting",
  );
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [copyIdx, setCopyIdx] = useState(0);
  const checkoutStartedRef = useRef(false);

  const PROCESSING_COPY = useMemo(
    () => [
      t("checkout.proc.opening")   || "opening secure checkout",
      t("checkout.proc.connecting")|| "connecting to provider",
      t("checkout.proc.confirming")|| "confirming purchase",
      t("checkout.proc.almost")    || "almost there",
    ],
    [t],
  );

  const celebrate = useCallback(() => {
    setPhase("succeeded");
    toast.success(
      (t("checkout.toast.success") || "+{notes} notes added.").replace(
        "{notes}",
        String(skuNotes),
      ),
    );
    window.setTimeout(() => router.push("/me"), 1600);
  }, [router, skuNotes, t]);

  const beginCheckout = useCallback(async () => {
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          purchase.kind === "custom"
            ? { customAmountUsd: purchase.customAmountUsd }
            : { sku: purchase.id },
        ),
      });

      if (response.ok) {
        const data = (await response.json()) as { checkoutUrl?: string };
        if (data.checkoutUrl) {
          window.location.assign(data.checkoutUrl);
          return;
        }
        throw new Error("missing checkoutUrl");
      }

      const errorBody = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };

      // No Stripe keys in local dev — simulate the post-payment return leg
      // so the routing UX stays exercisable.
      if (
        errorBody.error === "stripe_not_configured" &&
        process.env.NODE_ENV === "development"
      ) {
        window.setTimeout(celebrate, 1400);
        return;
      }

      if (errorBody.error === "sign_in_required") {
        setFailureMessage(
          t("checkout.sign_in_required") || "请先登录再购买灵感币。",
        );
        setPhase("failed");
        return;
      }

      setFailureMessage(errorBody.message ?? null);
      setPhase("failed");
    } catch {
      setFailureMessage(null);
      setPhase("failed");
    }
  }, [celebrate, purchase, t]);

  const retryCheckout = () => {
    setFailureMessage(null);
    setPhase("requesting");
    void beginCheckout();
  };

  /* ── Kick off side effects for the landing state. Phase itself is
        initialized from the URL, so this never calls setState directly. ── */
  useEffect(() => {
    if (returnStatus === "success") {
      toast.success(
        (t("checkout.toast.success") || "+{notes} notes added.").replace(
          "{notes}",
          String(skuNotes),
        ),
      );
      const id = window.setTimeout(() => router.push("/me"), 1600);
      return () => window.clearTimeout(id);
    }
    if (returnStatus === "canceled") return;
    if (checkoutStartedRef.current) return;
    checkoutStartedRef.current = true;
    void beginCheckout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnStatus]);

  useEffect(() => {
    if (phase !== "requesting") return;
    const id = window.setInterval(() => {
      setCopyIdx((i) => (i + 1) % PROCESSING_COPY.length);
    }, PROCESSING_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [phase, PROCESSING_COPY.length]);

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div className="relative z-10 flex min-h-svh flex-col">
        <div
          className="flex items-center justify-between px-5 pb-5 md:px-8"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 28px)" }}
        >
          <button
            onClick={() => router.push("/topup")}
            aria-label={t("common.back") || "Back"}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/55 bg-white/70 hover:bg-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4 text-[#1A1A1A]" />
          </button>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#8C8780]">
            {t("checkout.header") || "CHECKOUT"}
          </p>
          <div className="h-9 w-9" />
        </div>

        <div className="flex-1 px-6 md:px-8 pb-16 flex flex-col items-center justify-center">
          <div className="w-full max-w-[480px] text-center">
            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05, duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
              className="hero-serif text-[#1A1A1A] text-[34px] leading-[1.04] md:text-[44px]"
            >
              {phaseHeadline(phase, t)}
            </motion.h1>

            {/* SKU summary */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.18, duration: 0.5 }}
              className="mx-auto mt-7 inline-flex items-baseline gap-3 rounded-full border border-[#E5DDD0] bg-[#FFFEFB]/80 px-5 py-2.5"
            >
              <span className="font-serif text-[#1A1A1A] text-[22px] tabular-nums">
                {skuNotes}
              </span>
              <span className="text-[11px] uppercase tracking-[0.22em] text-[#8C8780]">
                {t("checkout.notes") || "notes"}
              </span>
              <span className="text-[#D2C9B6]">·</span>
              <span className="font-serif-italic text-[16px] text-[#6F6A63]">
                {purchase.display}
              </span>
            </motion.div>

            {/* Phase-dependent body */}
            <div className="mt-10 min-h-[80px] flex flex-col items-center justify-center">
              <AnimatePresence mode="wait">
                {phase === "requesting" && (
                  <motion.div
                    key="req"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="flex flex-col items-center gap-4"
                  >
                    <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#FF5924] border-t-transparent" />
                    <AnimatePresence mode="wait">
                      <motion.p
                        key={`copy-${copyIdx}`}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.28 }}
                        className="font-serif-italic text-[14px] text-[#6F6A63]"
                      >
                        {PROCESSING_COPY[copyIdx]}
                      </motion.p>
                    </AnimatePresence>
                  </motion.div>
                )}

                {phase === "succeeded" && (
                  <motion.div
                    key="ok"
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-3"
                  >
                    <p className="font-serif-italic text-[18px] text-[#1A1A1A]">
                      {t("checkout.ok") || "All set."}
                    </p>
                    <p className="text-[12px] text-[#8C8780]">
                      {t("checkout.redirecting") || "taking you back…"}
                    </p>
                  </motion.div>
                )}

                {phase === "canceled" && (
                  <motion.div
                    key="cancel"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-4"
                  >
                    <p className="font-serif-italic text-[16px] text-[#6F6A63]">
                      {t("checkout.canceled") || "No worries. Try again?"}
                    </p>
                    <button
                      onClick={() => router.push("/topup")}
                      className="mm-btn-primary"
                    >
                      {t("checkout.retry") || "Pick a top up"}
                    </button>
                  </motion.div>
                )}

                {phase === "failed" && (
                  <motion.div
                    key="fail"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-4"
                  >
                    <p className="font-serif-italic text-[16px] text-[#6F6A63]">
                      {failureMessage ||
                        t("checkout.failed") ||
                        "Something tripped on our end."}
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={retryCheckout}
                        className="mm-btn-primary"
                      >
                        {t("checkout.try_again") || "Try again"}
                      </button>
                      <button
                        onClick={() => router.push("/topup")}
                        className="text-[13px] tracking-[0.04em] text-[#8C8780] hover:text-[#1A1A1A] underline-mm transition-colors"
                      >
                        {t("checkout.different") || "use a different method"}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function phaseHeadline(phase: Phase, t: (k: string) => string): string {
  switch (phase) {
    case "requesting":
      return t("checkout.headline.requesting") || "Holding the door open.";
    case "succeeded":
      return t("checkout.headline.ok") || "Done. Enjoy.";
    case "canceled":
      return t("checkout.headline.canceled") || "You stepped back.";
    case "failed":
      return t("checkout.headline.failed") || "Couldn't finish that.";
  }
}
