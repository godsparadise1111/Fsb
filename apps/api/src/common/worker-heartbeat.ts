import { INestApplicationContext, Logger } from '@nestjs/common';
import { writeFileSync } from 'node:fs';
import { DataSource } from 'typeorm';

/**
 * Worker liveness signal for Docker healthchecks.
 *
 * Every interval the worker proves it can reach PostgreSQL (SELECT 1) and only then
 * refreshes the heartbeat file. A hung process, a lost DB connection or a crashed event
 * loop therefore makes the file go stale and the container turns "unhealthy".
 * The timer is intentionally NOT unref'd: it also keeps a worker process alive even when
 * the PostgreSQL pool has dropped its idle clients.
 */
export function startWorkerHeartbeat(app: INestApplicationContext, workerName: string): () => void {
  const logger = new Logger('WorkerHeartbeat');
  const file = process.env.FSB_WORKER_HEARTBEAT_FILE ?? '/tmp/fsb-worker-heartbeat';
  const requested = Number(process.env.FSB_WORKER_HEARTBEAT_MS ?? 15000);
  const intervalMs = Number.isFinite(requested) ? Math.min(60000, Math.max(5000, requested)) : 15000;
  const dataSource = app.get(DataSource, { strict: false });
  let running = false;

  const beat = async () => {
    if (running) return;
    running = true;
    try {
      await dataSource.query('SELECT 1');
      writeFileSync(file, JSON.stringify({ worker: workerName, pid: process.pid, at: new Date().toISOString() }));
    } catch (error) {
      logger.warn(`Heartbeat skipped for ${workerName}: ${String(error).slice(0, 300)}`);
    } finally {
      running = false;
    }
  };

  void beat();
  const timer = setInterval(() => void beat(), intervalMs);
  const stop = () => clearInterval(timer);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  logger.log(`Heartbeat started for ${workerName} (every ${intervalMs}ms -> ${file})`);
  return stop;
}
