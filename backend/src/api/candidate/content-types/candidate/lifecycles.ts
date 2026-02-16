import crypto from 'node:crypto';

import { processCandidate } from '../../../../utils/candidate-ai';

export default {
  async beforeCreate(event: { params?: { data?: Record<string, unknown> } }) {
    const data = event.params?.data ?? {};

    if (!data.publicToken) {
      data.publicToken = crypto.randomUUID();
    }

    const retentionDays = Number(process.env.CANDIDATE_RETENTION_DAYS ?? 180);
    if (!data.retentionUntil && Number.isFinite(retentionDays)) {
      data.retentionUntil = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString();
    }

    if (data.consent === true && !data.consentAt) {
      data.consentAt = new Date().toISOString();
    }
  },

  async afterCreate(event: { result?: { id?: number } }) {
    const candidateId = event.result?.id;
    if (!candidateId) return;

    setImmediate(() => {
      processCandidate(candidateId).catch((error) => {
        const strapi = (globalThis as any).strapi;
        strapi?.log?.error?.(`[candidate-ai] Failed for candidate ${candidateId}: ${error?.message ?? error}`);
      });
    });
  },
};

