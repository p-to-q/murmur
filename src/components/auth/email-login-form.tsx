"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/platform/auth-client";
import { MurmurLoadingNote } from "@/components/murmur/murmur-loading-note";
import { useTranslator } from "@/lib/i18n";
import { clearRememberedShareReferrer } from "@/lib/api/share-referral";

type Stage = "email" | "code";

interface EmailLoginFormProps {
  onSuccess?: () => void;
  className?: string;
}

export function EmailLoginForm({ onSuccess, className = "" }: EmailLoginFormProps) {
  const t = useTranslator();
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const sendCode = useCallback(async () => {
    if (!email.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/email/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === "rate_limit") {
          toast.error(t("auth.code_rate_limit"));
        } else {
          toast.error(t("auth.code_send_failed"));
        }
        return;
      }
      setStage("code");
      toast.success(t("auth.code_sent").replace("{email}", email.trim()));
      setTimeout(() => codeInputRef.current?.focus(), 100);
    } catch {
      toast.error(t("auth.code_send_failed"));
    } finally {
      setLoading(false);
    }
  }, [email, t]);

  const verify = useCallback(async () => {
    if (!code.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/email/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "invalid_code") toast.error(t("auth.code_invalid"));
        else if (data.error === "expired") toast.error(t("auth.code_expired"));
        else if (data.error === "max_attempts") toast.error(t("auth.code_max_attempts"));
        else toast.error(t("auth.code_invalid"));
        return;
      }
      if (data.user) {
        authClient.setUser({
          id: data.user.id,
          email: data.user.email,
          name: data.user.email?.split("@")[0] || "User",
          accountKind: data.user.accountKind,
        });
      }
      clearRememberedShareReferrer();
      if (onSuccess) {
        onSuccess();
      } else {
        window.location.reload();
      }
    } catch {
      toast.error(t("auth.code_invalid"));
    } finally {
      setLoading(false);
    }
  }, [email, code, onSuccess, t]);

  if (stage === "email") {
    return (
      <div className={`flex flex-col gap-2.5 ${className}`}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendCode()}
          placeholder={t("auth.email_placeholder")}
          autoComplete="email"
          className="w-full rounded-full border border-[#E0DDD5] bg-white px-5 py-2.5 text-[14px] text-[#1A1A1A] placeholder-[#B8B3AC] outline-none transition-all focus:border-[#8C8780] focus:ring-1 focus:ring-[#8C8780]"
        />
        <button
          onClick={sendCode}
          disabled={loading || !email.trim()}
          className="flex w-full items-center justify-center rounded-full bg-[#1A1A1A] px-5 py-2.5 text-[14px] font-medium text-white transition-all hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <MurmurLoadingNote size="sm" tone="light" /> : t("auth.send_code")}
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2.5 ${className}`}>
      <p className="text-center text-[13px] text-[#8C8780]">
        {t("auth.code_sent").replace("{email}", email.trim())}
      </p>
      <input
        ref={codeInputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => e.key === "Enter" && verify()}
        placeholder={t("auth.enter_code")}
        autoComplete="one-time-code"
        className="w-full rounded-full border border-[#E0DDD5] bg-white px-5 py-2.5 text-center text-[18px] font-medium tracking-[6px] text-[#1A1A1A] placeholder-[#B8B3AC] placeholder:text-[14px] placeholder:tracking-normal outline-none transition-all focus:border-[#8C8780] focus:ring-1 focus:ring-[#8C8780]"
      />
      <button
        onClick={verify}
        disabled={loading || code.length < 6}
        className="flex w-full items-center justify-center rounded-full bg-[#1A1A1A] px-5 py-2.5 text-[14px] font-medium text-white transition-all hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? <MurmurLoadingNote size="sm" tone="light" /> : t("auth.verify")}
      </button>
      <button
        onClick={() => {
          setStage("email");
          setCode("");
        }}
        className="text-[13px] text-[#8C8780] underline-offset-2 hover:underline"
      >
        {t("auth.change_email")}
      </button>
    </div>
  );
}
