export default {
  routes: [
    {
      method: 'GET',
      path: '/preview-render',
      handler: 'preview-render.render',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
