/**
 * Hardshell Dynamic Dispatch Worker
 *
 * Routes incoming requests to the correct user worker in the
 * hardshell-prod dispatch namespace via KV-based routing.
 *
 * Routing logic:
 * - Telegram webhooks: /telegram/<bot-token>/... → KV lookup → user worker
 * - Health check: /health → 200 OK
 * - All other routes: 404
 */

interface Env {
  DISPATCHER: DispatchNamespace;
  ROUTING_TABLE: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'hardshell-prod-dispatch',
        timestamp: new Date().toISOString(),
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Platform status — list active clients
    if (path === '/platform/status') {
      // Require platform auth in production
      return new Response(JSON.stringify({
        service: 'hardshell-prod-dispatch',
        namespace: 'hardshell-prod',
        timestamp: new Date().toISOString(),
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Telegram webhook routing: /telegram/<bot-token>
    // Telegram sends: POST /telegram/<bot-token>
    if (path.startsWith('/telegram/')) {
      const botToken = path.split('/telegram/')[1]?.split('/')[0];
      if (!botToken) {
        return new Response('Bad request: missing bot token', { status: 400 });
      }

      // Look up which user worker handles this bot token
      const routingKey = `telegram:${botToken}`;
      const workerName = await env.ROUTING_TABLE.get(routingKey);

      if (!workerName) {
        console.log(`[Dispatch] No route found for telegram token: ${botToken.slice(0, 10)}...`);
        return new Response('Not found', { status: 404 });
      }

      // Check if client is active
      const clientStatus = await env.ROUTING_TABLE.get(`client:${workerName}:status`);
      if (clientStatus === 'suspended') {
        console.log(`[Dispatch] Client ${workerName} is suspended`);
        return new Response('Service unavailable', { status: 503 });
      }

      console.log(`[Dispatch] Routing telegram request to: ${workerName}`);

      try {
        // Get the user worker from the dispatch namespace
        const userWorker = env.DISPATCHER.get(workerName, {}, {
          outbound: {
            client_context: {
              client_name: workerName,
              source: 'telegram',
              bot_token: botToken,
              timestamp: new Date().toISOString(),
            },
          },
        });

        // Forward the request to the user worker
        // Rewrite the URL to match what the user worker expects
        const userWorkerUrl = new URL(request.url);
        userWorkerUrl.pathname = `/telegram/${botToken}`;
        const forwarded = new Request(userWorkerUrl.toString(), request);

        return await userWorker.fetch(forwarded);
      } catch (e: unknown) {
        const error = e as Error;
        if (error.message?.startsWith('Worker not found')) {
          console.error(`[Dispatch] Worker not found: ${workerName}`);
          return new Response('Worker not found', { status: 404 });
        }
        console.error(`[Dispatch] Error dispatching to ${workerName}:`, error.message);
        return new Response('Internal server error', { status: 500 });
      }
    }

    // Direct API routing: /client/<client-name>/...
    // For admin access, health checks, etc. to specific client workers
    if (path.startsWith('/client/')) {
      const parts = path.split('/');
      const clientName = parts[2];
      if (!clientName) {
        return new Response('Bad request: missing client name', { status: 400 });
      }

      const workerName = `client-${clientName}`;

      try {
        const userWorker = env.DISPATCHER.get(workerName, {}, {
          outbound: {
            client_context: {
              client_name: workerName,
              source: 'api',
              timestamp: new Date().toISOString(),
            },
          },
        });

        // Forward with remaining path
        const remainingPath = '/' + parts.slice(3).join('/');
        const userWorkerUrl = new URL(request.url);
        userWorkerUrl.pathname = remainingPath;
        const forwarded = new Request(userWorkerUrl.toString(), request);

        return await userWorker.fetch(forwarded);
      } catch (e: unknown) {
        const error = e as Error;
        if (error.message?.startsWith('Worker not found')) {
          return new Response('Client not found', { status: 404 });
        }
        console.error(`[Dispatch] Error:`, error.message);
        return new Response('Internal server error', { status: 500 });
      }
    }

    return new Response('Not found', { status: 404 });
  },
};
