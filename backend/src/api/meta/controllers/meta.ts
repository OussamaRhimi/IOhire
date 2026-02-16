export default {
  async get(ctx) {
    const strapi = (globalThis as any).strapi;
    if (!strapi?.contentTypes) {
      ctx.status = 500;
      ctx.body = { error: 'Strapi contentTypes unavailable.' };
      return;
    }

    const jobPosting = strapi.contentTypes['api::job-posting.job-posting'];
    const candidate = strapi.contentTypes['api::candidate.candidate'];

    const jobPostingStatuses = jobPosting?.attributes?.status?.enum ?? [];
    const candidateStatuses = candidate?.attributes?.status?.enum ?? [];

    ctx.body = {
      jobPostingStatuses: Array.isArray(jobPostingStatuses) ? jobPostingStatuses : [],
      candidateStatuses: Array.isArray(candidateStatuses) ? candidateStatuses : [],
    };
  },
};

