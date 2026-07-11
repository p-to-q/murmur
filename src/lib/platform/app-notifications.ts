import { toast } from "sonner";

export function showInfoNotification(message: string): void {
  toast.info(message);
}
