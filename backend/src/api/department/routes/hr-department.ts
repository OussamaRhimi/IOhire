export default {
  routes: [
    {
      method: 'GET',
      path: '/hr/departments',
      handler: 'department.hrList',
      config: { auth: { scope: ['api::job-posting.job-posting.find'] } },
    },
    {
      method: 'POST',
      path: '/hr/departments',
      handler: 'department.hrCreate',
      config: { auth: { scope: ['api::job-posting.job-posting.create'] } },
    },
    {
      method: 'PUT',
      path: '/hr/departments/:id',
      handler: 'department.hrUpdate',
      config: { auth: { scope: ['api::job-posting.job-posting.update'] } },
    },
    {
      method: 'DELETE',
      path: '/hr/departments/:id',
      handler: 'department.hrDelete',
      config: { auth: { scope: ['api::job-posting.job-posting.delete'] } },
    },
  ],
};

