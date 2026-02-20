import { factories } from '@strapi/strapi';
import { mergeEvaluationConfig, DEFAULT_EVALUATION_CONFIG } from '../../../utils/candidate-ai';

export default factories.createCoreController('api::job-posting.job-posting', ({ strapi }) => ({
  async publicList(ctx) {
    const items = await strapi.entityService.findMany('api::job-posting.job-posting', {
      filters: { status: 'open' },
      fields: ['title', 'description', 'requirements'],
      sort: { createdAt: 'desc' },
    });

    ctx.body = (items ?? []).map((jp: any) => ({
      id: jp.id,
      title: jp.title ?? null,
      description: jp.description ?? null,
      requirements: jp.requirements ?? null,
    }));
  },

  async publicFindOne(ctx) {
    const id = Number(ctx.params?.id);
    if (!Number.isFinite(id)) return ctx.badRequest('Invalid id');

    const jp = await strapi.entityService.findOne('api::job-posting.job-posting', id, {
      fields: ['title', 'description', 'status', 'requirements'],
    });

    if (!jp || (jp as any).status === 'closed' || (jp as any).status === 'draft') return ctx.notFound();

    ctx.body = {
      id: (jp as any).id,
      title: (jp as any).title ?? null,
      description: (jp as any).description ?? null,
      requirements: (jp as any).requirements ?? null,
    };
  },

  /* ------------------------------------------------------------------ */
  /*  AI Evaluation Config per Job Posting                               */
  /* ------------------------------------------------------------------ */

  async hrGetEvalConfig(ctx) {
    const id = Number(ctx.params?.id);
    if (!Number.isFinite(id)) return ctx.badRequest('Invalid id');

    const jp = (await strapi.entityService.findOne('api::job-posting.job-posting', id, {
      fields: ['requirements'] as any,
    })) as any;
    if (!jp) return ctx.notFound();

    const raw = jp.requirements?.evaluationConfig ?? null;
    ctx.body = { evaluationConfig: mergeEvaluationConfig(raw), defaults: DEFAULT_EVALUATION_CONFIG };
  },

  async hrSetEvalConfig(ctx) {
    const id = Number(ctx.params?.id);
    if (!Number.isFinite(id)) return ctx.badRequest('Invalid id');

    const body = (ctx.request as any).body ?? {};
    const incoming = body.evaluationConfig;
    if (!incoming || typeof incoming !== 'object') return ctx.badRequest('evaluationConfig object is required.');

    const jp = (await strapi.entityService.findOne('api::job-posting.job-posting', id, {
      fields: ['requirements'] as any,
    })) as any;
    if (!jp) return ctx.notFound();

    const validated = mergeEvaluationConfig(incoming);
    const requirements = { ...(jp.requirements ?? {}), evaluationConfig: validated };

    await strapi.entityService.update('api::job-posting.job-posting', id, {
      data: { requirements } as any,
    });

    ctx.body = { ok: true, evaluationConfig: validated };
  },
}));
