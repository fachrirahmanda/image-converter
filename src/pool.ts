import type { EncodeRequest, EncodeResponse } from './formats';

export const POOL_SIZE = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));

interface Job {
  req: EncodeRequest & { id: number };
  resolve: (buf: ArrayBuffer) => void;
  reject: (err: Error) => void;
  worker?: Worker;
}

const idle: Worker[] = [];
const pending = new Map<number, Job>();
const queue: Job[] = [];
let workerCount = 0;
let nextId = 1;

function spawn(): Worker {
  workerCount++;
  const w = new Worker(new URL('./encode.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<EncodeResponse>) => {
    const job = pending.get(e.data.id);
    pending.delete(e.data.id);
    if (job) {
      if ('error' in e.data) job.reject(new Error(e.data.error));
      else job.resolve(e.data.buffer);
    }
    idle.push(w);
    pump();
  };
  w.onerror = (e) => {
    // A crashed worker (e.g. out of memory) fails its job and is replaced.
    for (const [id, job] of pending) {
      if (job.worker === w) {
        pending.delete(id);
        job.reject(new Error(e.message || 'Encoder crashed (image may be too large)'));
      }
    }
    w.terminate();
    workerCount--;
    pump();
  };
  return w;
}

function pump() {
  while (queue.length) {
    const w = idle.pop() ?? (workerCount < POOL_SIZE ? spawn() : undefined);
    if (!w) return;
    const job = queue.shift()!;
    job.worker = w;
    pending.set(job.req.id, job);
    w.postMessage(job.req, [job.req.buffer]);
  }
}

/** Encode raw RGBA pixels in a worker. The buffer is transferred (detached) from the caller. */
export function encode(req: EncodeRequest): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    queue.push({ req: { ...req, id: nextId++ }, resolve, reject });
    pump();
  });
}
