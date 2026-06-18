import { NextResponse } from "next/server";
import { isGoogleOAuthConfigured } from "@/lib/auth/google-config";
import { isGitHubOAuthConfigured } from "@/lib/auth/github-config";
import { isEmailAuthConfigured } from "@/lib/auth/email/send-verification";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    google: isGoogleOAuthConfigured(),
    github: isGitHubOAuthConfigured(),
    email: isEmailAuthConfigured(),
  });
}
