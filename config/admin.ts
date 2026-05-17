import type { Core } from '@strapi/strapi';

const getPreviewPathname = (uid: string, { document }: { document: Record<string, any> }): string | null => {
  const { slug } = document;

  switch (uid) {
    case 'api::news.news':
      return slug ? `/news/${slug}` : '/news';
    case 'api::page.page':
      return slug ? `/${slug}` : '/';
    case 'api::events.events':
      return slug ? `/events/${slug}` : '/events';
    case 'api::summits.summits':
      return slug ? `/summits/${slug}` : '/summits';
    case 'api::job.job':
      return slug ? `/careers/${slug}` : '/careers';
    case 'api::legal-document.legal-document':
      return slug ? `/legal/${slug}` : '/legal';
    default:
      return null;
  }
};

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Admin => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET'),
    sessions: {
      maxRefreshTokenLifespan: env.int('ADMIN_MAX_REFRESH_TOKEN_LIFESPAN', 30 * 24 * 60 * 60),
      maxSessionLifespan: env.int('ADMIN_MAX_SESSION_LIFESPAN', 30 * 24 * 60 * 60),
    },
  },
  apiToken: {
    salt: env('API_TOKEN_SALT'),
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT'),
    },
  },
  secrets: {
    encryptionKey: env('ENCRYPTION_KEY'),
  },
  flags: {
    nps: env.bool('FLAG_NPS', true),
    promoteEE: env.bool('FLAG_PROMOTE_EE', true),
  },
  watchIgnoreFiles: ['**/config/sync/**'],
  preview: {
    enabled: true,
    config: {
      allowedOrigins: [env('CMS_URL', 'https://cms.tasfrl.org'), env('CLIENT_URL')],
      async handler(uid, { documentId, locale, status }) {
        const document = await strapi.documents(uid as any).findOne({ documentId });
        const pathname = getPreviewPathname(uid, { document });

        if (!pathname) {
          return null;
        }

        const cmsUrl = env('CMS_URL', 'https://cms.tasfrl.org');
        const previewSecret = env('PREVIEW_SECRET');

        // Both draft and published render inside Strapi's own preview renderer
        const params = new URLSearchParams({ uid, documentId, status, secret: previewSecret });
        return `${cmsUrl}/api/preview-render?${params}`;
      },
    },
  },
});

export default config;
