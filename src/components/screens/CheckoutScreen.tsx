"use client";

/**
 * CheckoutScreen — Murmur-owned receipt review + provider handoff.
 *
 * /topup owns package, currency, and payment-route choice. Checkout keeps a
 * quiet receipt review before opening the provider-hosted payment page.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, CreditCard, Mail, ShieldCheck } from "lucide-react";
import { signIn, useSession } from "next-auth/react";
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

import { ensureLocalCreatorSession } from "@/lib/auth/local-creator-client";
import { useI18nStore, useTranslator } from "@/lib/i18n";
import { fetchUserBalance } from "@/lib/hooks/use-user-balance";
import { MurmurMark } from "@/components/murmur/murmur-mark";
import { MurmurLoadingNote } from "@/components/murmur/murmur-loading-note";
import { PageBackdrop } from "@/components/murmur/page-backdrop";

type Phase =
  | "review"
  | "requesting"
  | "awaiting_payment"
  | "confirming"
  | "succeeded"
  | "canceled"
  | "failed";

type PayMethod = "card" | "wxpay";

type CheckoutPurchase =
  | {
      kind: "sku";
      id: string;
      display: string;
      notesGranted: number;
      currency: Currency;
    }
  | {
      kind: "custom";
      id: "topup_custom";
      display: string;
      notesGranted: number;
      currency: Currency;
      customAmountUsd?: number;
      customAmountCny?: number;
    };

const PROCESSING_INTERVAL_MS = 900;
const DEFAULT_SKU_ID = "topup_120_notes";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CheckoutScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslator();
  const lang = useI18nStore((state) => state.lang);
  const { data: session, status: sessionStatus } = useSession();

  const skuId = params?.get("sku") ?? DEFAULT_SKU_ID;
  const customAmountParam = params?.get("customAmountUsd");
  const customAmountCnyParam = params?.get("customAmountCny");
  const currencyParam = params?.get("currency");
  const requestedCurrency: Currency =
    currencyParam?.toUpperCase() === "CNY" ? "CNY" : "USD";
  const requestedPayMethod: PayMethod =
    params?.get("payMethod") === "wxpay" ? "wxpay" : "card";
  const returnStatus = params?.get("status");

  const [payMethod, setPayMethod] = useState<PayMethod>(requestedPayMethod);
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);
  const [billingEmail, setBillingEmail] = useState("");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(() =>
    returnStatus === "success"
      ? "confirming"
      : returnStatus === "canceled"
        ? "canceled"
        : "review",
  );
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [failureKind, setFailureKind] = useState<"sign_in_required" | "generic" | null>(null);
  const [copyIdx, setCopyIdx] = useState(0);
  const checkoutStartedRef = useRef(false);
  const billingEmailEditedRef = useRef(false);

  const purchase = useMemo<CheckoutPurchase>(() => {
    if (requestedCurrency === "CNY" && customAmountCnyParam) {
      const amountCny = Number(customAmountCnyParam);
      const cnyQuote = Number.isFinite(amountCny)
        ? getCustomTopupQuoteCny(amountCny)
        : null;
      if (cnyQuote) {
        return {
          kind: "custom",
          id: cnyQuote.id,
          display: cnyQuote.display,
          notesGranted: cnyQuote.notesGranted,
          customAmountCny: cnyQuote.faceAmount,
          currency: "CNY",
        };
      }
    }

    const customAmountUsd = customAmountParam ? Number(customAmountParam) : Number.NaN;
    const customQuote = Number.isFinite(customAmountUsd)
      ? getCustomTopupQuote(customAmountUsd)
      : null;
    if (customQuote) {
      return {
        kind: "custom",
        id: customQuote.id,
        display: customQuote.display,
        notesGranted: customQuote.notesGranted,
        customAmountUsd: customQuote.faceAmount,
        currency: "USD",
      };
    }

    const sku =
      getTopupSku(skuId) ?? getTopupSku(DEFAULT_SKU_ID) ?? TOPUP_SKUS[0]!;
    const regional = getRegionalPrice(sku, requestedCurrency);
    return {
      kind: "sku",
      id: sku.id,
      display: regional.display,
      notesGranted: topupNotesGranted(sku),
      currency: regional.currency,
    };
  }, [customAmountCnyParam, customAmountParam, requestedCurrency, skuId]);

  const hasSignedInUser = Boolean(session?.user);
  const routeBlocked = payMethod === "wxpay" && purchase.currency !== "CNY";
  const receiptDate = useMemo(() => formatReceiptDate(lang), [lang]);
  const PROCESSING_COPY = useMemo(
    () => [
      t("checkout.proc.opening") || "opening secure checkout",
      t("checkout.proc.connecting") || "connecting to provider",
      t("checkout.proc.confirming") || "confirming purchase",
      t("checkout.proc.almost") || "almost there",
    ],
    [t],
  );

  useEffect(() => {
    const sessionEmail = session?.user?.email;
    if (!sessionEmail || billingEmailEditedRef.current) return;
    setBillingEmail(sessionEmail);
  }, [session?.user?.email]);

  const finishSucceeded = useCallback(
    (granted: number) => {
      setPhase("succeeded");
      toast.success(
        (t("checkout.toast.success") || "+{notes} notes added.").replace(
          "{notes}",
          String(granted),
        ),
      );
      window.setTimeout(() => router.push("/me"), 1800);
    },
    [router, t],
  );

  const confirmGrant = useCallback(
    async (signal?: { cancelled: boolean }) => {
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
      finishSucceeded(purchase.notesGranted);
    },
    [finishSucceeded, purchase.notesGranted],
  );

  const beginCheckout = useCallback(async () => {
    setFailureMessage(null);
    setFailureKind(null);
    setCheckoutUrl(null);

    if (payMethod === "wxpay" && purchase.currency !== "CNY") {
      setFailureMessage(
        t("checkout.method_blocked") ||
          "WeChat Pay is only available for CNY orders.",
      );
      setFailureKind("generic");
      setPhase("failed");
      return;
    }

    setPhase("requesting");

    try {
      const baseBody =
        purchase.kind === "custom"
          ? "customAmountCny" in purchase && purchase.customAmountCny != null
            ? { customAmountCny: purchase.customAmountCny, currency: "CNY" }
            : {
                customAmountUsd: purchase.customAmountUsd,
                currency: purchase.currency,
              }
          : { sku: purchase.id, currency: purchase.currency };
      const checkoutBody =
        payMethod === "wxpay"
          ? { ...baseBody, payMethod, billingEmail: billingEmail.trim() }
          : { ...baseBody, billingEmail: billingEmail.trim() };

      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checkoutBody),
      });

      if (response.ok) {
        const data = (await response.json()) as { checkoutUrl?: string };
        if (data.checkoutUrl) {
          setCheckoutUrl(data.checkoutUrl);
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
        setPhase("confirming");
        window.setTimeout(() => finishSucceeded(purchase.notesGranted), 1400);
        return;
      }

      if (errorBody.error === "sign_in_required" || errorBody.error === "unauthorized") {
        setFailureMessage(
          t("checkout.sign_in_required") ||
            "Sign in first, then top up your notes.",
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
  }, [billingEmail, finishSucceeded, payMethod, purchase, t]);

  const handleSignIn = () => {
    const currentUrl = window.location.pathname + window.location.search;
    void (async () => {
      await ensureLocalCreatorSession();
      await signIn("google", { callbackUrl: currentUrl });
    })();
  };

  const handleBillingEmailChange = (value: string) => {
    billingEmailEditedRef.current = true;
    setBillingEmail(value);
  };

  const handlePrimaryAction = () => {
    if (sessionStatus === "loading") return;
    if (routeBlocked) {
      toast.info(
        t("checkout.method_blocked") ||
          "WeChat Pay is only available for CNY orders.",
      );
      return;
    }
    if (!hasSignedInUser) {
      handleSignIn();
      return;
    }
    if (!billingEmail.trim()) {
      toast.info(
        t("checkout.email_required") ||
          "A receipt email is required before checkout.",
      );
      return;
    }
    if (!EMAIL_RE.test(billingEmail.trim())) {
      toast.info(
        t("checkout.email_invalid") ||
          "Enter a valid email address for the receipt.",
      );
      return;
    }
    if (!acceptedPolicy) {
      toast.info(
        t("checkout.accept_required") ||
          "Accept the terms before continuing.",
      );
      return;
    }
    if (checkoutStartedRef.current) return;
    checkoutStartedRef.current = true;
    void beginCheckout();
  };

  const retryCheckout = () => {
    checkoutStartedRef.current = true;
    void beginCheckout();
  };

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
  }, [confirmGrant, returnStatus]);

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
        <header
          className="flex items-center justify-between px-5 pb-5 md:px-8"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 28px)" }}
        >
          <button
            onClick={() => router.push("/topup")}
            aria-label={t("common.back") || "Back"}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/55 bg-white/70 transition-colors hover:bg-white"
          >
            <ArrowLeft className="h-4 w-4 text-[#1A1A1A]" />
          </button>
          <div className="h-9 w-9" />
        </header>

        <main className="min-w-0 flex-1 overflow-x-hidden px-4 pb-16 md:px-8">
          <div className="mx-auto grid min-h-[calc(100svh-120px)] w-full min-w-0 max-w-5xl grid-cols-[minmax(0,1fr)] gap-8 py-4 md:grid-cols-[0.78fr_minmax(0,1.22fr)] md:items-center md:py-8">
            <section className="min-w-0 flex flex-col justify-center md:pb-10">
              <motion.h1
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.62, ease: [0.22, 1, 0.36, 1] }}
                className="hero-serif max-w-[10ch] text-[44px] leading-[1.02] text-[#1A1A1A] md:text-[70px]"
              >
                {phaseHeadline(phase, t)}
              </motion.h1>
            </section>

            <AnimatePresence mode="wait">
              <ReceiptCard
                key={phase}
                billingEmail={billingEmail}
                dateLabel={receiptDate}
                payMethod={payMethod}
                purchase={purchase}
                t={t}
                onBillingEmailChange={handleBillingEmailChange}
              >
                {phase === "review" ? (
                  <ReviewControls
                    acceptedPolicy={acceptedPolicy}
                    billingEmail={billingEmail}
                    hasSignedInUser={hasSignedInUser}
                    payMethod={payMethod}
                    routeBlocked={routeBlocked}
                    sessionStatus={sessionStatus}
                    t={t}
                    onAcceptPolicy={setAcceptedPolicy}
                    onBack={() => router.push("/topup")}
                    onPrimaryAction={handlePrimaryAction}
                    onUseCard={() => setPayMethod("card")}
                  />
                ) : (
                  <StatusControls
                    checkoutUrl={checkoutUrl}
                    copy={PROCESSING_COPY[copyIdx]}
                    failureKind={failureKind}
                    failureMessage={failureMessage}
                    payMethod={payMethod}
                    phase={phase}
                    t={t}
                    onAlreadyPaid={() => {
                      router.push(
                        `/topup/checkout?${successQueryFor(
                          purchase,
                          payMethod,
                        )}&status=success`,
                      );
                    }}
                    onBack={() => router.push("/topup")}
                    onRetry={retryCheckout}
                    onSignIn={handleSignIn}
                  />
                )}
              </ReceiptCard>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}

function ReceiptCard({
  billingEmail,
  children,
  dateLabel,
  payMethod,
  purchase,
  t,
  onBillingEmailChange,
}: {
  billingEmail: string;
  children: ReactNode;
  dateLabel: string;
  payMethod: PayMethod;
  purchase: CheckoutPurchase;
  t: (key: string) => string;
  onBillingEmailChange: (value: string) => void;
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto w-full max-w-[452px] overflow-hidden rounded-[8px] border border-white/70 bg-[#FFFEFB] shadow-[0_24px_80px_rgba(74,55,31,0.16)] sm:max-w-[470px]"
    >
      <div className="flex items-center justify-between gap-4 bg-[#1A1A1A] px-5 py-5 text-[#FFFEFB] sm:px-7 sm:py-6">
        <MurmurMark
          size={24}
          yOffset={-1}
          className="shrink-0"
          imageClassName="brightness-0 invert drop-shadow-none"
        />
        <p className="shrink-0 font-mono text-[10px] tracking-[0.12em] text-[#F5F1EB]/65 sm:text-[12px]">
          {dateLabel}
        </p>
      </div>

      <div className="relative bg-[#FFFEFB] px-4 py-6 sm:px-7 sm:py-7">
        <div className="grid grid-cols-[1fr_auto] border-b border-[#E7DCCB] pb-3 text-[11px] uppercase tracking-[0.22em] text-[#B6B0A4]">
          <span>{t("checkout.description") || "Description"}</span>
          <span>{t("checkout.subtotal") || "Subtotal"}</span>
        </div>

        <div className="mt-4 space-y-3">
          <ReceiptLine
            label={packageLabel(purchase, t)}
            value={purchase.display}
          />
          <ReceiptLine
            label={t("checkout.notes_granted") || "Notes granted"}
            value={`${purchase.notesGranted} ${t("checkout.notes") || "notes"}`}
          />
          <ReceiptLine
            label={t("checkout.payment_route") || "Payment route"}
            value={paymentMethodLabel(payMethod, t)}
            valueClassName={payMethod === "wxpay" ? "text-[#07A653]" : undefined}
          />
          <BillingEmailLine
            t={t}
            value={billingEmail}
            onChange={onBillingEmailChange}
          />
        </div>

        <div className="mt-7 flex items-end justify-between gap-4 border-t border-[#E7DCCB] pt-5">
          <p className="font-mono text-[15px] tracking-[0.1em] text-[#6F6A63]">
            {t("checkout.total") || "Total"}
          </p>
          <p className="min-w-0 max-w-[70%] truncate text-right font-serif text-[38px] leading-none text-[#1A1A1A] tabular-nums sm:text-[46px]">
            {purchase.display}
          </p>
        </div>

        <ReceiptTearLine />

        {children}
      </div>
    </motion.article>
  );
}

function ReviewControls({
  acceptedPolicy,
  billingEmail,
  hasSignedInUser,
  payMethod,
  routeBlocked,
  sessionStatus,
  t,
  onAcceptPolicy,
  onBack,
  onPrimaryAction,
  onUseCard,
}: {
  acceptedPolicy: boolean;
  billingEmail: string;
  hasSignedInUser: boolean;
  payMethod: PayMethod;
  routeBlocked: boolean;
  sessionStatus: "authenticated" | "loading" | "unauthenticated";
  t: (key: string) => string;
  onAcceptPolicy: (accepted: boolean) => void;
  onBack: () => void;
  onPrimaryAction: () => void;
  onUseCard: () => void;
}) {
  const primaryDisabled =
    sessionStatus === "loading" ||
    routeBlocked ||
    (hasSignedInUser && (!acceptedPolicy || !billingEmail.trim()));
  const primaryLabel = !hasSignedInUser
    ? t("checkout.sign_in_btn") || "Sign in"
    : t("checkout.continue") || "Pay securely";

  return (
    <div className="space-y-4">
      {routeBlocked && (
        <div className="rounded-[8px] border border-[#F0C7B6] bg-[#FFF1EC] p-3 text-left">
          <p className="text-[13px] leading-[1.55] text-[#7A3B27]">
            {t("checkout.method_blocked") ||
              "WeChat Pay is only available for CNY orders."}
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-[12px]">
            <button
              type="button"
              onClick={onUseCard}
              className="font-medium text-[#1A1A1A] underline-mm"
            >
              {t("checkout.use_card") || "Use card instead"}
            </button>
            <button
              type="button"
              onClick={onBack}
              className="text-[#6F6A63] underline-mm"
            >
              {t("checkout.change_topup") || "Change top up"}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-[8px] bg-[#F5F1EB]/65 p-3 text-left">
        <p className="flex items-center gap-2 text-[12px] font-medium text-[#1A1A1A]">
          <CreditCard className="h-3.5 w-3.5 text-[#8C8780]" />
          {paymentMethodLabel(payMethod, t)}
        </p>
        <p className="mt-1 text-[11px] leading-[1.45] text-[#8C8780]">
          {payMethod === "wxpay"
            ? t("checkout.wechat_route_note") ||
              "WeChat Pay opens through the China payment route."
            : t("checkout.card_route_note") ||
              "Card checkout opens through Waffo."}
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 text-left">
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors ${
            acceptedPolicy
              ? "border-[#FF5924] bg-[#FF5924] text-white"
              : "border-[#CFC5B7] bg-white text-transparent"
          }`}
        >
          <Check className="h-3.5 w-3.5" />
        </span>
        <input
          checked={acceptedPolicy}
          onChange={(event) => onAcceptPolicy(event.target.checked)}
          type="checkbox"
          className="sr-only"
        />
        <span className="text-[12px] leading-[1.6] text-[#6F6A63]">
          {t("checkout.agree_prefix") || "I have read and agree to the"}{" "}
          <Link
            href="/me/terms"
            target="_blank"
            rel="noreferrer"
            className="text-[#1A1A1A] underline-mm"
          >
            {t("checkout.terms") || "Terms"}
          </Link>
          ,{" "}
          <Link
            href="/me/privacy"
            target="_blank"
            rel="noreferrer"
            className="text-[#1A1A1A] underline-mm"
          >
            {t("checkout.privacy") || "Privacy"}
          </Link>{" "}
          {t("checkout.agree_and") || "and"}{" "}
          <Link
            href="/me/terms#refunds"
            target="_blank"
            rel="noreferrer"
            className="text-[#1A1A1A] underline-mm"
          >
            {t("checkout.refund_policy") || "Refund policy"}
          </Link>
          .
        </span>
      </label>

      <button
        type="button"
        onClick={onPrimaryAction}
        disabled={primaryDisabled}
        className="mm-btn-primary h-12 w-full justify-center disabled:pointer-events-none disabled:opacity-45"
      >
        <ShieldCheck className="h-4 w-4" />
        {primaryLabel}
      </button>
    </div>
  );
}

function StatusControls({
  checkoutUrl,
  copy,
  failureKind,
  failureMessage,
  payMethod,
  phase,
  t,
  onAlreadyPaid,
  onBack,
  onRetry,
  onSignIn,
}: {
  checkoutUrl: string | null;
  copy: string;
  failureKind: "sign_in_required" | "generic" | null;
  failureMessage: string | null;
  payMethod: PayMethod;
  phase: Exclude<Phase, "review">;
  t: (key: string) => string;
  onAlreadyPaid: () => void;
  onBack: () => void;
  onRetry: () => void;
  onSignIn: () => void;
}) {
  const provider = payMethod === "wxpay" ? "WeChat Pay" : "Waffo";

  return (
    <div className="text-center">
      {(phase === "requesting" || phase === "confirming") && (
        <div className="flex min-h-[132px] flex-col items-center justify-center gap-4">
          <MurmurLoadingNote size="page" />
          <AnimatePresence mode="wait">
            <motion.p
              key={phase === "confirming" ? "confirming" : copy}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.28 }}
              className="font-serif-italic text-[15px] text-[#6F6A63]"
            >
              {phase === "confirming" ? t("checkout.confirming_grant") : copy}
            </motion.p>
          </AnimatePresence>
        </div>
      )}

      {phase === "awaiting_payment" && (
        <div className="flex min-h-[150px] flex-col items-center justify-center gap-4">
          <p className="font-serif-italic text-[20px] text-[#1A1A1A]">
            {t("checkout.awaiting_payment") ||
              "Complete payment in the other tab."}
          </p>
          <p className="max-w-sm text-[13px] leading-[1.65] text-[#8C8780]">
            {(t("checkout.awaiting_payment_hint") ||
              "When you finish, you'll return here automatically. You can also reopen the {provider} checkout.").replace(
              "{provider}",
              provider,
            )}
          </p>
          {checkoutUrl && (
            <a
              href={checkoutUrl}
              target="_blank"
              rel="noreferrer"
              className="mm-btn-primary mt-1 inline-flex"
            >
              {t("checkout.open_again") || "Open secure checkout"}
            </a>
          )}
          <button
            onClick={onAlreadyPaid}
            className="text-[13px] tracking-[0.04em] text-[#8C8780] underline-mm transition-colors hover:text-[#1A1A1A]"
          >
            {t("checkout.already_paid") || "I already paid"}
          </button>
        </div>
      )}

      {phase === "succeeded" && (
        <div className="flex min-h-[132px] flex-col items-center justify-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#5F8A6B]/12 text-[#5F8A6B]">
            <Check className="h-5 w-5" />
          </span>
          <p className="font-serif-italic text-[21px] text-[#1A1A1A]">
            {t("checkout.ok") || "All set."}
          </p>
          <p className="text-[12px] text-[#8C8780]">
            {t("checkout.redirecting") || "taking you back..."}
          </p>
        </div>
      )}

      {phase === "canceled" && (
        <div className="flex min-h-[132px] flex-col items-center justify-center gap-4">
          <p className="font-serif-italic text-[18px] text-[#6F6A63]">
            {t("checkout.canceled") || "No worries. Try again?"}
          </p>
          <button onClick={onBack} className="mm-btn-primary">
            {t("checkout.retry") || "Pick a top up"}
          </button>
        </div>
      )}

      {phase === "failed" && (
        <div className="flex min-h-[145px] flex-col items-center justify-center gap-4">
          <p className="max-w-sm font-serif-italic text-[18px] text-[#6F6A63]">
            {failureMessage ||
              t("checkout.failed") ||
              "Something tripped on our end."}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {failureKind === "sign_in_required" ? (
              <button onClick={onSignIn} className="mm-btn-primary">
                {t("checkout.sign_in_btn") || "Sign in"}
              </button>
            ) : (
              <button onClick={onRetry} className="mm-btn-primary">
                {t("checkout.try_again") || "Try again"}
              </button>
            )}
            <button
              onClick={onBack}
              className="text-[13px] tracking-[0.04em] text-[#8C8780] underline-mm transition-colors hover:text-[#1A1A1A]"
            >
              {failureKind === "sign_in_required"
                ? t("common.back") || "Back"
                : t("checkout.different") || "use a different method"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReceiptLine({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 font-mono text-[12px] leading-[1.5] sm:gap-4 sm:text-[13px]">
      <span className="min-w-0 truncate text-[#6F6A63]">{label}</span>
      <span className={`max-w-[10rem] truncate text-right text-[#1A1A1A] sm:max-w-[13rem] ${valueClassName ?? ""}`}>
        {value}
      </span>
    </div>
  );
}

function BillingEmailLine({
  t,
  value,
  onChange,
}: {
  t: (key: string) => string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 font-mono text-[12px] leading-[1.5] sm:grid-cols-[minmax(0,1fr)_minmax(9rem,13rem)] sm:items-center sm:gap-4 sm:text-[13px]">
      <label
        htmlFor="checkout-billing-email"
        className="flex min-w-0 items-center gap-2 text-[#6F6A63]"
      >
        <Mail className="h-3.5 w-3.5 shrink-0 text-[#8C8780]" />
        <span className="truncate">
          {t("checkout.billing_email") || "Billing email"}
        </span>
      </label>
      <input
        id="checkout-billing-email"
        type="email"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("checkout.email_placeholder") || "you@example.com"}
        autoComplete="email"
        className="min-w-0 rounded-[6px] border border-[#E7DCCB] bg-white/70 px-2.5 py-1.5 text-left text-[#1A1A1A] outline-none transition-colors placeholder:text-[#B6B0A4] focus:border-[#FF5924] focus:bg-white sm:text-right"
      />
    </div>
  );
}

function ReceiptTearLine() {
  return (
    <div className="relative -mx-4 my-7 h-8 sm:-mx-7" aria-hidden>
      <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-[#D8CDBB]" />
      <span className="absolute left-[-15px] top-1/2 h-8 w-8 -translate-y-1/2 rounded-full bg-[#F5F1EB] shadow-[inset_-1px_0_0_rgba(210,201,182,0.65)]" />
      <span className="absolute right-[-15px] top-1/2 h-8 w-8 -translate-y-1/2 rounded-full bg-[#F5F1EB] shadow-[inset_1px_0_0_rgba(210,201,182,0.65)]" />
    </div>
  );
}

function packageLabel(purchase: CheckoutPurchase, t: (key: string) => string): string {
  if (purchase.kind === "custom") {
    return t("checkout.custom_topup") || "Custom top-up";
  }
  return t("checkout.murmur_notes") || "Murmur Notes";
}

function paymentMethodLabel(method: PayMethod, t: (key: string) => string): string {
  return method === "wxpay"
    ? t("topup.payment.wechat") || "WeChat Pay"
    : t("topup.payment.card") || "Card";
}

function successQueryFor(purchase: CheckoutPurchase, payMethod: PayMethod): string {
  const query = new URLSearchParams();
  if (purchase.kind === "custom") {
    if (purchase.customAmountCny != null) {
      query.set("customAmountCny", String(purchase.customAmountCny));
      query.set("currency", "CNY");
    } else if (purchase.customAmountUsd != null) {
      query.set("customAmountUsd", String(purchase.customAmountUsd));
    }
  } else {
    query.set("sku", purchase.id);
    query.set("currency", purchase.currency);
  }
  if (payMethod === "wxpay") query.set("payMethod", "wxpay");
  return query.toString();
}

function formatReceiptDate(lang: "zh" | "en"): string {
  try {
    return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function phaseHeadline(phase: Phase, t: (key: string) => string): string {
  switch (phase) {
    case "review":
      return t("checkout.headline.review") || "Confirm this top up.";
    case "requesting":
      return t("checkout.headline.requesting") || "Holding the door open.";
    case "awaiting_payment":
      return t("checkout.headline.awaiting") || "Finish in the other tab.";
    case "confirming":
      return t("checkout.headline.confirming") || "Confirming your notes...";
    case "succeeded":
      return t("checkout.headline.ok") || "Done. Enjoy.";
    case "canceled":
      return t("checkout.headline.canceled") || "You stepped back.";
    case "failed":
      return t("checkout.headline.failed") || "Couldn't finish that.";
  }
}
