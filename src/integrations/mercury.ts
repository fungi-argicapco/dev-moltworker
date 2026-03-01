/**
 * Mercury Banking API integration
 *
 * Fetches real account balances from Mercury for the treasury cash brief.
 * Uses Mercury REST API v1: https://docs.mercury.com/reference
 */

const MERCURY_API_BASE = 'https://api.mercury.com/api/v1';

interface MercuryAccount {
  id: string;
  accountNumber: string;
  routingNumber: string;
  name: string;
  nickname?: string;
  kind: 'checking' | 'savings' | 'mercury-treasury';
  status: string;
  currentBalance: number;
  availableBalance: number;
  legalBusinessName: string;
}

interface MercuryAccountsResponse {
  accounts: MercuryAccount[];
  total: number;
}

/**
 * Fetch all Mercury accounts with balances
 */
export async function fetchMercuryAccounts(token: string): Promise<MercuryAccount[]> {
  const response = await fetch(`${MERCURY_API_BASE}/accounts`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Mercury API error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as MercuryAccountsResponse;
  return data.accounts || [];
}

/**
 * Format a dollar amount with commas and 2 decimal places
 */
function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
}

/**
 * Mask account number: show last 4 digits only
 */
function maskAccount(accountNumber: string): string {
  const last4 = accountNumber.slice(-4);
  return `····${last4}`;
}

/**
 * Map Mercury account kind to display label
 */
function accountKindLabel(kind: string): string {
  switch (kind) {
    case 'checking':
      return 'Checking';
    case 'savings':
      return 'Savings';
    case 'mercury-treasury':
      return 'Treasury';
    default:
      return kind;
  }
}

/**
 * Build a formatted cash brief from Mercury account data.
 * Returns a Telegram-ready markdown string.
 */
export function formatCashBrief(accounts: MercuryAccount[]): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  });

  if (accounts.length === 0) {
    return `💰 *Cash Brief* — ${dateStr}\n\n⚠️ No Mercury accounts found.`;
  }

  // Sort: checking first, then savings, then treasury
  const sortOrder: Record<string, number> = {
    checking: 0,
    savings: 1,
    'mercury-treasury': 2,
  };
  const sorted = [...accounts]
    .filter((a) => a.status === 'active')
    .sort((a, b) => (sortOrder[a.kind] ?? 99) - (sortOrder[b.kind] ?? 99));

  // Build account lines
  const lines: string[] = [];
  let totalAvailable = 0;

  for (const acct of sorted) {
    const label = accountKindLabel(acct.kind);
    const masked = maskAccount(acct.accountNumber);
    const name = acct.nickname || acct.name || label;
    const bal = formatUSD(acct.availableBalance);
    totalAvailable += acct.availableBalance;

    lines.push(`${label} ${masked}  *${bal}*`);
    if (name !== label) {
      lines.push(`  _${name}_`);
    }
  }

  const separator = '───────────────────';
  const totalLine = `*Total            ${formatUSD(totalAvailable)}*`;

  return [
    `💰 *Cash Brief* — ${dateStr}`,
    `_As of ${timeStr} PT_`,
    '',
    ...lines,
    separator,
    totalLine,
    '',
    `_${sorted.length} active account${sorted.length !== 1 ? 's' : ''} · ${accounts[0]?.legalBusinessName || 'Mercury'}_`,
  ].join('\n');
}

/**
 * Fetch and format the cash brief in one call.
 * Returns the formatted Telegram message string.
 */
export async function getCashBrief(mercuryToken: string): Promise<string> {
  const accounts = await fetchMercuryAccounts(mercuryToken);
  return formatCashBrief(accounts);
}
