/**
 * MCP Client — Lightweight Streamable HTTP client for calling MCP server tools
 *
 * Used by Hardshell agents to fetch real data from our private MCP servers
 * (Mercury, Stripe) deployed on Cloudflare Workers.
 *
 * Features:
 *   - Structured console.log for every call (visible in wrangler tail)
 *   - Latency tracking
 *   - Error detail logging
 */

interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: McpToolResult;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Structured log entry for MCP calls
 */
export interface McpCallLog {
  timestamp: string;
  server: string;
  tool: string;
  status: 'ok' | 'error';
  latencyMs: number;
  error?: string;
  resultPreview?: string;
}

/**
 * Resolve server name from URL for logging
 */
function serverName(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    // mercury-mcp-server.jfischburg-us.workers.dev → mercury
    const match = hostname.match(/^([^-]+)/);
    return match?.[1] || hostname;
  } catch {
    return url;
  }
}

/**
 * Call a tool on a remote MCP server via Streamable HTTP transport.
 *
 * Flow:
 *   1. POST initialize → get session ID
 *   2. POST notifications/initialized
 *   3. POST tools/call with session → get result
 *
 * Every call is logged with structured data for wrangler tail visibility.
 */
export async function callMcpTool(
  serverUrl: string,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  const server = serverName(serverUrl);
  const startTime = Date.now();

  console.log(`[MCP] ▶ ${server}/${toolName}`, JSON.stringify(args));

  try {
    // Step 1: Initialize MCP session
    const initRes = await fetch(serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'hardshell-agent', version: '1.0.0' },
        },
      }),
    });

    if (!initRes.ok) {
      const body = await initRes.text();
      throw new Error(`MCP init failed: ${initRes.status} ${body}`);
    }

    // Extract session ID from response header
    const sessionId = initRes.headers.get('mcp-session-id') || '';
    console.log(`[MCP]   session=${sessionId ? sessionId.slice(0, 8) + '...' : 'none'}`);

    // Parse init response - may be SSE or JSON
    const contentType = initRes.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      await initRes.text();
    }

    // Step 2: Send initialized notification
    await fetch(serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    });

    // Step 3: Call the tool
    const toolRes = await fetch(serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
    });

    if (!toolRes.ok) {
      const body = await toolRes.text();
      throw new Error(`MCP tool call failed: ${toolRes.status} ${body}`);
    }

    // Parse response - handle both JSON and SSE
    const toolContentType = toolRes.headers.get('content-type') || '';
    let resultText = '';

    if (toolContentType.includes('text/event-stream')) {
      const sseText = await toolRes.text();
      const lines = sseText.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(line.slice(6)) as JsonRpcResponse;
            if (parsed.result?.content?.[0]?.text) {
              resultText = parsed.result.content[0].text;
              break;
            }
            if (parsed.error) {
              throw new Error(`MCP error: ${parsed.error.message}`);
            }
          } catch (e) {
            if (e instanceof Error && e.message.startsWith('MCP error:')) throw e;
            // Skip non-JSON SSE lines
          }
        }
      }
      if (!resultText) {
        throw new Error('No result in MCP SSE response');
      }
    } else {
      const data = (await toolRes.json()) as JsonRpcResponse;
      if (data.error) {
        throw new Error(`MCP error: ${data.error.message}`);
      }
      resultText = data.result?.content?.[0]?.text || '';
    }

    const latencyMs = Date.now() - startTime;
    const preview = resultText.length > 120 ? resultText.slice(0, 120) + '...' : resultText;
    console.log(`[MCP] ✓ ${server}/${toolName} ${latencyMs}ms (${resultText.length} chars)`);

    // Store log entry for activity tracking
    _lastCallLog = {
      timestamp: new Date().toISOString(),
      server,
      tool: toolName,
      status: 'ok',
      latencyMs,
      resultPreview: preview,
    };

    return resultText;
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[MCP] ✗ ${server}/${toolName} FAILED ${latencyMs}ms: ${errorMsg}`);

    _lastCallLog = {
      timestamp: new Date().toISOString(),
      server,
      tool: toolName,
      status: 'error',
      latencyMs,
      error: errorMsg,
    };

    throw err;
  }
}

/** Last MCP call log — accessible for activity logging */
let _lastCallLog: McpCallLog | null = null;
export function getLastMcpCallLog(): McpCallLog | null {
  return _lastCallLog;
}

/**
 * MCP Server endpoints for Hardshell platform
 */
export const MCP_SERVERS = {
  mercury: 'https://mercury-mcp-server.jfischburg-us.workers.dev/mcp',
  stripe: 'https://stripe-mcp-server.jfischburg-us.workers.dev/mcp',
} as const;
