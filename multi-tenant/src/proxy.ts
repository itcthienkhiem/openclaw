/**
 * HTTP + WebSocket reverse proxy.
 *
 * Forwards tenant requests to their isolated openclaw gateway instance,
 * replacing the tenant's API key with openclaw's internal gateway token.
 */

import httpProxy from "http-proxy";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  // Increase timeout — agent responses can be long-running
  proxyTimeout: 300_000,
  timeout: 300_000,
});

proxy.on("error", (err, req, res) => {
  console.error("[proxy] error:", err.message);
  if (res instanceof ServerResponse && !res.headersSent) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Bad Gateway", detail: err.message }));
  }
});

/**
 * Mutate request headers so openclaw sees its own auth token,
 * not the tenant's external API key.
 */
function injectOpenclawAuth(req: IncomingMessage, openclawToken: string): void {
  req.headers["authorization"] = `Bearer ${openclawToken}`;
  // Also set the header openclaw checks for WebSocket connections
  req.headers["x-gateway-token"] = openclawToken;
  // Remove tenant-facing header so it isn't forwarded
  delete req.headers["x-api-key"];
}

export function proxyHttp(
  req: IncomingMessage,
  res: ServerResponse,
  port: number,
  openclawToken: string
): void {
  injectOpenclawAuth(req, openclawToken);
  proxy.web(req, res, { target: `http://127.0.0.1:${port}` });
}

export function proxyWebSocket(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  port: number,
  openclawToken: string
): void {
  injectOpenclawAuth(req, openclawToken);
  proxy.ws(req, socket, head, { target: `http://127.0.0.1:${port}` });
}
