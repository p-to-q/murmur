/**
 * Balance management for guest (pre-login) users.
 *
 * Guests receive one local preview allowance per device via localStorage.
 * Signed-in users use the server ledger and receive a one-time signup bonus.
 */

import { COST, LOCAL_CREATOR_FREE_NOTES } from "@murmur/core";

const LOCAL_BALANCE_KEY = "murmur-local-balance";
const LEGACY_LOCAL_BALANCE_DATE_KEY = "murmur-local-balance-date";
let memoryBalance: number | null = null;

export interface BalanceInfo {
  notes: number;
  freeLimit: number;
  nextRefillAt: string | null;
}

/**
 * Get current balance for a guest on this device.
 * Initializes once to LOCAL_CREATOR_FREE_NOTES and never refills.
 */
export function getLocalBalance(): BalanceInfo {
  const stored = readLocalBalance();
  if (stored === null) {
    writeLocalBalance(LOCAL_CREATOR_FREE_NOTES);
  }

  return {
    notes: stored ?? LOCAL_CREATOR_FREE_NOTES,
    freeLimit: LOCAL_CREATOR_FREE_NOTES,
    nextRefillAt: null,
  };
}

/** Spend notes for a guest action (e.g. one hum = COST.hum). */
export function spendLocalNotes(amount: number = COST.hum): boolean {
  const balance = getLocalBalance();

  if (balance.notes < amount) {
    return false;
  }

  writeLocalBalance(balance.notes - amount);
  return true;
}

export function hasLocalNotes(amount: number = COST.hum): boolean {
  return getLocalBalance().notes >= amount;
}

/**
 * @deprecated Guests use local balance; signed-in users fetch the server ledger.
 */
export async function getCloudBalance(): Promise<BalanceInfo> {
  const response = await fetch("/api/user/balance");
  if (!response.ok) {
    throw new Error("Failed to fetch balance");
  }
  return response.json();
}

/**
 * @deprecated Use hasLocalNotes for guests; signed-in users check server balance.
 */
export async function hasEnoughBalance(
  amount: number,
  isGoogleUser: boolean,
): Promise<boolean> {
  if (isGoogleUser) return (await getCloudBalance()).notes >= amount;
  return getLocalBalance().notes >= amount;
}

function readLocalBalance(): number | null {
  try {
    localStorage.removeItem(LEGACY_LOCAL_BALANCE_DATE_KEY);
    const raw = localStorage.getItem(LOCAL_BALANCE_KEY);
    if (raw === null) return memoryBalance;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return LOCAL_CREATOR_FREE_NOTES;
    return clampLocalBalance(parsed);
  } catch {
    return memoryBalance;
  }
}

function writeLocalBalance(notes: number): void {
  const next = clampLocalBalance(notes);
  memoryBalance = next;
  try {
    localStorage.setItem(LOCAL_BALANCE_KEY, String(next));
  } catch {
    // Private browsing / storage denial: keep the allowance in memory for
    // this tab so the login gate still behaves predictably.
  }
}

function clampLocalBalance(notes: number): number {
  return Math.max(
    0,
    Math.min(LOCAL_CREATOR_FREE_NOTES, Math.floor(notes)),
  );
}
