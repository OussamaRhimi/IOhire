export default {
  routes: [
    {
      method: 'GET',
      path: '/hr/cv-templates',
      handler: 'candidate.hrListCvTemplates',
      config: { auth: { scope: ['api::candidate.candidate.find'] } },
    },
    {
      method: 'GET',
      path: '/hr/cv-templates/:key/sample-html',
      handler: 'candidate.hrGetCvTemplateSampleHtml',
      config: { auth: { scope: ['api::candidate.candidate.find'] } },
    },
    {
      method: 'GET',
      path: '/hr/cv-templates/:key/sample-markdown',
      handler: 'candidate.hrGetCvTemplateSampleHtml',
      config: { auth: { scope: ['api::candidate.candidate.find'] } },
    },
    {
      method: 'GET',
      path: '/hr/candidates/:id/detail',
      handler: 'candidate.hrFindOne',
      config: { auth: { scope: ['api::candidate.candidate.findOne'] } },
    },
    {
      method: 'PATCH',
      path: '/hr/candidates/:id/template',
      handler: 'candidate.hrSetCvTemplate',
      config: { auth: { scope: ['api::candidate.candidate.update'] } },
    },
    {
      method: 'POST',
      path: '/hr/candidates/:id/reprocess',
      handler: 'candidate.hrReprocess',
      config: { auth: { scope: ['api::candidate.candidate.update'] } },
    },
    {
      method: 'DELETE',
      path: '/hr/candidates/:id',
      handler: 'candidate.hrDelete',
      config: { auth: { scope: ['api::candidate.candidate.delete'] } },
    },
    {
      method: 'GET',
      path: '/hr/candidates/:id/resume',
      handler: 'candidate.downloadResume',
      config: { auth: { scope: ['api::candidate.candidate.findOne'] } },
    },
    {
      method: 'GET',
      path: '/hr/candidates/:id/standardized-cv.pdf',
      handler: 'candidate.downloadStandardizedCvPdf',
      config: { auth: { scope: ['api::candidate.candidate.findOne'] } },
    },
  ],
};
