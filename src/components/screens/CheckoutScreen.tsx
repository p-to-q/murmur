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
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CreditCard,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { signIn } from "next-auth/react";
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
import { useCurrentAccount } from "@/lib/hooks/use-current-account";
import { fetchUserBalance } from "@/lib/hooks/use-user-balance";
import { MurmurMark } from "@/components/murmur/murmur-mark";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { Spinner } from "@/components/ui/spinner";

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

const DEFAULT_SKU_ID = "topup_120_notes";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHECKOUT_BASELINE_STORAGE_KEY = "murmur.checkout.baseline.v1";
const CHECKOUT_BASELINE_MAX_AGE_MS = 30 * 60 * 1000;

export function CheckoutScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslator();
  const lang = useI18nStore((state) => state.lang);
  const {
    user,
    isRegistered,
    isLoading: accountLoading,
  } = useCurrentAccount();

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
  const [receiptTorn, setReceiptTorn] = useState(returnStatus === "success");
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

  const hasSignedInUser = isRegistered;
  const routeBlocked = payMethod === "wxpay" && purchase.currency !== "CNY";
  const receiptDate = useMemo(() => formatReceiptDate(lang), [lang]);
  const tearReceiptIfCurrentPage = useCallback(() => {
    window.setTimeout(() => {
      if (document.visibilityState === "visible") setReceiptTorn(true);
    }, 80);
  }, []);
  const isReceiptTorn = returnStatus === "success" || receiptTorn;
  const isCheckoutBusy = phase === "requesting" || phase === "confirming";

  useEffect(() => {
    if (!user?.email || billingEmailEditedRef.current) return;
    setBillingEmail(user.email);
  }, [user?.email]);

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
      const baselineNotes = readCheckoutBaselineNotes() ?? baseline?.balance?.notes ?? null;
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
          clearCheckoutBaselineNotes();
          finishSucceeded(nextNotes - baselineNotes);
          return;
        }
      }
      if (signal?.cancelled) return;
      setFailureMessage(
        t("checkout.grant_pending") ||
          "Payment is still being confirmed. Refresh your balance in a moment.",
      );
      setFailureKind("generic");
      setPhase("failed");
    },
    [finishSucceeded, t],
  );

  const beginCheckout = useCallback(async () => {
    setFailureMessage(null);
    setFailureKind(null);
    setCheckoutUrl(null);
    setReceiptTorn(false);

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

      const startingBalance = await fetchUserBalance({ force: true }).catch(() => null);
      writeCheckoutBaselineNotes(startingBalance?.balance?.notes);

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
          tearReceiptIfCurrentPage();
          return;
        }
        throw new Error("missing checkoutUrl");
      }

      const errorBody = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };

      if (errorBody.error === "waffo_not_configured") {
        setFailureMessage(
          t("checkout.provider_unavailable") ||
            "Payment is not configured for this deployment yet.",
        );
        setFailureKind("generic");
        setPhase("failed");
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
  }, [billingEmail, payMethod, purchase, t, tearReceiptIfCurrentPage]);

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
    if (accountLoading) return;
    if (phase === "requesting" || phase === "confirming" || phase === "succeeded") {
      return;
    }
    if (phase === "awaiting_payment") {
      if (checkoutUrl) {
        window.open(checkoutUrl, "_blank", "noopener,noreferrer");
      }
      return;
    }
    if (phase === "canceled") {
      router.push("/topup");
      return;
    }
    if (phase === "failed") {
      if (failureKind === "sign_in_required") {
        handleSignIn();
      } else {
        retryCheckout();
      }
      return;
    }
    if (routeBlocked) {
      toast.info(
        t("checkout.method_blocked") ||
          "WeChat Pay is only available for CNY orders.",
      );
      return;
    }
    if (!hasSignedInUser) {
      toast.info(
        t("checkout.sign_in_required") ||
          "Sign in first, then top up your notes.",
      );
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

  return (
    <div className="relative min-h-svh overflow-x-hidden bg-[#F5F1EB]">
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

        <main className={`min-w-0 flex-1 overflow-x-hidden px-4 md:px-8 ${isReceiptTorn ? "pb-24 md:pb-28" : "pb-10 md:pb-16"}`}>
          <div className="mx-auto flex min-h-[calc(100svh-120px)] w-full min-w-0 max-w-[500px] items-start justify-center py-1 sm:items-center sm:py-6">
            <ReceiptCard
              billingEmail={billingEmail}
              dateLabel={receiptDate}
              isTorn={isReceiptTorn}
              payMethod={payMethod}
              purchase={purchase}
              t={t}
              onBillingEmailChange={handleBillingEmailChange}
            >
              <ReviewControls
                acceptedPolicy={acceptedPolicy}
                billingEmail={billingEmail}
                checkoutUrl={checkoutUrl}
                failureKind={failureKind}
                failureMessage={failureMessage}
                hasSignedInUser={hasSignedInUser}
                isAuthLoading={accountLoading}
                isBusy={isCheckoutBusy}
                payMethod={payMethod}
                phase={phase}
                routeBlocked={routeBlocked}
                t={t}
                onAcceptPolicy={setAcceptedPolicy}
                onPrimaryAction={handlePrimaryAction}
                onUseCard={() => setPayMethod("card")}
              />
            </ReceiptCard>
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
  isTorn,
  payMethod,
  purchase,
  t,
  onBillingEmailChange,
}: {
  billingEmail: string;
  children: ReactNode;
  dateLabel: string;
  isTorn: boolean;
  payMethod: PayMethod;
  purchase: CheckoutPurchase;
  t: (key: string) => string;
  onBillingEmailChange: (value: string) => void;
}) {
  const reduceMotion = useReducedMotion();
  const lowerTicketAnimate = isTorn
    ? reduceMotion
      ? { x: 8, y: 18, rotate: 0 }
      : { x: 14, y: 34, rotate: -2.2 }
    : { x: 0, y: 0, rotate: 0 };

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={`mx-auto w-full max-w-[428px] overflow-visible sm:max-w-[444px] ${
        isTorn
          ? ""
          : "rounded-[8px] shadow-[0_34px_110px_rgba(74,55,31,0.18)]"
      }`}
    >
      <motion.div
        animate={isTorn && !reduceMotion ? { y: -1 } : { y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className={`relative z-10 overflow-visible rounded-t-[8px] border border-b-0 border-white/80 bg-[#FFFEFB] ${
          isTorn ? "shadow-[0_28px_80px_rgba(74,55,31,0.15)]" : ""
        }`}
      >
        <div className="flex min-h-[94px] items-center justify-between gap-5 rounded-t-[8px] bg-[#141414] px-6 text-[#FFFEFB] sm:min-h-[102px] sm:px-7">
          <MurmurMark
            size={40}
            yOffset={-1}
            className="shrink-0"
            imageClassName="brightness-0 invert drop-shadow-none"
          />
          <p className="shrink-0 self-end pb-[25px] font-mono text-[10px] tracking-[0.18em] text-[#F5F1EB]/52 sm:text-[11px]">
            {dateLabel}
          </p>
        </div>

        <div className="relative bg-[linear-gradient(180deg,#FFFEFB_0%,#FFFDF8_100%)] px-5 pb-7 pt-5 sm:px-7 sm:pb-8 sm:pt-6">
          <div className="grid grid-cols-[1fr_auto] border-b border-[#E7DCCB] pb-2.5 font-mono text-[10px] uppercase tracking-[0.22em] text-[#B6B0A4] sm:text-[11px]">
            <span>{t("checkout.description") || "Description"}</span>
            <span>{t("checkout.subtotal") || "Subtotal"}</span>
          </div>

          <div className="mt-3 space-y-0.5">
            <ReceiptLine
              label={packageLabel(purchase, t)}
              value={purchase.display}
              emphasis
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

          <div className="mt-[22px] flex items-end justify-between gap-5">
            <p className="pb-1.5 font-mono text-[12px] uppercase tracking-[0.22em] text-[#6F6A63] sm:text-[13px]">
              {t("checkout.total") || "Total"}
            </p>
            <p className="min-w-0 max-w-[74%] truncate text-right font-serif text-[42px] leading-none text-[#1A1A1A] tabular-nums sm:text-[50px]">
              {purchase.display}
            </p>
          </div>

          <ReceiptCutEdge position="bottom" />
        </div>
      </motion.div>

      <motion.div
        animate={lowerTicketAnimate}
        transition={{
          duration: reduceMotion ? 0.35 : 0.85,
          ease: [0.22, 1, 0.36, 1],
        }}
        className={`relative z-0 -mt-px overflow-visible rounded-b-[8px] border border-t-0 border-white/80 bg-[linear-gradient(180deg,#FFFDF8_0%,#FFFEFB_100%)] px-5 pb-5 pt-6 sm:px-7 sm:pb-6 ${
          isTorn ? "shadow-[0_24px_60px_rgba(74,55,31,0.16)]" : ""
        }`}
        style={{ transformOrigin: "16% 0%" }}
      >
        {isTorn && <ReceiptCutEdge position="top" />}
        {children}
      </motion.div>
    </motion.article>
  );
}

function ReviewControls({
  acceptedPolicy,
  billingEmail,
  checkoutUrl,
  failureKind,
  failureMessage,
  hasSignedInUser,
  isAuthLoading,
  isBusy,
  payMethod,
  phase,
  routeBlocked,
  t,
  onAcceptPolicy,
  onPrimaryAction,
  onUseCard,
}: {
  acceptedPolicy: boolean;
  billingEmail: string;
  checkoutUrl: string | null;
  failureKind: "sign_in_required" | "generic" | null;
  failureMessage: string | null;
  hasSignedInUser: boolean;
  isAuthLoading: boolean;
  isBusy: boolean;
  payMethod: PayMethod;
  phase: Phase;
  routeBlocked: boolean;
  t: (key: string) => string;
  onAcceptPolicy: (accepted: boolean) => void;
  onPrimaryAction: () => void;
  onUseCard: () => void;
}) {
  const isResultButton =
    routeBlocked ||
    phase === "awaiting_payment" ||
    phase === "succeeded" ||
    phase === "canceled" ||
    phase === "failed";
  const primaryDisabled =
    isBusy ||
    phase === "succeeded" ||
    (!isResultButton &&
      (isAuthLoading ||
        (hasSignedInUser && (!acceptedPolicy || !billingEmail.trim()))));
  const primaryLabel = routeBlocked
    ? t("checkout.use_card") || "Use card instead"
    : phase === "awaiting_payment"
      ? checkoutUrl
        ? t("checkout.open_again") || "Open secure checkout"
        : t("checkout.awaiting_payment") || "Complete payment in the other tab."
      : phase === "succeeded"
        ? t("checkout.ok") || "All set."
        : phase === "canceled"
          ? t("checkout.retry") || "Pick a top up"
          : phase === "failed"
            ? failureKind === "sign_in_required"
              ? t("checkout.sign_in_btn") || "Sign in"
              : t("checkout.try_again") || "Try again"
            : t("checkout.continue") || "Pay securely";
  const buttonTitle =
    phase === "failed"
      ? failureMessage || t("checkout.failed") || "Something tripped on our end."
      : undefined;
  const buttonClick = routeBlocked ? onUseCard : onPrimaryAction;
  const showSpinner = isAuthLoading || isBusy;

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-[22px_minmax(0,1fr)] gap-3 border-b border-[#E7DCCB] py-3 text-left">
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#F1E9DC] text-[#6F6A63]">
          <CreditCard className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="font-mono text-[12px] font-medium leading-none text-[#1A1A1A]">
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
      </div>

      <label className="grid cursor-pointer grid-cols-[22px_minmax(0,1fr)] items-start gap-2.5 text-left">
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
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
        <span className="pt-px text-[11.5px] leading-[1.55] text-[#6F6A63] sm:text-[12px]">
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
        onClick={buttonClick}
        disabled={primaryDisabled}
        aria-busy={showSpinner || undefined}
        title={buttonTitle}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#1A1A1A] px-5 text-[13px] font-medium tracking-[0.01em] text-[#FFFEFB] transition duration-200 hover:-translate-y-0.5 hover:bg-[#2A2A2A] hover:shadow-[0_12px_26px_rgba(26,26,26,0.18)] disabled:pointer-events-none disabled:opacity-45 sm:h-12"
      >
        {showSpinner ? (
          <Spinner size="sm" variant="light" />
        ) : phase === "succeeded" ? (
          <Check className="h-4 w-4" />
        ) : phase === "failed" || routeBlocked ? (
          <AlertCircle className="h-4 w-4" />
        ) : (
          <ShieldCheck className="h-4 w-4" />
        )}
        {primaryLabel}
      </button>
    </div>
  );
}

function ReceiptLine({
  label,
  value,
  emphasis = false,
  valueClassName,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 py-1.5 font-mono text-[12px] leading-[1.4] sm:gap-4 sm:text-[13px]">
      <span className={`min-w-0 truncate ${emphasis ? "text-[#1A1A1A]" : "text-[#6F6A63]"}`}>{label}</span>
      <span className={`max-w-[10rem] truncate text-right ${emphasis ? "font-medium text-[#1A1A1A]" : "text-[#1A1A1A]"} sm:max-w-[13rem] ${valueClassName ?? ""}`}>
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
    <div className="grid grid-cols-1 gap-2 py-2 font-mono text-[12px] leading-[1.4] sm:grid-cols-[minmax(0,1fr)_minmax(9rem,13rem)] sm:items-end sm:gap-4 sm:text-[13px]">
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
        className="min-w-0 rounded-none border-0 border-b border-[#D8CDBB] bg-transparent px-0 pb-1 pt-0 text-left text-[#1A1A1A] outline-none transition-colors placeholder:text-[#B6B0A4] focus:border-[#FF5924] sm:text-right"
      />
    </div>
  );
}

function ReceiptCutEdge({ position }: { position: "top" | "bottom" }) {
  const verticalClass =
    position === "bottom"
      ? "bottom-0 translate-y-1/2"
      : "top-0 -translate-y-1/2";

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-20 h-12 ${verticalClass}`}
      aria-hidden
    >
      <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-[#D8CDBB]" />
      <span className="absolute left-0 top-1/2 h-12 w-6 -translate-y-1/2 overflow-hidden">
        <span className="absolute left-[-24px] top-0 h-12 w-12 rounded-full bg-[#F5F1EB] shadow-[inset_-1px_0_0_rgba(210,201,182,0.65)]" />
      </span>
      <span className="absolute right-0 top-1/2 h-12 w-6 -translate-y-1/2 overflow-hidden">
        <span className="absolute right-[-24px] top-0 h-12 w-12 rounded-full bg-[#F5F1EB] shadow-[inset_1px_0_0_rgba(210,201,182,0.65)]" />
      </span>
    </div>
  );
}

function packageLabel(purchase: CheckoutPurchase, t: (key: string) => string): string {
  if (purchase.kind === "custom") {
    return t("checkout.custom_topup") || "Custom top-up";
  }
  return t("checkout.murmur_notes") || "Murmur Notes";
}

function readCheckoutBaselineNotes(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_BASELINE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { notes?: unknown; createdAt?: unknown };
    if (typeof parsed.createdAt !== "number") return null;
    if (Date.now() - parsed.createdAt > CHECKOUT_BASELINE_MAX_AGE_MS) return null;
    return typeof parsed.notes === "number" && Number.isFinite(parsed.notes)
      ? parsed.notes
      : null;
  } catch {
    return null;
  }
}

function writeCheckoutBaselineNotes(notes: number | undefined): void {
  if (typeof window === "undefined" || typeof notes !== "number" || !Number.isFinite(notes)) {
    return;
  }
  try {
    window.sessionStorage.setItem(
      CHECKOUT_BASELINE_STORAGE_KEY,
      JSON.stringify({ notes, createdAt: Date.now() }),
    );
  } catch {}
}

function clearCheckoutBaselineNotes(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(CHECKOUT_BASELINE_STORAGE_KEY);
  } catch {}
}

function paymentMethodLabel(method: PayMethod, t: (key: string) => string): string {
  return method === "wxpay"
    ? t("topup.payment.wechat") || "WeChat Pay"
    : t("topup.payment.card") || "Card";
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
