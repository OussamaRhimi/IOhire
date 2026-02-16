import type { Core } from '@strapi/strapi';

import { processCandidate } from './utils/candidate-ai';

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  bootstrap({ strapi }: { strapi: Core.Strapi }) {
    const rule = process.env.CANDIDATE_RETENTION_CRON ?? '0 0 * * *';
    const enabled = (process.env.CANDIDATE_RETENTION_PURGE_ENABLED ?? 'true').toLowerCase() === 'true';

    if (!enabled) {
      strapi.log.info('[retention] Purge disabled (CANDIDATE_RETENTION_PURGE_ENABLED=false).');
    } else {
      strapi.cron.add({
        purgeExpiredCandidates: {
          options: { rule },
          task: async ({ strapi }) => {
            const nowIso = new Date().toISOString();
            const expired = (await strapi.entityService.findMany('api::candidate.candidate', {
              filters: { retentionUntil: { $lt: nowIso } } as any,
              populate: ['resume'] as any,
              limit: 500,
            })) as any[];

            if (!expired?.length) return;

            const uploadSvc = strapi.plugin('upload').service('upload');
            for (const candidate of expired) {
              try {
                const resume = Array.isArray(candidate.resume) ? candidate.resume[0] : candidate.resume;
                const resumeId = resume?.id ?? null;

                await strapi.entityService.delete('api::candidate.candidate', candidate.id);

                if (resumeId) {
                  const file = await uploadSvc.findOne(resumeId);
                  if (file) await uploadSvc.remove(file);
                }
              } catch (err: any) {
                strapi.log.error(`[retention] Failed to purge candidate ${candidate?.id}: ${err?.message ?? err}`);
              }
            }

            strapi.log.info(`[retention] Purged ${expired.length} expired candidate(s).`);
          },
        },
      });
    }

    const stuckEnabled = (process.env.CANDIDATE_PROCESSING_WATCHDOG_ENABLED ?? 'true').toLowerCase() === 'true';
    const stuckRule = process.env.CANDIDATE_PROCESSING_WATCHDOG_CRON ?? '*/2 * * * *';
    const stuckMinutes = Number(process.env.CANDIDATE_PROCESSING_TIMEOUT_MINUTES ?? 15);

    if (!stuckEnabled) {
      strapi.log.info('[candidate-ai] Watchdog disabled (CANDIDATE_PROCESSING_WATCHDOG_ENABLED=false).');
      return;
    }

    strapi.cron.add({
      markStuckProcessingCandidates: {
        options: { rule: stuckRule },
        task: async ({ strapi }) => {
          if (!Number.isFinite(stuckMinutes) || stuckMinutes <= 0) return;
          const threshold = new Date(Date.now() - stuckMinutes * 60 * 1000).toISOString();

          const stuck = (await strapi.entityService.findMany('api::candidate.candidate', {
            filters: { status: 'processing', updatedAt: { $lt: threshold } } as any,
            fields: ['id', 'updatedAt'] as any,
            limit: 200,
          })) as any[];

          if (!stuck?.length) return;

          for (const c of stuck) {
            try {
              await strapi.entityService.update('api::candidate.candidate', c.id, {
                data: {
                  status: 'error',
                  hrNotes: `AI processing timed out after ${stuckMinutes} minutes. Please try reprocessing.`,
                } as any,
              });
            } catch (err: any) {
              strapi.log.error(`[candidate-ai] Watchdog failed updating candidate ${c?.id}: ${err?.message ?? err}`);
            }
          }

          strapi.log.warn(`[candidate-ai] Marked ${stuck.length} candidate(s) as error (stuck > ${stuckMinutes}m).`);
        },
      },
    });

    const workerEnabled = (process.env.CANDIDATE_AI_WORKER_ENABLED ?? 'true').toLowerCase() === 'true';
    const workerRule = process.env.CANDIDATE_AI_WORKER_CRON ?? '*/1 * * * *';
    const workerBatch = Number(process.env.CANDIDATE_AI_WORKER_BATCH ?? 3);

    if (!workerEnabled) {
      strapi.log.info('[candidate-ai] Worker disabled (CANDIDATE_AI_WORKER_ENABLED=false).');
      return;
    }

    strapi.cron.add({
      processNewCandidates: {
        options: { rule: workerRule },
        task: async ({ strapi }) => {
          const batch = Number.isFinite(workerBatch) ? Math.max(1, Math.min(10, workerBatch)) : 3;

          const pending = (await strapi.entityService.findMany('api::candidate.candidate', {
            filters: { status: 'new' } as any,
            fields: ['id', 'createdAt'] as any,
            sort: { createdAt: 'asc' } as any,
            limit: batch,
          })) as any[];

          if (!pending?.length) return;

          for (const c of pending) {
            const id = typeof c?.id === 'number' ? c.id : Number(c?.id);
            if (!Number.isFinite(id) || id <= 0) continue;

            try {
              // Claim work first so we don't repeatedly queue it on every cron tick.
              await strapi.entityService.update('api::candidate.candidate', id, {
                data: { status: 'processing' } as any,
              });

              setImmediate(() => {
                processCandidate(id).catch((error) => {
                  strapi?.log?.error?.(
                    `[candidate-ai] Worker failed for candidate ${id}: ${error?.message ?? error}`
                  );
                });
              });
            } catch (err: any) {
              strapi.log.error(`[candidate-ai] Worker could not start candidate ${id}: ${err?.message ?? err}`);
            }
          }
        },
      },
    });
  },
};
