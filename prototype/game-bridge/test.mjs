import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createBridge } from './server.mjs';

const playerToken = 'test-player-'.repeat(4), agentToken = 'test-agent-'.repeat(4);
async function launch(dbPath) {
  const bridge = createBridge({ playerToken, agentToken, dbPath });
  const server = bridge.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const player = async (path, body) => {
    const response = await fetch(url + path, { method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${playerToken}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  };
  const connect = async () => {
    const client = new Client({ name: 'transport-test-not-gpt', version: '1.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url + '/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${agentToken}` } }
    }));
    return client;
  };
  return { ...bridge, url, player, connect, close: async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); bridge.store.close();
  } };
}

test('SDK client: waiting wakes on player event; response delivered without reload', async () => {
  const b = await launch(); const c = await b.connect();
  try {
    assert.deepEqual((await c.listTools()).tools.map(t => t.name), ['wait_event', 'reply']);
    const waiting = c.callTool({ name: 'wait_event', arguments: { waitMs: 5000 } });
    await new Promise(resolve => setTimeout(resolve, 50));
    const start = performance.now();
    const incoming = { id: randomUUID(), text: 'Нажал кнопку' };
    const sent = await b.player('/api/events', incoming); assert.equal(sent.status, 200);
    const received = (await waiting).structuredContent.events[0];
    assert.equal(received.id, incoming.id);
    assert.ok(performance.now() - start < 1000, 'transport must not wait for the full long-poll timeout');
    const view = b.player(`/api/events?after=${received.seq}&wait=5000`);
    const args = { id: randomUUID(), replyTo: incoming.id, text: 'Тестовый ответ клиента, не GPT.' };
    const response = await c.callTool({ name: 'reply', arguments: args });
    assert.equal(response.structuredContent.event.text, args.text);
    assert.equal((await view).data.events[0].text, args.text);
    assert.equal((await c.callTool({ name: 'wait_event', arguments: { waitMs: 0 } })).structuredContent.events.length, 0);
  } finally { await c.close(); await b.close(); }
});

test('duplicate requests do not duplicate events or replies; conflicting retry rejected', async () => {
  const b = await launch(); const c = await b.connect();
  try {
    const incoming = { id: randomUUID(), text: 'Один ход' };
    await Promise.all([b.player('/api/events', incoming), b.player('/api/events', incoming)]);
    assert.equal(b.store.list().length, 1);
    assert.equal((await b.player('/api/events', { ...incoming, text: 'Другой ход' })).status, 409);
    const args = { id: randomUUID(), replyTo: incoming.id, text: 'Один ответ' };
    await c.callTool({ name: 'reply', arguments: args });
    await c.callTool({ name: 'reply', arguments: args });
    assert.equal(b.store.list().length, 2);
    const conflict = await c.callTool({ name: 'reply', arguments: { ...args, id: randomUUID() } });
    assert.equal(conflict.isError, true);
  } finally { await c.close(); await b.close(); }
});

test('server restart and new agent client restore history and unanswered event', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'game-bridge-')); const db = join(dir, 'events.sqlite');
  let b = await launch(db); let c;
  try {
    const incoming = { id: randomUUID(), text: 'Сохрани меня' };
    await b.player('/api/events', incoming);
    await b.close(); b = await launch(db); c = await b.connect();
    assert.equal((await b.player('/api/events?wait=0')).data.events[0].id, incoming.id);
    assert.equal((await c.callTool({ name: 'wait_event', arguments: { waitMs: 0 } })).structuredContent.events[0].id, incoming.id);
    await c.callTool({ name: 'reply', arguments: { id: randomUUID(), replyTo: incoming.id, text: 'Восстановлено' } });
    await c.close(); c = undefined; await b.close(); b = await launch(db);
    assert.equal(b.store.list().length, 2); assert.equal(b.store.pending().length, 0);
  } finally { if (c) await c.close(); await b.close(); await rm(dir, { recursive: true, force: true }); }
});

test('player cannot call agent tools; no credentials, bad origin and malformed input rejected', async () => {
  const b = await launch();
  try {
    assert.equal((await fetch(b.url + '/api/events?wait=0')).status, 401);
    assert.equal((await fetch(b.url + '/mcp', { method: 'POST', headers: { Authorization: `Bearer ${playerToken}` } })).status, 401);
    assert.equal((await fetch(b.url + '/api/events', { method: 'POST', headers: { Origin: 'https://untrusted.example', Authorization: `Bearer ${playerToken}` } })).status, 403);
    assert.equal((await b.player('/api/events', { id: randomUUID(), text: '', actor: 'assistant' })).status, 400);
    assert.equal((await b.player('/api/events', { id: randomUUID(), text: 'x'.repeat(2001) })).status, 400);
    assert.equal(b.store.list().length, 0);
  } finally { await b.close(); }
});

test('normal idle timeout returns an empty list and next wait still works', async () => {
  const b = await launch(); const c = await b.connect();
  try {
    assert.equal((await c.callTool({ name: 'wait_event', arguments: { waitMs: 100 } })).structuredContent.events.length, 0);
    assert.equal(b.store.activeWaits, 0);
    const incoming = { id: randomUUID(), text: 'После ожидания' };
    await b.player('/api/events', incoming);
    assert.equal((await c.callTool({ name: 'wait_event', arguments: { waitMs: 100 } })).structuredContent.events[0].id, incoming.id);
  } finally { await c.close(); await b.close(); }
});
