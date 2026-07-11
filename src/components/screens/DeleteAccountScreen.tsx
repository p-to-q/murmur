"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { formatSupportCode } from "@/lib/observability/support-code";

import { useTranslator } from "@/lib/i18n";
import { request } from "@/lib/api/request";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import {
  clearCurrentAccountCache,
  useCurrentAccount,
} from "@/lib/hooks/use-current-account";
import { authClient } from "@/lib/platform/auth-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function DeleteAccountScreen() {
  const t = useTranslator();
  const router = useRouter();
  const { isRegistered } = useCurrentAccount();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const steps = ["delete.steps.1", "delete.steps.2", "delete.steps.3"] as const;

  async function handleDelete() {
    if (!isRegistered || isSubmitting) return;
    setIsSubmitting(true);

    try {
      const response = await request("/api/account/delete", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(`delete HTTP ${response.status}`);

      clearCurrentAccountCache();
      authClient.setUser({
        id: "guest",
        email: null,
        name: "Local Creator",
        avatarUrl: null,
        accountKind: "local_creator",
      });
      toast.success(t("delete.toast.done"));
      router.push("/");
    } catch {
      toast.error(t("delete.toast.failed"), {
        description: formatSupportCode({ area: "ACCOUNT", error: "delete_failed", requestId: null }),
      });
      setIsSubmitting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div
        className="relative z-10 mx-auto max-w-2xl px-6 pb-28 md:px-12"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 32px)" }}
      >
        <Link
          href="/me"
          className="inline-flex items-center gap-2 text-[13px] text-[#8C8780] transition-colors hover:text-[#1A1A1A]"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("delete.back")}
        </Link>

        <h1 className="hero-serif mt-8 text-[36px] leading-[1.08] text-[#1A1A1A] md:text-[44px]">
          {t("delete.title")}
        </h1>
        <p className="font-serif-italic mt-4 text-[15px] leading-relaxed text-[#6F6A63]">
          {t("delete.intro")}
        </p>

        {!isRegistered && (
          <p className="mt-6 rounded-[16px] border border-[#E5DDD0] bg-white/60 px-4 py-3 text-[14px] text-[#6F6A63]">
            {t("delete.sign_in")}
          </p>
        )}

        <section className="mt-10">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#8C8780]">
            {t("delete.steps.title")}
          </h2>
          <ol className="mt-4 space-y-3">
            {steps.map((key, i) => (
              <li key={key} className="flex gap-3 text-[15px] leading-relaxed text-[#1A1A1A]/85">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1A1A1A] text-[11px] font-semibold text-white">
                  {i + 1}
                </span>
                {t(key)}
              </li>
            ))}
          </ol>
        </section>

        <div className="mt-10">
          <button
            type="button"
            disabled={!isRegistered || isSubmitting}
            onClick={() => setConfirmOpen(true)}
            className="inline-flex items-center gap-2 justify-center w-full max-w-sm rounded-full px-6 py-3.5 text-[14px] font-medium text-white bg-[#C43B3B] transition-all enabled:hover:bg-[#A32D2D] enabled:hover:-translate-y-px enabled:hover:shadow-[0_8px_22px_rgba(196,59,59,0.32)] disabled:cursor-not-allowed disabled:opacity-60"
            aria-disabled={!isRegistered || isSubmitting}
          >
            {isSubmitting ? t("delete.cta.working") : t("delete.cta")}
          </button>
          <p className="mt-4 max-w-sm text-[13px] leading-relaxed text-[#8C8780]">
            {t(isRegistered ? "delete.cta.ready" : "delete.sign_in")}
          </p>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={(open) => setConfirmOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("delete.confirm.title")}</DialogTitle>
            <DialogDescription>{t("delete.confirm.body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              render={<Button variant="outline" disabled={isSubmitting} />}
            >
              {t("common.cancel")}
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isSubmitting}
              className="bg-[#C43B3B] text-white hover:bg-[#A32D2D] focus-visible:ring-[#C43B3B]/30"
            >
              {isSubmitting ? t("delete.cta.working") : t("delete.confirm.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
