"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/**
 * Editorial toast treatment.
 *
 * Sonner ships a neutral, system-font default. Murmur's language is cream
 * paper + ink serif + a single coral accent, so we override the toast surface
 * to match: warm #FFFEFB card, hairline cream border, 16px radius, a soft
 * shadow, serif titles, and per-type accent icons (coral for success). The
 * rules are scoped under `[data-sonner-toaster]` so they out-specify Sonner's
 * own defaults without needing `!important`, and live here (not globals.css)
 * to keep the toast styling self-contained with its component.
 */
const EDITORIAL_TOAST_CSS = `
[data-sonner-toaster] [data-sonner-toast] {
  border-radius: 16px;
  background: #FFFEFB;
  border: 1px solid #E5DDD0;
  box-shadow: 0 12px 36px rgba(26, 26, 26, 0.10);
  padding: 15px 16px;
  gap: 12px;
  color: #1A1A1A;
}
[data-sonner-toaster] [data-sonner-toast] [data-title] {
  font-family: var(--murmur-font-serif);
  font-weight: 400;
  font-size: 15px;
  line-height: 1.35;
  letter-spacing: 0.005em;
  color: #1A1A1A;
}
[data-sonner-toaster] [data-sonner-toast] [data-description] {
  font-family: var(--murmur-font-sans);
  font-size: 13px;
  line-height: 1.5;
  color: #6F6A63;
}
[data-sonner-toaster] [data-sonner-toast] [data-icon] {
  margin-top: 1px;
  color: #8C8780;
}
[data-sonner-toaster] [data-sonner-toast][data-type="success"] [data-icon] { color: #FF5924; }
[data-sonner-toaster] [data-sonner-toast][data-type="error"] [data-icon] { color: #D9421A; }
[data-sonner-toaster] [data-sonner-toast][data-type="warning"] [data-icon] { color: #B0872F; }
[data-sonner-toaster] [data-sonner-toast][data-type="info"] [data-icon] { color: #8C8780; }
[data-sonner-toaster] [data-sonner-toast] [data-button] {
  border-radius: 10px;
  font-family: var(--murmur-font-sans);
  font-size: 12px;
}
[data-sonner-toaster] [data-sonner-toast] [data-action] {
  background: #1A1A1A;
  color: #FFFEFB;
}
[data-sonner-toaster] [data-sonner-toast] [data-cancel] {
  background: #EFE8DA;
  color: #1A1A1A;
}
[data-sonner-toaster] [data-sonner-toast] [data-close-button] {
  border-radius: 999px;
  border-color: #E5DDD0;
  background: #FFFEFB;
  color: #8C8780;
}
`

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <>
      <style>{EDITORIAL_TOAST_CSS}</style>
      <Sonner
        theme={theme as ToasterProps["theme"]}
        className="toaster group"
        position="bottom-right"
        offset="32px"
        gap={4}
        icons={{
          success: (
            <CircleCheckIcon className="size-4" />
          ),
          info: (
            <InfoIcon className="size-4" />
          ),
          warning: (
            <TriangleAlertIcon className="size-4" />
          ),
          error: (
            <OctagonXIcon className="size-4" />
          ),
          loading: (
            <Loader2Icon className="size-4 animate-spin" />
          ),
        }}
        style={
          {
            "--normal-bg": "#FFFEFB",
            "--normal-text": "#1A1A1A",
            "--normal-border": "#E5DDD0",
            "--border-radius": "16px",
          } as React.CSSProperties
        }
        {...props}
      />
    </>
  )
}

export { Toaster }
