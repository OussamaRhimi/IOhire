import { factories } from '@strapi/strapi';

function toId(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, 120) : null;
}

function toPayload(row: any) {
  return {
    id: typeof row?.id === 'number' ? row.id : Number(row?.id),
    documentId: typeof row?.documentId === 'string' ? row.documentId : null,
    name: typeof row?.name === 'string' ? row.name : '',
  };
}

export default factories.createCoreController('api::skill.skill', ({ strapi }) => ({
  async hrList(ctx) {
    const rows = (await strapi.entityService.findMany('api::skill.skill', {
      fields: ['name', 'documentId'] as any,
      sort: { name: 'asc' } as any,
      limit: 500,
    })) as any[];

    ctx.body = (rows ?? []).map(toPayload).filter((row) => Number.isFinite(row.id) && !!row.name);
  },

  async hrCreate(ctx) {
    const body = (ctx.request as any).body ?? {};
    const name = normalizeName(body?.name ?? body?.data?.name);
    if (!name) return ctx.badRequest('name is required.');

    const duplicate = (await strapi.entityService.findMany('api::skill.skill', {
      fields: ['name'] as any,
      filters: { name: { $eqi: name } } as any,
      limit: 1,
    })) as any[];
    if (duplicate?.length) return ctx.badRequest('A skill with this name already exists.');

    const created = (await strapi.entityService.create('api::skill.skill', {
      data: { name } as any,
      fields: ['name', 'documentId'] as any,
    })) as any;

    ctx.status = 201;
    ctx.body = toPayload(created);
  },

  async hrUpdate(ctx) {
    const id = toId(ctx.params?.id);
    if (!id) return ctx.badRequest('Invalid skill id.');

    const body = (ctx.request as any).body ?? {};
    const name = normalizeName(body?.name ?? body?.data?.name);
    if (!name) return ctx.badRequest('name is required.');

    const existing = await strapi.entityService.findOne('api::skill.skill', id, {
      fields: ['name', 'documentId'] as any,
    });
    if (!existing) return ctx.notFound();

    const duplicate = (await strapi.entityService.findMany('api::skill.skill', {
      fields: ['name'] as any,
      filters: { $and: [{ name: { $eqi: name } }, { id: { $ne: id } }] } as any,
      limit: 1,
    })) as any[];
    if (duplicate?.length) return ctx.badRequest('A skill with this name already exists.');

    const updated = (await strapi.entityService.update('api::skill.skill', id, {
      data: { name } as any,
      fields: ['name', 'documentId'] as any,
    })) as any;

    ctx.body = toPayload(updated);
  },

  async hrDelete(ctx) {
    const id = toId(ctx.params?.id);
    if (!id) return ctx.badRequest('Invalid skill id.');

    const existing = await strapi.entityService.findOne('api::skill.skill', id, {
      fields: ['id'] as any,
    });
    if (!existing) return ctx.notFound();

    await strapi.entityService.delete('api::skill.skill', id);
    ctx.status = 204;
  },
}));

