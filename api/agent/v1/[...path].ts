/**
 * The agent API's entry point on Vercel.
 *
 * Deliberately the thinnest file in the repository. Vercel's Node runtime
 * supports the web-standard handler signature, so a request is a `Request` and
 * an answer is a `Response` — which means everything real can live in
 * `src/server/agent/`, be unit tested without a server, and be moved to another
 * host by writing another file like this one.
 *
 * The catch-all covers `/api/agent/v1` and everything under it; `serveAgentApi`
 * does the routing, because the routes are part of the contract and belong with
 * the code that implements them.
 *
 * `process.env` is read here rather than there so the server layer stays a pure
 * function of its inputs. The Supabase secret key must be a plain server
 * variable: anything named `VITE_*` is compiled into the browser bundle, and
 * `readAgentApiConfig` refuses to start if the key is found under such a name.
 */

import { serveAgentApi } from '../../../src/server/agent'

export default {
  fetch(request: Request): Promise<Response> {
    return serveAgentApi(request, process.env)
  },
}
