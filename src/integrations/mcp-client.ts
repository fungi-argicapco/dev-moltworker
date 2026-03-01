/**
 * MCP Client — Lightweight Streamable HTTP client for calling MCP server tools
 *
 * Used by Hardshell agents to fetch real data from our private MCP servers
 * (Mercury, Stripe) deployed on Cloudflare Workers.
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
 * Call a tool on a remote MCP server via Streamable HTTP transport.
 *
 * Flow:
 *   1. POST initialize → get session ID
 *   2. POST tools/call with session → get result
 */
export async function callMcpTool(
  serverUrl: string,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<string> {
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
    throw new Error(`MCP init failed: ${initRes.status} ${await initRes.text()}`);
  }

  // Extract session ID from response header
  const sessionId = initRes.headers.get('mcp-session-id') || '';

  // Parse init response - may be SSE or JSON
  const contentType = initRes.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    // Consume SSE init response
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
    throw new Error(`MCP tool call failed: ${toolRes.status} ${await toolRes.text()}`);
  }

  // Parse response - handle both JSON and SSE
  const toolContentType = toolRes.headers.get('content-type') || '';

  if (toolContentType.includes('text/event-stream')) {
    // Parse SSE response to extract JSON-RPC result
    const sseText = await toolRes.text();
    const lines = sseText.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(line.slice(6)) as JsonRpcResponse;
          if (parsed.result?.content?.[0]?.text) {
            return parsed.result.content[0].text;
          }
          if (parsed.error) {
            throw new Error(`MCP error: ${parsed.error.message}`);
          }
        } catch {
          // Skip non-JSON SSE lines
        }
      }
    }
    throw new Error('No result in MCP SSE response');
  }

  // Direct JSON response
  const data = (await toolRes.json()) as JsonRpcResponse;
  if (data.error) {
    throw new Error(`MCP error: ${data.error.message}`);
  }
  return data.result?.content?.[0]?.text || '';
}

/**
 * MCP Server endpoints for Hardshell platform
 */
export const MCP_SERVERS = {
  mercury: 'https://mercury-mcp-server.jfischburg-us.workers.dev/mcp',
  stripe: 'https://stripe-mcp-server.jfischburg-us.workers.dev/mcp',
} as const;
