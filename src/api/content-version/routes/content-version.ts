/**
 * content-version routes
 * Defines custom routes for content history management
 */

export default {
  routes: [
    {
      method: 'GET',
      path: '/content-versions/history',
      handler: 'content-version.getHistory',
      config: {
        policies: ['global::content-history-admin'],
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/content-versions/:id',
      handler: 'content-version.getVersion',
      config: {
        policies: ['global::content-history-admin'],
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/content-versions/compare',
      handler: 'content-version.compareVersions',
      config: {
        policies: ['global::content-history-admin'],
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/content-versions/:versionId/revert',
      handler: 'content-version.revertToVersion',
      config: {
        policies: ['global::content-history-admin'],
        auth: false,
      },
    },
  ],
};
