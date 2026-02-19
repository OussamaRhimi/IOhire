export default {
  routes: [
    {
      method: 'GET',
      path: '/meta',
      handler: 'meta.get',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/meta/default-template',
      handler: 'meta.getDefaultTemplate',
      config: { auth: false },
    },
    {
      method: 'PUT',
      path: '/meta/default-template',
      handler: 'meta.setDefaultTemplate',
      config: { auth: false },
    },
  ],
};

