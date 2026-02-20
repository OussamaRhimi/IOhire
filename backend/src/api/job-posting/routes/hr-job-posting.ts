export default {
  routes: [
    {
      method: 'GET',
      path: '/hr/job-postings/:id/eval-config',
      handler: 'job-posting.hrGetEvalConfig',
      config: { auth: { scope: ['api::job-posting.job-posting.findOne'] } },
    },
    {
      method: 'PUT',
      path: '/hr/job-postings/:id/eval-config',
      handler: 'job-posting.hrSetEvalConfig',
      config: { auth: { scope: ['api::job-posting.job-posting.update'] } },
    },
  ],
};
