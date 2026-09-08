/**
 * The optimiser's worker: one message in, one picture out.
 *
 * Decoding a twelve-megapixel photograph and drawing it down takes long enough
 * to freeze an editor if it happened on the main thread, so the pixel work
 * runs here. The protocol is deliberately tiny — a job with an id, an answer
 * with the same id — and the work itself is `imagePipeline.ts`, the same
 * module the main-thread fallback runs, so the two paths cannot disagree
 * about what a job means.
 *
 * Buffers are transferred rather than copied in both directions: the file
 * comes in as the bytes that were read from the store, and the result goes
 * back as the bytes that will be written to it.
 */

import { processRaster, type RasterJob, type RasterResult } from './imagePipeline'

export interface WorkerRequest {
  id: number
  job: RasterJob
}

export type WorkerResponse =
  | { id: number; ok: true; result: RasterResult }
  | { id: number; ok: false; message: string }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>): Promise<void> => {
  const { id, job } = event.data
  try {
    const result = await processRaster(job)
    scope.postMessage({ id, ok: true, result }, [result.bytes.buffer as ArrayBuffer])
  } catch (error) {
    scope.postMessage({
      id,
      ok: false,
      message: error instanceof Error ? error.message : 'Bildet kunne ikke behandles.',
    })
  }
}
