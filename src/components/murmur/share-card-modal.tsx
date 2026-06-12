"use client";
import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, X } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";

import { useTranslator } from "@/lib/i18n";
import { useGoogleSignIn } from "@/lib/hooks/use-google-sign-in";
import { MurmurMark } from "@/components/murmur/murmur-mark";

interface ShareCardModalProps {
  open: boolean;
  onClose: () => void;
}

export function ShareCardModal({ open, onClose }: ShareCardModalProps) {
  const t = useTranslator();
  const { data: session } = useSession();
  const { signInWithGoogle, googleAuthAvailable } = useGoogleSignIn();

  useEffect(() => {
    if (session?.user) {
      onClose();
    }
  }, [session, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const handleCopyLink = async () => {
    const url = window.location.origin;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "MURMUR",
          text: t("share.tagline"),
          url,
        });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success(t("share.copied"));
    } catch {
      toast.error(t("share.copy_failed"));
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-md"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="relative mx-4 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="relative overflow-hidden rounded-[32px] shadow-2xl"
              style={{
                background:
                  "linear-gradient(148deg, #FF8A5C 0%, #F5C4A8 38%, #E8DCC8 72%, #C8D8E8 100%)",
                minHeight: "420px",
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/12" />

              <div className="absolute left-6 right-6 top-6 flex items-start justify-between">
                <p className="text-[15px] text-white/90 drop-shadow font-serif-italic">
                  MURMUR
                </p>
                <div className="flex items-center gap-3">
                  <MurmurMark size={28} showWord={false} className="drop-shadow" />
                  <button
                    onClick={onClose}
                    aria-label={t("common.cancel")}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-[#1A1A1A] backdrop-blur-sm transition-colors hover:bg-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="absolute bottom-6 left-6 right-6">
                <div className="rounded-[28px] bg-white/95 backdrop-blur-xl p-8 shadow-xl">
                  <h2 className="mb-2 text-center text-[20px] font-medium text-[#1A1A1A] leading-tight">
                    {t("share.tagline")}
                  </h2>
                  <p className="mb-6 text-center text-[13px] text-[#8C8780]">
                    {t("nav.share.reward")}
                  </p>

                  <button
                    type="button"
                    onClick={() => void handleCopyLink()}
                    className="mb-3 flex w-full items-center justify-center gap-2 rounded-full border border-[#E5DDD0] bg-white px-6 py-3.5 text-[15px] font-medium text-[#1A1A1A] transition-colors hover:bg-[#F5F1EB]"
                  >
                    <Copy className="h-4 w-4" />
                    {t("share.copy_link")}
                  </button>

                  <button
                    type="button"
                    onClick={() => signInWithGoogle("/")}
                    disabled={googleAuthAvailable === false}
                    className="flex w-full items-center justify-center gap-3 rounded-full bg-[#EBEBEB] px-6 py-4 text-[16px] font-medium text-[#1A1A1A] transition-colors hover:bg-[#DCDCDC] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    {t("share.google")}
                  </button>

                  {googleAuthAvailable === false && (
                    <p className="mt-3 text-center text-[12px] leading-relaxed text-[#8C8780]">
                      {t("auth.google_unavailable")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
