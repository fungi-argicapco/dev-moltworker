/**
 * Mercury MCP Server
 *
 * Private MCP server deployed on Cloudflare Workers using the Agents SDK.
 * Exposes Mercury banking data as MCP tools for agent consumption.
 *
 * Tools: get_accounts, get_account, list_transactions, get_treasury, get_cash_brief
 */

import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// --------------------------------------------------------------------------
// Mercury REST API helpers
// --------------------------------------------------------------------------

const MERCURY_API = 'https://api.mercury.com/api/v1';

interface Env {
  MERCURY_API_TOKEN: string;
  MERCURY_MCP: DurableObjectNamespace;
}

async function mercuryFetch(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${MERCURY_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Mercury API ${res.status}: ${body}`);
  }
  return res.json();
}

// --------------------------------------------------------------------------
// Formatting helpers
// --------------------------------------------------------------------------

function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
}

function maskAccount(accountNumber: string): string {
  return `····${accountNumber.slice(-4)}`;
}

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

// --------------------------------------------------------------------------
// MCP Agent
// --------------------------------------------------------------------------

export class MercuryMCP extends McpAgent<Env> {
  server = new McpServer({
    name: 'Mercury Banking',
    version: '1.0.0',
  });

  async init() {
    // ── get_accounts ─────────────────────────────────────────────────
    this.server.tool(
      'get_accounts',
      'List all Mercury bank accounts with current and available balances',
      {},
      async () => {
        const data = (await mercuryFetch('/accounts', this.env.MERCURY_API_TOKEN)) as {
          accounts: Array<{
            id: string;
            accountNumber: string;
            name: string;
            nickname?: string;
            kind: string;
            status: string;
            currentBalance: number;
            availableBalance: number;
            legalBusinessName: string;
          }>;
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data.accounts, null, 2) }],
        };
      },
    );

    // ── get_account ──────────────────────────────────────────────────
    this.server.tool(
      'get_account',
      'Get details for a specific Mercury account by ID',
      { accountId: z.string().describe('Mercury account UUID') },
      async ({ accountId }) => {
        const data = await mercuryFetch(`/account/${accountId}`, this.env.MERCURY_API_TOKEN);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        };
      },
    );

    // ── list_transactions ────────────────────────────────────────────
    this.server.tool(
      'list_transactions',
      'List transactions for a Mercury account. Supports filtering by date range.',
      {
        accountId: z.string().describe('Mercury account UUID'),
        limit: z.number().optional().default(25).describe('Number of transactions to return'),
        offset: z.number().optional().default(0).describe('Pagination offset'),
        start: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        end: z.string().optional().describe('End date (YYYY-MM-DD)'),
      },
      async ({ accountId, limit, offset, start, end }) => {
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        params.set('offset', String(offset));
        if (start) params.set('start', start);
        if (end) params.set('end', end);

        const data = await mercuryFetch(
          `/account/${accountId}/transactions?${params.toString()}`,
          this.env.MERCURY_API_TOKEN,
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        };
      },
    );

    // ── get_treasury ─────────────────────────────────────────────────
    this.server.tool(
      'get_treasury',
      'Get Mercury Treasury account details including yield information',
      {},
      async () => {
        // Treasury info is on the account with kind 'mercury-treasury'
        const data = (await mercuryFetch('/accounts', this.env.MERCURY_API_TOKEN)) as {
          accounts: Array<{
            id: string;
            kind: string;
            currentBalance: number;
            availableBalance: number;
            [key: string]: unknown;
          }>;
        };
        const treasury = data.accounts.filter((a) => a.kind === 'mercury-treasury');
        return {
          content: [
            {
              type: 'text' as const,
              text: treasury.length > 0 ? JSON.stringify(treasury, null, 2) : 'No treasury accounts found',
            },
          ],
        };
      },
    );

    // ── get_cash_brief ───────────────────────────────────────────────
    this.server.tool(
      'get_cash_brief',
      'Get a formatted cash position brief showing all account balances and total liquid cash',
      {},
      async () => {
        const data = (await mercuryFetch('/accounts', this.env.MERCURY_API_TOKEN)) as {
          accounts: Array<{
            accountNumber: string;
            name: string;
            nickname?: string;
            kind: string;
            status: string;
            currentBalance: number;
            availableBalance: number;
            legalBusinessName: string;
          }>;
        };

        const accounts = data.accounts || [];
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
          return {
            content: [{ type: 'text' as const, text: `💰 Cash Brief — ${dateStr}\n\n⚠️ No accounts found.` }],
          };
        }

        const sortOrder: Record<string, number> = { checking: 0, savings: 1, 'mercury-treasury': 2 };
        const sorted = [...accounts]
          .filter((a) => a.status === 'active')
          .sort((a, b) => (sortOrder[a.kind] ?? 99) - (sortOrder[b.kind] ?? 99));

        const lines: string[] = [];
        let totalAvailable = 0;

        for (const acct of sorted) {
          const label = accountKindLabel(acct.kind);
          const masked = maskAccount(acct.accountNumber);
          const name = acct.nickname || acct.name || label;
          const bal = formatUSD(acct.availableBalance);
          totalAvailable += acct.availableBalance;
          lines.push(`${label} ${masked}  *${bal}*`);
          if (name !== label) lines.push(`  _${name}_`);
        }

        const brief = [
          `💰 *Cash Brief* — ${dateStr}`,
          `_As of ${timeStr} PT_`,
          '',
          ...lines,
          '───────────────────',
          `*Total            ${formatUSD(totalAvailable)}*`,
          '',
          `_${sorted.length} active account${sorted.length !== 1 ? 's' : ''} · ${accounts[0]?.legalBusinessName || 'Mercury'}_`,
        ].join('\n');

        return { content: [{ type: 'text' as const, text: brief }] };
      },
    );
  }
}

// --------------------------------------------------------------------------
// Export Worker handler
// --------------------------------------------------------------------------

export default MercuryMCP.serve('/mcp');
