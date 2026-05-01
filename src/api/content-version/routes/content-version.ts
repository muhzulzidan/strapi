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
        policies: [],
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/content-versions/:id',
      handler: 'content-version.getVersion',
      config: {
        policies: [],
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/content-versions/compare',
      handler: 'content-version.compareVersions',
      config: {
        policies: [],
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/content-versions/:versionId/revert',
      handler: 'content-version.revertToVersion',
      config: {
        policies: [],
      },
    },
  ],
};
