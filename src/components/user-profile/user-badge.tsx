"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import Image from "next/image";
import { LogOut, UserRound, X } from "lucide-react";
import { authClient, usePlatformState } from "@/lib/platform/auth-client";
import type { AppUser } from "@/lib/platform/types";
import { useSession, signOut } from "next-auth/react";
import { GoogleSignInButton } from "@/components/auth/google-auth-buttons";
import { useGoogleSignIn } from "@/lib/hooks/use-google-sign-in";
import { useI18nStore, useTranslator } from "@/lib/i18n";
import { formatMemberSince } from "@/lib/user/member-since";

export function UserBadge() {
  const t = useTranslator();
  const platformUser = usePlatformState((s) => s.auth.user);
  const loading = usePlatformState((s) => s.auth.loading);
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const user = session?.user
    ? ({
        id: (session.user as { id?: string }).id || "google-user",
        email: session.user.email || null,
        name: session.user.name || null,
        avatarUrl: session.user.image || null,
      } as AppUser)
    : platformUser;

  const isGoogleUser = !!session?.user;
  const { signInWithGoogle, googleAuthAvailable } = useGoogleSignIn();

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  if (loading) {
    return (
      <div className="flex h-9 items-center rounded-full border border-border bg-background px-3 shadow-sm">
        <div className="size-4 animate-spin rounded-full border-2 border-muted border-t-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        {googleAuthAvailable !== false && (
          <GoogleSignInButton className="flex items-center gap-2 rounded-full border border-[#E0DDD5] bg-white px-4 py-2 text-sm font-medium text-[#1A1A1A] shadow-sm transition-all hover:shadow-md" />
        )}
        <button
          onClick={() => {
            authClient.login().catch(() => undefined);
          }}
          className="flex items-center gap-2 rounded-full border border-[#E0DDD5] bg-[#F5F1EB] px-3 py-1.5 text-sm font-medium text-[#8C8780] shadow-sm transition-shadow hover:shadow-md"
        >
          <UserRound className="h-4 w-4" />
          {t("auth.local_creator")}
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative z-50">
      <BadgeTrigger user={user} onClick={() => setOpen((v) => !v)} />
      {open && (
        <DropdownPanel user={user} isGoogleUser={isGoogleUser} onClose={() => setOpen(false)}>
          {!isGoogleUser && googleAuthAvailable !== false && (
            <button
              onClick={() => {
                signInWithGoogle("/");
                setOpen(false);
              }}
              className="mb-1 flex w-full items-center gap-2 rounded-lg bg-[#F5F1EB] px-2 py-1.5 text-sm font-medium text-[#1A1A1A] hover:bg-[#E0DDD5]"
            >
              <GoogleIcon className="h-3.5 w-3.5" />
              {t("auth.continue_google")}
            </button>
          )}
          <button
            onClick={() => {
              if (isGoogleUser) {
                signOut({ callbackUrl: "/" });
              } else {
                authClient.logout();
              }
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-[#8C8780] hover:bg-[#F5F1EB] hover:text-[#1A1A1A]"
          >
            <LogOut className="h-3.5 w-3.5" />
            {t("auth.sign_out")}
          </button>
        </DropdownPanel>
      )}
    </div>
  );
}

function BadgeTrigger({ user, onClick }: { user: AppUser; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-full border border-border bg-background px-2.5 py-1.5 text-sm shadow-sm transition-shadow hover:shadow-md"
    >
      <Avatar user={user} size={24} />
      <span className="max-w-[120px] truncate font-medium text-foreground">
        {user.name ?? user.email ?? user.id}
      </span>
    </button>
  );
}

function DropdownPanel({
  user,
  isGoogleUser,
  onClose,
  children,
}: {
  user: AppUser;
  isGoogleUser?: boolean;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const t = useTranslator();
  const lang = useI18nStore((s) => s.lang);
  const [songCount, setSongCount] = useState<number | null>(null);
  const joinedDate = useMemo(
    () => formatMemberSince(user.id, lang),
    [user.id, lang],
  );

  useEffect(() => {
    fetch("/api/songs")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setSongCount(data.length);
        }
      })
      .catch(() => {
        // Ignore errors
      });
  }, [user.id]);

  return (
    <div className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-border bg-background shadow-lg">
      <div className="flex items-start justify-between gap-3 px-4 py-4">
        <div className="flex items-center gap-3">
          <Avatar user={user} size={40} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{user.name ?? "—"}</p>
            {user.email && (
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="mt-0.5 shrink-0 rounded-md p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        {songCount !== null && <Row label={t("auth.songs")} value={String(songCount)} />}
        {joinedDate && <Row label={t("auth.joined")} value={joinedDate} />}
        <Row
          label={t("auth.account")}
          value={isGoogleUser ? t("auth.account_google") : t("auth.account_local")}
        />
        <Row label={t("auth.user_id")} value={user.id} mono />
      </div>

      {children && <div className="border-t border-border px-4 py-2">{children}</div>}
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="currentColor"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function avatarGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const hue1 = (h >>> 0) % 360;
  const hue2 = (hue1 + 40 + ((h >>> 8) % 60)) % 360;
  const sat = 35 + ((h >>> 16) % 25);
  return `linear-gradient(135deg, hsl(${hue1},${sat}%,72%) 0%, hsl(${hue2},${sat + 10}%,78%) 100%)`;
}

function userInitial(name: string | null | undefined, email: string | null | undefined): string {
  const source = name?.trim() || email?.trim() || "?";
  return source[0]?.toUpperCase() ?? "?";
}

function InitialsAvatar({
  seed,
  initial,
  size,
}: {
  seed: string;
  initial: string;
  size: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full ring-2 ring-border"
      style={{
        width: size,
        height: size,
        background: avatarGradient(seed),
      }}
    >
      <span
        className="font-serif-italic text-white/90 select-none"
        style={{ fontSize: size * 0.42, lineHeight: 1, textShadow: "0 1px 3px rgba(0,0,0,0.15)" }}
      >
        {initial}
      </span>
    </div>
  );
}

function Avatar({ user, size }: { user: AppUser; size: number }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const seed = user.id ?? user.email ?? user.name ?? "murmur";
  const initial = userInitial(user.name, user.email);
  const avatarSrc = user.avatarUrl
    ? user.avatarUrl.startsWith("//")
      ? `https:${user.avatarUrl}`
      : user.avatarUrl
    : null;
  const showImage = avatarSrc && failedUrl !== avatarSrc;

  if (showImage) {
    return (
      <Image
        src={avatarSrc}
        alt={user.name ?? "avatar"}
        width={size}
        height={size}
        className="rounded-full object-cover ring-2 ring-border"
        style={{ width: size, height: size }}
        onError={() => setFailedUrl(avatarSrc)}
      />
    );
  }

  return <InitialsAvatar seed={seed} initial={initial} size={size} />;
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-muted-foreground/70">{label}</span>
      <span className={`truncate text-right text-foreground ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}
