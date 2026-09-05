/**
 * The deployment behind a real socket, for the tests with an outside oracle.
 *
 * The platform hands the deployment a web `Request` and expects a `Response`;
 * this is the shortest shim that produces one from a real `node:http`
 * connection, which is what the official MCP SDK's client needs to talk to.
 *
 * Shared between `interop.test.ts` and `src/render/agentLoop.test.ts` because
 * both of them make the same claim from opposite ends — the SDK validates every
 * message against the specification's own schemas — and two copies of a shim
 * are two chances for one of them to be subtly friendlier than the platform is.
 *
 * No test framework is imported here, on purpose: the file could never pull one
 * into the server bundle if an import ever reached it.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { AGENT_MCP_PATH } from '../../routing'
import { handleAgentRequest } from '../agent/handler'
import type { Harness } from './testHarness'

export interface ServedHarness {
  server: Server
  /** The MCP endpoint's address on the listening port. */
  address: URL
  close(): Promise<void>
}

/**
 * One connection, answered by the deployment.
 *
 * Exported so a test can put something *in front* of it — a redirect, a
 * protection wall — without a second copy of this shim. Two shims are two
 * chances for one of them to be subtly friendlier than the platform is, which
 * is the whole reason this file exists.
 */
export function respondWith(
  harnessed: Harness,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): void {
  const chunks: Buffer[] = []
  incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
  incoming.on('end', () => {
    const body = Buffer.concat(chunks)
    const headers = new Headers()
    for (const [name, value] of Object.entries(incoming.headers)) {
      for (const single of Array.isArray(value) ? value : [value ?? '']) {
        if (single) headers.append(name, single)
      }
    }

    const request = new Request(`http://localhost${incoming.url ?? '/'}`, {
      method: incoming.method,
      headers,
      ...(body.byteLength > 0 ? { body } : {}),
    })

    void handleAgentRequest(harnessed.deps, request).then(async (response) => {
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    })
  })
}

export function serveHarness(harnessed: Harness): Server {
  return createServer((incoming, outgoing) => respondWith(harnessed, incoming, outgoing))
}

/** Listen on an ephemeral port and report where the MCP endpoint answers. */
export async function listenHarness(harnessed: Harness): Promise<ServedHarness> {
  const server = serveHarness(harnessed)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    server,
    address: new URL(`http://127.0.0.1:${port}${AGENT_MCP_PATH}`),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
