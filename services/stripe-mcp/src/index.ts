/**
 * Stripe MCP Server
 *
 * Private MCP server deployed on Cloudflare Workers using the Agents SDK.
 * Exposes Stripe payment/revenue data as MCP tools for agent consumption.
 *
 * Tools: get_balance, list_charges, get_revenue_summary, list_subscriptions, list_payouts
 */

import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// --------------------------------------------------------------------------
// Stripe REST API helpers
// --------------------------------------------------------------------------

const STRIPE_API = 'https://api.stripe.com/v1';

interface Env {
  STRIPE_API_KEY: string;
  STRIPE_MCP: DurableObjectNamespace;
}

async function stripeFetch(path: string, apiKey: string, params?: Record<string, string>): Promise<unknown> {
  const url = new URL(`${STRIPE_API}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Stripe API ${res.status}: ${body}`);
  }
  return res.json();
}

// --------------------------------------------------------------------------
// Formatting helpers
// --------------------------------------------------------------------------

function formatUSD(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function getQuarterStart(date: Date): Date {
  const quarter = Math.floor(date.getMonth() / 3);
  return new Date(date.getFullYear(), quarter * 3, 1);
}

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getYearStart(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1);
}

// --------------------------------------------------------------------------
// MCP Agent
// --------------------------------------------------------------------------

export class StripeMCP extends McpAgent<Env> {
  server = new McpServer({
    name: 'Stripe Financial',
    version: '1.0.0',
  });

  async init() {
    // ── get_balance ──────────────────────────────────────────────────
    this.server.tool(
      'get_balance',
      'Get current Stripe balance including available, pending, and connect reserved funds',
      {},
      async () => {
        const data = await stripeFetch('/balance', this.env.STRIPE_API_KEY);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        };
      },
    );

    // ── list_charges ─────────────────────────────────────────────────
    this.server.tool(
      'list_charges',
      'List recent charges/payments. Supports filtering by date and limiting results.',
      {
        limit: z.number().optional().default(25).describe('Number of charges to return (max 100)'),
        created_after: z
          .string()
          .optional()
          .describe('Only return charges created after this date (YYYY-MM-DD)'),
      },
      async ({ limit, created_after }) => {
        const params: Record<string, string> = { limit: String(Math.min(limit, 100)) };
        if (created_after) {
          params['created[gte]'] = String(Math.floor(new Date(created_after).getTime() / 1000));
        }
        const data = await stripeFetch('/charges', this.env.STRIPE_API_KEY, params);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        };
      },
    );

    // ── get_revenue_summary ──────────────────────────────────────────
    this.server.tool(
      'get_revenue_summary',
      'Get aggregated revenue for a time period (quarter-to-date, month-to-date, or year-to-date)',
      {
        period: z
          .enum(['qtd', 'mtd', 'ytd'])
          .describe('Time period: qtd (quarter-to-date), mtd (month-to-date), ytd (year-to-date)'),
      },
      async ({ period }) => {
        const now = new Date();
        let startDate: Date;
        let periodLabel: string;

        switch (period) {
          case 'qtd': {
            startDate = getQuarterStart(now);
            const q = Math.ceil((now.getMonth() + 1) / 3);
            periodLabel = `Q${q} ${now.getFullYear()} (Quarter-to-Date)`;
            break;
          }
          case 'mtd':
            startDate = getMonthStart(now);
            periodLabel = `${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} (Month-to-Date)`;
            break;
          case 'ytd':
            startDate = getYearStart(now);
            periodLabel = `${now.getFullYear()} (Year-to-Date)`;
            break;
        }

        const startUnix = String(Math.floor(startDate.getTime() / 1000));

        // Fetch balance transactions of type charge
        let totalRevenue = 0;
        let totalFees = 0;
        let chargeCount = 0;
        let hasMore = true;
        let startingAfter: string | undefined;

        while (hasMore) {
          const params: Record<string, string> = {
            type: 'charge',
            'created[gte]': startUnix,
            limit: '100',
          };
          if (startingAfter) params.starting_after = startingAfter;

          const data = (await stripeFetch('/balance_transactions', this.env.STRIPE_API_KEY, params)) as {
            data: Array<{ id: string; amount: number; fee: number; net: number }>;
            has_more: boolean;
          };

          for (const txn of data.data) {
            totalRevenue += txn.amount;
            totalFees += txn.fee;
            chargeCount++;
            startingAfter = txn.id;
          }
          hasMore = data.has_more;
        }

        const summary = [
          `📊 *Revenue Summary* — ${periodLabel}`,
          '',
          `Gross Revenue:  *${formatUSD(totalRevenue)}*`,
          `Stripe Fees:    _${formatUSD(totalFees)}_`,
          `Net Revenue:    *${formatUSD(totalRevenue - totalFees)}*`,
          '',
          `Transactions:   ${chargeCount}`,
          chargeCount > 0 ? `Avg per txn:    ${formatUSD(Math.round(totalRevenue / chargeCount))}` : '',
        ]
          .filter(Boolean)
          .join('\n');

        return { content: [{ type: 'text' as const, text: summary }] };
      },
    );

    // ── list_subscriptions ───────────────────────────────────────────
    this.server.tool(
      'list_subscriptions',
      'List active subscriptions with MRR calculation',
      {
        status: z
          .enum(['active', 'past_due', 'canceled', 'all'])
          .optional()
          .default('active')
          .describe('Filter by subscription status'),
        limit: z.number().optional().default(25).describe('Number of subscriptions to return'),
      },
      async ({ status, limit }) => {
        const params: Record<string, string> = { limit: String(limit) };
        if (status !== 'all') params.status = status;

        const data = (await stripeFetch('/subscriptions', this.env.STRIPE_API_KEY, params)) as {
          data: Array<{
            id: string;
            status: string;
            items: {
              data: Array<{
                price: { unit_amount: number; recurring: { interval: string; interval_count: number } };
                quantity: number;
              }>;
            };
            customer: string;
            current_period_end: number;
          }>;
        };

        // Calculate MRR
        let mrr = 0;
        for (const sub of data.data) {
          if (sub.status === 'active') {
            for (const item of sub.items.data) {
              const amount = item.price.unit_amount * item.quantity;
              const interval = item.price.recurring?.interval;
              const intervalCount = item.price.recurring?.interval_count || 1;
              switch (interval) {
                case 'month':
                  mrr += amount / intervalCount;
                  break;
                case 'year':
                  mrr += amount / (12 * intervalCount);
                  break;
                case 'week':
                  mrr += (amount * 52) / (12 * intervalCount);
                  break;
                case 'day':
                  mrr += (amount * 365) / (12 * intervalCount);
                  break;
              }
            }
          }
        }

        const summary = {
          subscriptions: data.data.length,
          mrr: formatUSD(Math.round(mrr)),
          arr: formatUSD(Math.round(mrr * 12)),
          details: data.data,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
        };
      },
    );

    // ── list_payouts ─────────────────────────────────────────────────
    this.server.tool(
      'list_payouts',
      'List recent payouts from Stripe to your bank account',
      {
        limit: z.number().optional().default(10).describe('Number of payouts to return'),
      },
      async ({ limit }) => {
        const data = await stripeFetch('/payouts', this.env.STRIPE_API_KEY, {
          limit: String(limit),
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        };
      },
    );
  }
}

// --------------------------------------------------------------------------
// Export Worker handler
// --------------------------------------------------------------------------

export default StripeMCP.serve('/mcp');
