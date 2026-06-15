/**
 * Balance management for guest (pre-login) users.
 *
 * Guests receive DAILY_REFILL notes per device per day via localStorage.
 * Signed-in users are temporarily unlimited for the preview; this is not the
 * launch billing model and must be removed or entitlement-gated before paid
 * release.
 */

import { COST, DAILY_REFILL } from "@murmur/core";

const LOCAL_BALANCE_KEY = "murmur-local-balance";
const LOCAL_BALANCE_DATE_KEY = "murmur-local-balance-date";

export interface BalanceInfo {
  notes: number;
  dailyLimit: number;
  nextRefillAt: string;
}

/**
 * Get current balance for a guest on this device.
 * Resets to DAILY_REFILL at local midnight.
 */
export function getLocalBalance(): BalanceInfo {
  const today = new Date().toDateString();
  const storedDate = localStorage.getItem(LOCAL_BALANCE_DATE_KEY);

  if (storedDate !== today) {
    localStorage.setItem(LOCAL_BALANCE_KEY, String(DAILY_REFILL));
    localStorage.setItem(LOCAL_BALANCE_DATE_KEY, today);
  }

  const notes = parseInt(
    localStorage.getItem(LOCAL_BALANCE_KEY) || String(DAILY_REFILL),
    10,
  );

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  return {
    notes: Number.isFinite(notes) ? notes : DAILY_REFILL,
    dailyLimit: DAILY_REFILL,
    nextRefillAt: tomorrow.toISOString(),
  };
}

/** Spend notes for a guest action (e.g. one hum = COST.hum). */
export function spendLocalNotes(amount: number = COST.hum): boolean {
  const balance = getLocalBalance();

  if (balance.notes < amount) {
    return false;
  }

  localStorage.setItem(LOCAL_BALANCE_KEY, String(balance.notes - amount));
  return true;
}

export function hasLocalNotes(amount: number = COST.hum): boolean {
  return getLocalBalance().notes >= amount;
}

/**
 * @deprecated Guests use local balance; signed-in users are unlimited.
 */
export async function getCloudBalance(): Promise<BalanceInfo> {
  const response = await fetch("/api/user/balance");
  if (!response.ok) {
    throw new Error("Failed to fetch balance");
  }
  return response.json();
}

/**
 * @deprecated Use hasLocalNotes for guests; signed-in users are unlimited.
 */
export async function hasEnoughBalance(
  amount: number,
  isGoogleUser: boolean,
): Promise<boolean> {
  if (isGoogleUser) return true;
  return getLocalBalance().notes >= amount;
}
