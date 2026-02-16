export default {
  routes: [
    {
      method: 'GET',
      path: '/meta',
      handler: 'meta.get',
      config: { auth: false },
    },
  ],
};

