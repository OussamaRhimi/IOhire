export default {
  routes: [
    {
      method: 'GET',
      path: '/public/job-postings',
      handler: 'job-posting.publicList',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/public/job-postings/:id',
      handler: 'job-posting.publicFindOne',
      config: { auth: false },
    },
  ],
};
