"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ReceiptText, RefreshCw } from "lucide-react";

import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { MurmurLoadingNote } from "@/components/murmur/murmur-loading-note";
import { request } from "@/lib/api/request";
import { useTranslator } from "@/lib/i18n";

type PaymentRecord = {
  id: string;
  provider: string;
  productId: string;
  providerRef: string;
  amountCents: number;
  currency: string;
  notesGranted: number;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type PaymentsResponse = {
  payments?: PaymentRecord[];
  error?: string;
};

export function PaymentsScreen() {
  const t = useTranslator();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error" | "signed_out">("loading");

  async function loadPayments(options: { showLoading?: boolean } = {}) {
    if (options.showLoading ?? true) {
      setState("loading");
    }
    try {
      const response = await request("/api/user/payments", { method: "GET" });
      const payload = (await response.json().catch(() => ({}))) as PaymentsResponse;
      if (response.status === 403 || payload.error === "sign_in_required") {
        setPayments([]);
        setState("signed_out");
        return;
      }
      if (!response.ok) {
        setPayments([]);
        setState("error");
        return;
      }
      const nextPayments = Array.isArray(payload.payments) ? payload.payments : [];
      setPayments(nextPayments);
      setState(nextPayments.length ? "ready" : "empty");
    } catch {
      setPayments([]);
      setState("error");
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      void loadPayments({ showLoading: false });
    });
  }, []);

  const totalNotes = useMemo(
    () =>
      payments
        .filter((payment) => payment.status === "succeeded")
        .reduce((sum, payment) => sum + payment.notesGranted, 0),
    [payments],
  );

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB] text-[#1A1A1A]">
      <PageBackdrop variant="soft" />

      <div
        className="relative z-10 mx-auto max-w-3xl px-6 pb-28 md:px-12"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 48px)" }}
      >
        <Link
          href="/me"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/55 bg-white/70 transition-colors hover:bg-white"
          aria-label={t("common.back") || "Back"}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <header className="mt-7">
          <p className="eyebrow mb-3 text-[#8C8780]">
            {t("payments.eyebrow") || "PAYMENTS"}
          </p>
          <h1 className="hero-serif-italic text-[44px] leading-[1.02] md:text-[72px]">
            {t("payments.title") || "Payment records"}
          </h1>
          <p className="mt-3 max-w-[32rem] font-serif-italic text-[15px] leading-[1.55] text-[#6F6A63] md:text-[16px]">
            {t("payments.sub") ||
              "A quiet receipt shelf for note top-ups on this account."}
          </p>
        </header>

        <section className="mt-7 grid gap-3 sm:grid-cols-3">
          <SummaryTile label={t("payments.summary.count") || "Records"} value={String(payments.length)} />
          <SummaryTile label={t("payments.summary.notes") || "Notes added"} value={state === "loading" ? "—" : String(totalNotes)} />
          <SummaryTile label={t("payments.summary.provider") || "Provider"} value="Waffo" />
        </section>

        <main className="mt-5">
          {state === "loading" ? (
            <div
              className="flex min-h-[220px] items-center justify-center"
              role="status"
              aria-label={t("loading.aria")}
            >
              <MurmurLoadingNote size="page" decorative={false} />
            </div>
          ) : state === "signed_out" ? (
            <EmptyState
              title={t("payments.signed_out.title") || "Sign in to see receipts."}
              body={t("payments.signed_out.body") || "Payment records are attached to your signed-in account."}
              action={<Link href="/me" className="mm-btn-primary inline-flex">{t("common.back") || "Back"}</Link>}
            />
          ) : state === "error" ? (
            <EmptyState
              title={t("payments.error.title") || "Couldn't load payment records."}
              body={t("payments.error.body") || "Try refreshing this page in a moment."}
              action={
                <button onClick={() => void loadPayments()} className="mm-btn-primary inline-flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  {t("payments.retry") || "Refresh"}
                </button>
              }
            />
          ) : state === "empty" ? (
            <EmptyState
              title={t("payments.empty.title") || "No payment records yet."}
              body={t("payments.empty.body") || "Top-ups will appear here after checkout is confirmed."}
              action={<Link href="/topup" className="mm-btn-primary inline-flex">{t("payments.empty.cta") || "Top up"}</Link>}
            />
          ) : (
            <div className="space-y-3">
              {payments.map((payment) => (
                <PaymentRow key={payment.id} payment={payment} />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-white/65 bg-white/55 px-4 py-3 shadow-[0_14px_35px_rgba(92,72,45,0.06)]">
      <p className="text-[11px] uppercase tracking-[0.14em] text-[#B7AEA1]">{label}</p>
      <p className="mt-1 font-serif text-[24px] leading-none text-[#1A1A1A] tabular-nums">{value}</p>
    </div>
  );
}

function PaymentRow({ payment }: { payment: PaymentRecord }) {
  const statusTone =
    payment.status === "succeeded"
      ? "border-[#C9D8B8] bg-[#F7FAF1] text-[#5D7245]"
      : payment.status === "refunded"
        ? "border-[#E5C7BB] bg-[#FFF4EF] text-[#A65435]"
        : "border-[#E7DCCB] bg-[#FFFCF7] text-[#8C8780]";

  return (
    <article className="rounded-[8px] border border-white/70 bg-white/65 p-4 shadow-[0_18px_45px_rgba(92,72,45,0.07)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ReceiptText className="h-4 w-4 shrink-0 text-[#B7AEA1]" />
            <p className="truncate text-[14px] font-medium text-[#1A1A1A]">
              {formatProduct(payment.productId)}
            </p>
          </div>
          <p className="mt-2 text-[12px] leading-[1.55] text-[#8C8780]">
            {formatDate(payment.createdAt)} · {payment.providerRef}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-serif text-[24px] leading-none tabular-nums">
            {formatMoney(payment.amountCents, payment.currency)}
          </p>
          <p className="mt-1 text-[12px] text-[#8C8780]">
            +{payment.notesGranted} notes
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.08em] ${statusTone}`}>
          {payment.status}
        </span>
        <span className="text-[11px] text-[#B7AEA1]">
          {payment.provider.toUpperCase()}
        </span>
      </div>
    </article>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div className="rounded-[8px] border border-white/70 bg-white/60 px-5 py-8 text-center shadow-[0_18px_45px_rgba(92,72,45,0.07)]">
      <p className="font-serif text-[24px] leading-tight text-[#1A1A1A]">{title}</p>
      <p className="mx-auto mt-3 max-w-sm text-[13px] leading-[1.6] text-[#6F6A63]">{body}</p>
      <div className="mt-5 flex justify-center">{action}</div>
    </div>
  );
}

function formatProduct(productId: string): string {
  if (productId === "topup_custom") return "Custom note top-up";
  const match = productId.match(/topup_(\d+)_notes/);
  if (match?.[1]) return `${match[1]} note top-up`;
  return productId.replaceAll("_", " ");
}

function formatMoney(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amountCents / 100);
  } catch {
    return `${currency} ${(amountCents / 100).toFixed(2)}`;
  }
}

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
