export default {
  routes: [
    {
      method: 'POST',
      path: '/public/applications',
      handler: 'candidate.submitApplication',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/public/recommendations',
      handler: 'candidate.publicRecommendJobPostings',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/public/applications/:token',
      handler: 'candidate.publicStatus',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/public/applications/:token/standardized-cv.pdf',
      handler: 'candidate.publicDownloadStandardizedCvPdf',
      config: { auth: false },
    },
    {
      method: 'DELETE',
      path: '/public/applications/:token',
      handler: 'candidate.publicDelete',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/public/chat',
      handler: 'candidate.publicChat',
      config: { auth: false },
    },
  ],
};
