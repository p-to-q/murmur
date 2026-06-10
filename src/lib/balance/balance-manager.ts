/**
 * Balance management for Local Creator vs Google users
 *
 * Local Creator: 3 notes/day (localStorage)
 * Google User: 10 notes/day (database)
 */

const LOCAL_BALANCE_KEY = "murmur-local-balance";
const LOCAL_BALANCE_DATE_KEY = "murmur-local-balance-date";
const LOCAL_DAILY_LIMIT = 3;

export interface BalanceInfo {
  notes: number;
  dailyLimit: number;
  nextRefillAt: string;
}

/**
 * Get current balance for Local Creator
 * Resets daily at midnight
 */
export function getLocalBalance(): BalanceInfo {
  const today = new Date().toDateString();
  const storedDate = localStorage.getItem(LOCAL_BALANCE_DATE_KEY);

  // Reset if it's a new day
  if (storedDate !== today) {
    localStorage.setItem(LOCAL_BALANCE_KEY, String(LOCAL_DAILY_LIMIT));
    localStorage.setItem(LOCAL_BALANCE_DATE_KEY, today);
  }

  const notes = parseInt(localStorage.getItem(LOCAL_BALANCE_KEY) || String(LOCAL_DAILY_LIMIT), 10);

  // Calculate next refill (tomorrow at midnight)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  return {
    notes,
    dailyLimit: LOCAL_DAILY_LIMIT,
    nextRefillAt: tomorrow.toISOString(),
  };
}

/**
 * Spend notes for Local Creator
 */
export function spendLocalNotes(amount: number): boolean {
  const balance = getLocalBalance();

  if (balance.notes < amount) {
    return false; // Not enough notes
  }

  const newBalance = balance.notes - amount;
  localStorage.setItem(LOCAL_BALANCE_KEY, String(newBalance));
  return true;
}

/**
 * Get balance from cloud (for Google users)
 */
export async function getCloudBalance(): Promise<BalanceInfo> {
  const response = await fetch("/api/user/balance");
  if (!response.ok) {
    throw new Error("Failed to fetch balance");
  }
  return response.json();
}

/**
 * Check if user has enough balance (local or cloud)
 */
export async function hasEnoughBalance(
  amount: number,
  isGoogleUser: boolean
): Promise<boolean> {
  if (isGoogleUser) {
    const balance = await getCloudBalance();
    return balance.notes >= amount;
  } else {
    const balance = getLocalBalance();
    return balance.notes >= amount;
  }
}
