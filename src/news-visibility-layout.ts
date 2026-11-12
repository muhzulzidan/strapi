import type { Core } from '@strapi/strapi';

export async function ensureNewsVisibilityLayout(strapi: Core.Strapi) {
  const service = strapi.plugin('content-manager').service('content-types') as any;
  const model = service.findContentType('api::news.news');
  const current = await service.findConfiguration(model);
  const edit = current.layouts?.edit || [];
  if (edit[0]?.[0]?.name === 'isPublic' && current.metadatas?.isPublic?.edit?.label === 'Visibility') return;
  const otherRows = edit.map((row: any[]) => row.filter((field: any) => field.name !== 'isPublic')).filter((row: any[]) => row.length);
  const { uid: _uid, ...configuration } = current;
  await service.updateConfiguration(model, {
    ...configuration,
    metadatas: {
      ...configuration.metadatas,
      isPublic: {
        edit: { label: 'Visibility', description: '', visible: true, editable: true },
        list: { label: 'Public', searchable: false, sortable: true },
      },
    },
    layouts: { ...configuration.layouts, edit: [[{ name: 'isPublic', size: 12 }], ...otherRows] },
  });
}
