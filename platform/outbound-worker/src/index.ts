/**
 * Hardshell Outbound Worker (Egress Firewall)
 *
 * Intercepts all fetch() calls from user workers (non-DO) and enforces
 * a whitelist of allowed external domains.
 *
 * NOTE: Does NOT intercept fetch from Durable Objects (CF limitation).
 * Container egress is controlled via AI Gateway + iptables in Dockerfile.
 */

interface Env {
  // Context passed from dispatch worker via outbound parameters
  client_context: {
    client_name: string;
    source: string;
    bot_token?: string;
    timestamp: string;
  };
}

// Allowed external domains — whitelist-only
const ALLOWED_DOMAINS = new Set([
  // Cloudflare services
  'gateway.ai.cloudflare.com',
  'api.cloudflare.com',

  // Telegram Bot API
  'api.telegram.org',

  // Wave accounting (pending verification)
  'api.waveapps.com',
  'gql.waveapps.com',

  // Google APIs (Calendar, Gmail — future)
  'www.googleapis.com',
  'oauth2.googleapis.com',
  'accounts.google.com',

  // Linear (project management)
  'api.linear.app',
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const hostname = url.hostname;

    // Check whitelist
    if (!ALLOWED_DOMAINS.has(hostname)) {
      console.warn(
        `[Egress] BLOCKED: ${env.client_context?.client_name || 'unknown'} → ${hostname}${url.pathname}`,
      );
      return new Response(
        JSON.stringify({
          error: 'Egress blocked',
          message: `Outbound requests to ${hostname} are not permitted`,
          client: env.client_context?.client_name,
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Log allowed request (non-blocking)
    console.log(
      `[Egress] ALLOWED: ${env.client_context?.client_name || 'unknown'} → ${hostname}${url.pathname}`,
    );

    // Forward the request
    return fetch(request);
  },
};
