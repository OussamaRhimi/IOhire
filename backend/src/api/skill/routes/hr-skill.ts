export default {
  routes: [
    {
      method: 'GET',
      path: '/hr/skills',
      handler: 'skill.hrList',
      config: { auth: { scope: ['api::job-posting.job-posting.find'] } },
    },
    {
      method: 'POST',
      path: '/hr/skills',
      handler: 'skill.hrCreate',
      config: { auth: { scope: ['api::job-posting.job-posting.create'] } },
    },
    {
      method: 'PUT',
      path: '/hr/skills/:id',
      handler: 'skill.hrUpdate',
      config: { auth: { scope: ['api::job-posting.job-posting.update'] } },
    },
    {
      method: 'DELETE',
      path: '/hr/skills/:id',
      handler: 'skill.hrDelete',
      config: { auth: { scope: ['api::job-posting.job-posting.delete'] } },
    },
  ],
};

