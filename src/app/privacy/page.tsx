import { redirect } from "next/navigation";

export const metadata = {
  title: "Privacy",
};

export default function PrivacyPage() {
  redirect("/me/privacy");
}
