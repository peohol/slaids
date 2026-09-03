/**
 * The agent API's entry point on Vercel.
 *
 * Deliberately the thinnest file in the repository, and the only one under
 * `api/`. Vercel's Node runtime takes the web-standard handler signature, so a
 * request is a `Request` and an answer is a `Response` — which means everything
 * real lives in `src/server/agent/`, is unit tested without a server, and moves
 * to another host by writing another file like this one.
 *
 * The import points at a *bundle*, not at the source tree, and that is load
 * bearing rather than an optimisation. The platform compiles each `.ts` file on
 * its own and lets Node resolve the imports between them; TypeScript emits
 * specifiers verbatim, and Node's ESM resolver has neither extension guessing
 * nor directory/index lookup — so `from '../../../src/server/agent'` fails at
 * the first invocation with `ERR_UNSUPPORTED_DIR_IMPORT`, and spelling out the
 * file would only move the failure one import deeper. See
 * `vite.agent-api.config.ts`.
 *
 * The catch-all covers `/api/agent/v1` and everything under it; `serveAgentApi`
 * does the routing, because the routes are part of the contract and belong with
 * the code that implements them.
 *
 * `process.env` is read here rather than there, so the server layer stays a
 * pure function of its inputs. The Supabase secret key must be a plain server
 * variable: anything named `VITE_*` is compiled into the browser bundle, and
 * `readAgentApiConfig` refuses to start if the key is found under such a name.
 */

import { serveAgentApi } from '../../../src/server/generated/agentApi.js'

export default {
  fetch(request: Request): Promise<Response> {
    return serveAgentApi(request, process.env)
  },
}
