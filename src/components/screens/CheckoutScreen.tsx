"use client";

/**
 * CheckoutScreen — provider handoff page.
 *
 * Specced in docs/page-redesign.md §10 + docs/page-contracts.md §9.
 *
 * State machine: idle → requesting → succeeded | canceled | failed.
 *
 * Real flow (Waffo Pancake):
 *   1. Land here with `?sku=…` → POST /api/billing/checkout → open
 *      Waffo-hosted checkout in a new tab.
 *   2. Waffo sends the user back with `?status=success|canceled`; the
 *      ledger grant happens server-side via /api/billing/webhook.
 *
 * Dev without Waffo keys: the API answers 503 waffo_not_configured
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
  getCustomTopupQuoteCny,
  getRegionalPrice,
  getTopupSku,
  topupNotesGranted,
  TOPUP_SKUS,
  type Currency,
} from "@murmur/core";

import { signIn } from "next-auth/react";

import { useTranslator } from "@/lib/i18n";
import { ensureLocalCreatorSession } from "@/lib/auth/local-creator-client";
import { fetchUserBalance } from "@/lib/hooks/use-user-balance";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { Spinner } from "@/components/ui/spinner";

type Phase = "requesting" | "awaiting_payment" | "confirming" | "succeeded" | "canceled" | "failed";

const PROCESSING_INTERVAL_MS = 900;
const DEFAULT_SKU_ID = "topup_120_notes";

export function CheckoutScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslator();

  const skuId = params?.get("sku") ?? DEFAULT_SKU_ID;
  const customAmountParam = params?.get("customAmountUsd");
  const customAmountCnyParam = params?.get("customAmountCny");
  const currencyParam = params?.get("currency");
  const requestedCurrency: Currency =
    currencyParam?.toUpperCase() === "CNY" ? "CNY" : "USD";
  const payMethodParam = params?.get("payMethod");
  const returnStatus = params?.get("status");
  const purchase = useMemo(
    () => {
      // CNY custom topup
      if (requestedCurrency === "CNY" && customAmountCnyParam) {
        const amountCny = Number(customAmountCnyParam);
        const cnyQuote = Number.isFinite(amountCny)
          ? getCustomTopupQuoteCny(amountCny)
          : null;
        if (cnyQuote) {
          return {
            kind: "custom" as const,
            id: cnyQuote.id,
            display: cnyQuote.display,
            notesGranted: cnyQuote.notesGranted,
            customAmountCny: cnyQuote.faceAmount,
            currency: "CNY" as Currency,
          };
        }
      }

      // USD custom topup
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
          customAmountUsd: customQuote.faceAmount,
          currency: "USD" as Currency,
        };
      }

      // Fixed SKU
      const sku = getTopupSku(skuId) ?? getTopupSku(DEFAULT_SKU_ID) ?? TOPUP_SKUS[0]!;
      const regional = getRegionalPrice(sku, requestedCurrency);
      return {
        kind: "sku" as const,
        id: sku.id,
        display: regional.display,
        notesGranted: topupNotesGranted(sku),
        currency: regional.currency,
      };
    },
    [customAmountParam, customAmountCnyParam, requestedCurrency, skuId],
  );
  const skuNotes = purchase.notesGranted;

  const [phase, setPhase] = useState<Phase>(() =>
    returnStatus === "success"
      ? "confirming"
      : returnStatus === "canceled"
        ? "canceled"
        : "requesting",
  );
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [failureKind, setFailureKind] = useState<"sign_in_required" | "generic" | null>(null);
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

  const finishSucceeded = useCallback(
    (granted: number) => {
      setPhase("succeeded");
      toast.success(
        (t("checkout.toast.success") || "+{notes} notes added.").replace(
          "{notes}",
          String(granted),
        ),
      );
      window.setTimeout(() => router.push("/me"), 1600);
    },
    [router, t],
  );

  /**
   * Post-payment leg: briefly poll the ledger so the toast shows the real
   * grant once the webhook lands. The webhook is the source of truth — if
   * it already landed before we measured the baseline (or is slow), we
   * fall back to the SKU amount instead of stalling the user.
   */
  const confirmGrant = useCallback(
    async (signal?: { cancelled: boolean }) => {
      // Phase is already "confirming" — the useState initializer reads the
      // `?status=success` return leg, which is the only path that runs this.
      const baseline = await fetchUserBalance({ force: true }).catch(() => null);
      const baselineNotes = baseline?.balance?.notes ?? null;
      for (let attempt = 0; attempt < 8; attempt++) {
        if (signal?.cancelled) return;
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        const next = await fetchUserBalance({ force: true }).catch(() => null);
        const nextNotes = next?.balance?.notes;
        if (
          typeof nextNotes === "number" &&
          baselineNotes !== null &&
          nextNotes > baselineNotes
        ) {
          if (signal?.cancelled) return;
          finishSucceeded(nextNotes - baselineNotes);
          return;
        }
      }
      if (signal?.cancelled) return;
      finishSucceeded(skuNotes);
    },
    [finishSucceeded, skuNotes],
  );

  const beginCheckout = useCallback(async () => {
    try {
      const baseBody =
        purchase.kind === "custom"
          ? "customAmountCny" in purchase && purchase.customAmountCny != null
            ? { customAmountCny: purchase.customAmountCny, currency: "CNY" }
            : { customAmountUsd: purchase.customAmountUsd, currency: purchase.currency }
          : { sku: purchase.id, currency: purchase.currency };
      const checkoutBody =
        payMethodParam === "alipay" || payMethodParam === "wxpay"
          ? { ...baseBody, payMethod: payMethodParam }
          : baseBody;

      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checkoutBody),
      });

      if (response.ok) {
        const data = (await response.json()) as { checkoutUrl?: string };
        if (data.checkoutUrl) {
          window.open(data.checkoutUrl, "_blank", "noopener,noreferrer");
          setPhase("awaiting_payment");
          return;
        }
        throw new Error("missing checkoutUrl");
      }

      const errorBody = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };

      if (errorBody.error === "waffo_not_configured") {
        // Keyless local dev: simulate the post-payment leg so the routing
        // UX stays exercisable. No webhook will land, so skip polling.
        setPhase("confirming");
        window.setTimeout(() => finishSucceeded(skuNotes), 1400);
        return;
      }

      if (errorBody.error === "sign_in_required" || errorBody.error === "unauthorized") {
        setFailureMessage(
          t("checkout.sign_in_required") || "Sign in first, then top up your notes.",
        );
        setFailureKind("sign_in_required");
        setPhase("failed");
        return;
      }

      setFailureMessage(errorBody.message ?? null);
      setFailureKind("generic");
      setPhase("failed");
    } catch {
      setFailureMessage(null);
      setFailureKind("generic");
      setPhase("failed");
    }
  }, [finishSucceeded, payMethodParam, purchase, skuNotes, t]);

  const retryCheckout = () => {
    setFailureMessage(null);
    setFailureKind(null);
    setPhase("requesting");
    void beginCheckout();
  };

  const handleSignIn = () => {
    const currentUrl = window.location.pathname + window.location.search;
    void (async () => {
      await ensureLocalCreatorSession();
      await signIn("google", { callbackUrl: currentUrl });
    })();
  };

  /* ── Kick off side effects for the landing state. Phase itself is
        initialized from the URL, so this never calls setState directly. ── */
  useEffect(() => {
    if (returnStatus === "success") {
      const signal = { cancelled: false };
      void (async () => {
        await confirmGrant(signal);
      })();
      return () => {
        signal.cancelled = true;
      };
    }
    if (returnStatus === "canceled") return;
    if (checkoutStartedRef.current) return;
    checkoutStartedRef.current = true;
    void beginCheckout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnStatus]);

  useEffect(() => {
    if (phase !== "requesting" && phase !== "confirming") return;
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
                {phase === "awaiting_payment" && (
                  <motion.div
                    key="await"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-4"
                  >
                    <p className="font-serif-italic text-[15px] text-[#1A1A1A]">
                      {t("checkout.awaiting_payment") || "Complete payment in the other tab."}
                    </p>
                    <p className="text-[12px] text-[#8C8780] max-w-xs">
                      {t("checkout.awaiting_payment_hint") ||
                        "When you finish, you'll return here automatically. You can also close the tab and come back."}
                    </p>
                    <button
                      onClick={() => {
                        const base = purchase.kind === "custom"
                          ? "customAmountCny" in purchase && purchase.customAmountCny != null
                            ? `customAmountCny=${purchase.customAmountCny}&currency=CNY`
                            : `customAmountUsd=${"customAmountUsd" in purchase ? purchase.customAmountUsd : ""}`
                          : `sku=${purchase.id}${purchase.currency === "CNY" ? "&currency=CNY" : ""}`;
                        router.push(`/topup/checkout?${base}&status=success`);
                      }}
                      className="text-[13px] tracking-[0.04em] text-[#8C8780] hover:text-[#1A1A1A] underline-mm transition-colors"
                    >
                      {t("checkout.already_paid") || "I already paid"}
                    </button>
                  </motion.div>
                )}

                {phase === "requesting" && (
                  <motion.div
                    key="req"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="flex flex-col items-center gap-4"
                  >
                    <Spinner size="lg" />
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

                {phase === "confirming" && (
                  <motion.div
                    key="confirm"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-4"
                  >
                    <Spinner size="lg" />
                    <p className="font-serif-italic text-[14px] text-[#6F6A63]">
                      {t("checkout.confirming_grant")}
                    </p>
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
                      {failureKind === "sign_in_required" ? (
                        <button
                          onClick={handleSignIn}
                          className="mm-btn-primary"
                        >
                          {t("checkout.sign_in_btn") || "Sign in"}
                        </button>
                      ) : (
                        <button
                          onClick={retryCheckout}
                          className="mm-btn-primary"
                        >
                          {t("checkout.try_again") || "Try again"}
                        </button>
                      )}
                      <button
                        onClick={() => router.push("/topup")}
                        className="text-[13px] tracking-[0.04em] text-[#8C8780] hover:text-[#1A1A1A] underline-mm transition-colors"
                      >
                        {failureKind === "sign_in_required"
                          ? (t("common.back") || "back")
                          : (t("checkout.different") || "use a different method")}
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
    case "awaiting_payment":
      return t("checkout.headline.awaiting") || "Finish in the other tab.";
    case "confirming":
      return t("checkout.headline.confirming") || "Confirming your notes…";
    case "succeeded":
      return t("checkout.headline.ok") || "Done. Enjoy.";
    case "canceled":
      return t("checkout.headline.canceled") || "You stepped back.";
    case "failed":
      return t("checkout.headline.failed") || "Couldn't finish that.";
  }
}
