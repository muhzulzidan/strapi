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
	'preview-button': {
		enabled: true,
		config: {
			contentTypes: [
				{
					uid: 'api::news.news',
					draft: {
						url: 'https://tasfrl.org/api/preview',
						query: {
							secret: env('PREVIEW_SECRET'),
							type: 'news',
							slug: '{slug}',
						},
					},
					published: {
						url: 'https://tasfrl.org/news/{slug}',
					},
				},
				{
					uid: 'api::page.page',
					draft: {
						url: 'https://tasfrl.org/api/preview',
						query: {
							secret: env('PREVIEW_SECRET'),
							type: 'page',
							slug: '{slug}',
						},
					},
					published: {
						url: 'https://tasfrl.org/{slug}',
					},
				},
				{
					uid: 'api::events.events',
					draft: {
						url: 'https://tasfrl.org/api/preview',
						query: {
							secret: env('PREVIEW_SECRET'),
							type: 'events',
							slug: '{slug}',
						},
					},
					published: {
						url: 'https://tasfrl.org/events/{slug}',
					},
				},
				{
					uid: 'api::summits.summits',
					draft: {
						url: 'https://tasfrl.org/api/preview',
						query: {
							secret: env('PREVIEW_SECRET'),
							type: 'summits',
							slug: '{slug}',
						},
					},
					published: {
						url: 'https://tasfrl.org/summits/{slug}',
					},
				},
				{
					uid: 'api::job.job',
					draft: {
						url: 'https://tasfrl.org/api/preview',
						query: {
							secret: env('PREVIEW_SECRET'),
							type: 'job',
							slug: '{slug}',
						},
					},
					published: {
						url: 'https://tasfrl.org/careers/{slug}',
					},
				},
				{
					uid: 'api::legal-document.legal-document',
					draft: {
						url: 'https://tasfrl.org/api/preview',
						query: {
							secret: env('PREVIEW_SECRET'),
							type: 'legal-document',
							slug: '{slug}',
						},
					},
					published: {
						url: 'https://tasfrl.org/legal/{slug}',
					},
				},
			],
		},
	},
	documentation: {
		enabled: true,
	},
});

export default config;
