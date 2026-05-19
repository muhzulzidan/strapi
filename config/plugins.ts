import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
	'users-permissions': {
		config: {
			jwtSecret: env('JWT_SECRET'),
		},
	},
	seo: {
		enabled: true,
	},
	sentry: {
		enabled: true,
		config: {
			dsn: env('NODE_ENV') === 'production' ? env('SENTRY_DSN') : null,
			sendMetadata: true,
		},
	},
	'config-sync': {
		enabled: true,
	},
	documentation: {
		enabled: true,
	},
});

export default config;
