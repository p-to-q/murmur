"use client";

/**
 * CheckoutScreen — provider handoff page.
 *
 * Specced in docs/page-redesign.md §10 + docs/page-contracts.md §9.
 *
 * Just a state machine: idle → requesting → succeeded | canceled | failed.
 * The user blinks past this on a real provider integration. v2 v0 stub: we
 * read `?sku=…`, show the rotating copy + spinner for 1.4s, then route
 * back to "/" with a "+N notes added" toast.
 *
 * When Codex wires the real Stripe / WeChat / RevenueCat paths (Phase 4),
 * replace the stub timer with the provider call, keep the state machine.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { useTranslator } from "@/lib/i18n";
import { PageBackdrop } from "@/components/murmur/page-backdrop";

type Phase = "requesting" | "succeeded" | "canceled" | "failed";

const PROCESSING_INTERVAL_MS = 900;

// Mirrors TopupScreen's SKU table — kept tiny so this page renders without
// network even when /api/billing/skus isn't reachable.
const SKU_DISPLAY: Record<string, { notes: number; price: string }> = {
  topup_30_notes:  { notes: 30,  price: "$1.99" },
  topup_120_notes: { notes: 120, price: "$5.99" },
  topup_400_notes: { notes: 400, price: "$14.99" },
};

export function CheckoutScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslator();

  const skuId = params?.get("sku") ?? "topup_120_notes";
  const sku = SKU_DISPLAY[skuId] ?? SKU_DISPLAY.topup_120_notes!;

  const [phase, setPhase] = useState<Phase>("requesting");
  const [copyIdx, setCopyIdx] = useState(0);

  const PROCESSING_COPY = useMemo(
    () => [
      t("checkout.proc.opening")   || "opening secure checkout",
      t("checkout.proc.connecting")|| "connecting to provider",
      t("checkout.proc.confirming")|| "confirming purchase",
      t("checkout.proc.almost")    || "almost there",
    ],
    [t],
  );

  /* ── Stub flow ────────────────────────────────────────────────── */
  useEffect(() => {
    // Until Phase 4 lands, simulate a fast successful checkout so the
    // routing + state-machine UX can be exercised end-to-end.
    const id = window.setTimeout(() => {
      setPhase("succeeded");
      toast.success(
        (t("checkout.toast.success") || "+{notes} notes added.").replace(
          "{notes}",
          String(sku.notes),
        ),
      );
      window.setTimeout(() => router.push("/me"), 900);
    }, 1400);
    return () => window.clearTimeout(id);
  }, [router, sku.notes, t]);

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
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="eyebrow text-[#FF8A5C]"
            >
              {t("checkout.eyebrow") || "ALMOST THERE"}
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05, duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
              className="hero-serif mt-3 text-[#1A1A1A] text-[34px] leading-[1.04] md:text-[44px]"
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
                {sku.notes}
              </span>
              <span className="text-[11px] uppercase tracking-[0.22em] text-[#8C8780]">
                {t("checkout.notes") || "notes"}
              </span>
              <span className="text-[#D2C9B6]">·</span>
              <span className="font-serif-italic text-[16px] text-[#6F6A63]">
                {sku.price}
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
                      {t("checkout.failed") || "Something tripped on our end."}
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setPhase("requesting")}
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
