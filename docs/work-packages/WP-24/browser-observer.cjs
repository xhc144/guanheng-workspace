// Test-process observer only: no timeout, response, retry or application behavior changes.
const http = require('node:http');
const childProcess = require('node:child_process');
const os = require('node:os');
const stamp = (event, data = {}) => process.stderr.write(`${JSON.stringify({ wp24Observer: true, at: new Date().toISOString(), event, ...data })}\n`);
const originalCreateServer = http.createServer;
let nextSocket = 0, nextRequest = 0;
const socketIds = new WeakMap();
http.createServer = function (...args) {
  const index = typeof args[0] === 'function' ? 0 : typeof args[1] === 'function' ? 1 : -1;
  if (index >= 0) {
    const handler = args[index];
    args[index] = function (req, res) {
      const requestId = ++nextRequest, began = performance.now(), socket = socketIds.get(req.socket);
      stamp('request-start', { requestId, socket, method: req.method, path: req.url, rsc: req.headers.rsc, prefetch: req.headers['next-router-prefetch'] });
      res.on('finish', () => stamp('request-finish', { requestId, socket, status: res.statusCode, durationMs: Math.round(performance.now() - began), connection: res.getHeader('connection'), keepAlive: res.getHeader('keep-alive') }));
      res.on('close', () => { if (!res.writableFinished) stamp('response-closed-before-finish', { requestId, socket }); });
      return handler.apply(this, arguments);
    };
  }
  const server = originalCreateServer.apply(this, args);
  server.on('listening', () => stamp('listening', { keepAliveTimeout: server.keepAliveTimeout, keepAliveTimeoutBuffer: server.keepAliveTimeoutBuffer, requestTimeout: server.requestTimeout }));
  server.on('connection', socket => {
    const id = ++nextSocket; socketIds.set(socket, id); stamp('socket-open', { socket: id });
    socket.on('timeout', () => stamp('socket-timeout', { socket: id }));
    socket.on('end', () => stamp('socket-end', { socket: id }));
    socket.on('close', hadError => stamp('socket-close', { socket: id, hadError, bytesRead: socket.bytesRead, bytesWritten: socket.bytesWritten }));
  });
  return server;
};
const originalExec = childProcess.execFileSync;
childProcess.execFileSync = function (command, args, options) {
  if (command !== 'pnpm') return originalExec.apply(this, arguments);
  const began = performance.now();
  stamp('pnpm-start', { timeout: options?.timeout, loadavg: os.loadavg(), memory: process.memoryUsage().rss });
  try {
    const result = originalExec.apply(this, arguments);
    const version = String(result).trim();
    stamp('pnpm-finish', { durationMs: Math.round(performance.now() - began), version: /^\d+\.\d+\.\d+$/.test(version) ? version : null });
    return result;
  } catch (error) {
    stamp('pnpm-failed', { durationMs: Math.round(performance.now() - began), code: error.code, status: error.status, signal: error.signal, loadavg: os.loadavg() });
    throw error;
  }
};
process.on('uncaughtExceptionMonitor', error => stamp('uncaught-exception', { name: error.name, message: error.message }));
process.on('exit', code => stamp('process-exit', { code }));
