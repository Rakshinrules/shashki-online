// Direct MCP client for an active assistant run. Does not invoke any model API.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const endpoint = process.env.GAME_BRIDGE_URL;
const token = process.env.AGENT_TOKEN;
if (!endpoint || !token) throw new Error('Set GAME_BRIDGE_URL and AGENT_TOKEN in the execution environment.');
const client = new Client({ name: 'current-chat-transport', version: '0.1.0' });
const tool = process.argv[2];
if (!['wait_event', 'reply'].includes(tool)) throw new Error('Expected wait_event or reply.');
let input = '';
if (tool === 'reply') for await (const chunk of process.stdin) input += chunk;
const args = tool === 'wait_event' ? { waitMs: 25000 } : JSON.parse(input);
try {
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } }
  }));
  console.log(JSON.stringify(await client.callTool({ name: tool, arguments: args })));
} finally { await client.close(); }
