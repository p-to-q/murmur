"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/platform/auth-client";
import { Spinner } from "@/components/ui/spinner";
import { useTranslator } from "@/lib/i18n";
import { clearRememberedShareReferrer } from "@/lib/api/share-referral";
import { refreshCurrentAccount } from "@/lib/hooks/use-current-account";
import { fetchUserBalance } from "@/lib/hooks/use-user-balance";
import {
  buildAuthRequestError,
  toAuthRequestError,
  type AuthRequestErrorCode,
} from "@/lib/auth/auth-request-error";
import { formatSupportCode } from "@/lib/observability/support-code";

type Stage = "email" | "code";

// Typed code -> copy maps replace the previous string-matching on `data.error`.
// A code without a dedicated entry falls back to the stage's generic key, which
// preserves the form's prior behavior (send failures -> code_send_failed,
// verify failures -> code_invalid).
const SEND_CODE_COPY: Partial<Record<AuthRequestErrorCode, string>> = {
  rate_limit: "auth.code_rate_limit",
};
const VERIFY_CODE_COPY: Partial<Record<AuthRequestErrorCode, string>> = {
  invalid_code: "auth.code_invalid",
  expired: "auth.code_expired",
  max_attempts: "auth.code_max_attempts",
  rate_limit: "auth.code_rate_limit",
};

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
        throw await buildAuthRequestError(res);
      }
      setStage("code");
      toast.success(t("auth.code_sent").replace("{email}", email.trim()));
      setTimeout(() => codeInputRef.current?.focus(), 100);
    } catch (cause) {
      const err = toAuthRequestError(cause);
      toast.error(t(SEND_CODE_COPY[err.code] ?? "auth.code_send_failed"), {
        description: formatSupportCode({
          area: "AUTH",
          error: err.code,
          requestId: err.requestId,
        }),
      });
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
      if (!res.ok) {
        throw await buildAuthRequestError(res);
      }
      const data = await res.json().catch(() => ({}));
      if (data.user) {
        authClient.setUser({
          id: data.user.id,
          email: data.user.email,
          name: data.user.email?.split("@")[0] || "User",
          accountKind: data.user.accountKind,
        });
      }
      clearRememberedShareReferrer();
      await refreshCurrentAccount();
      await fetchUserBalance({ force: true });
      if (onSuccess) {
        onSuccess();
      }
    } catch (cause) {
      const err = toAuthRequestError(cause);
      toast.error(t(VERIFY_CODE_COPY[err.code] ?? "auth.code_invalid"), {
        description: formatSupportCode({
          area: "AUTH",
          error: err.code,
          requestId: err.requestId,
        }),
      });
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
          {loading ? <Spinner size="sm" variant="light" /> : t("auth.send_code")}
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
        {loading ? <Spinner size="sm" variant="light" /> : t("auth.verify")}
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
