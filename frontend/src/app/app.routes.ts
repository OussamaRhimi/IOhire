import { Routes } from '@angular/router';

import { hrAuthGuard, hrAuthMatchGuard } from './core/auth/hr-auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/public/public-shell/public-shell').then((m) => m.PublicShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      {
        path: 'home',
        title: 'Home',
        loadComponent: () => import('./pages/public/home-page/home-page').then((m) => m.HomePage),
      },
      {
        path: 'apply',
        title: 'Apply',
        loadComponent: () => import('./pages/public/apply-page/apply-page').then((m) => m.ApplyPage),
      },
      {
        path: 'track',
        title: 'Track application',
        loadComponent: () => import('./pages/public/track-page/track-page').then((m) => m.TrackPage),
      },
      {
        path: 'recommendation',
        title: 'Recommendation',
        loadComponent: () =>
          import('./pages/public/recommendation-page/recommendation-page').then((m) => m.RecommendationPage),
      },
    ],
  },
  {
    path: 'admin',
    title: 'Admin',
    canMatch: [hrAuthMatchGuard],
    canActivate: [hrAuthGuard],
    loadComponent: () => import('./pages/admin/admin-shell/admin-shell').then((m) => m.AdminShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'analytics' },
      {
        path: 'analytics',
        title: 'Analytics',
        loadComponent: () =>
          import('./pages/admin/admin-analytics-page/admin-analytics-page').then((m) => m.AdminAnalyticsPage),
      },
      {
        path: 'hr/jobs',
        title: 'HR jobs',
        loadComponent: () => import('./pages/hr/hr-jobs-page/hr-jobs-page').then((m) => m.HrJobsPage),
      },
      {
        path: 'hr/candidates',
        title: 'HR candidates',
        loadComponent: () => import('./pages/hr/hr-candidates-page/hr-candidates-page').then((m) => m.HrCandidatesPage),
      },
      {
        path: 'hr/templates',
        title: 'CV templates',
        loadComponent: () =>
          import('./pages/hr/hr-templates-page/hr-templates-page').then((m) => m.HrTemplatesPage),
      },
      {
        path: 'hr/skills',
        title: 'Skills',
        loadComponent: () => import('./pages/hr/hr-skills-page/hr-skills-page').then((m) => m.HrSkillsPage),
      },
      {
        path: 'hr/departments',
        title: 'Departments',
        loadComponent: () =>
          import('./pages/hr/hr-departments-page/hr-departments-page').then((m) => m.HrDepartmentsPage),
      },
      {
        path: 'candidates/:id',
        title: 'Candidate',
        loadComponent: () =>
          import('./pages/hr/hr-candidate-page/hr-candidate-page').then((m) => m.HrCandidatePage),
      },
    ],
  },
  {
    path: 'hr',
    loadComponent: () => import('./pages/hr/hr-shell/hr-shell').then((m) => m.HrShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: '/admin' },
      {
        path: 'login',
        title: 'HR login',
        loadComponent: () => import('./pages/hr/hr-login-page/hr-login-page').then((m) => m.HrLoginPage),
      },
      {
        path: 'jobs',
        title: 'HR jobs',
        canActivate: [hrAuthGuard],
        loadComponent: () => import('./pages/hr/hr-jobs-page/hr-jobs-page').then((m) => m.HrJobsPage),
      },
      {
        path: 'candidates',
        title: 'HR candidates',
        canActivate: [hrAuthGuard],
        loadComponent: () =>
          import('./pages/hr/hr-candidates-page/hr-candidates-page').then((m) => m.HrCandidatesPage),
      },
      {
        path: 'candidates/:id',
        title: 'Candidate',
        canActivate: [hrAuthGuard],
        loadComponent: () => import('./pages/hr/hr-candidate-page/hr-candidate-page').then((m) => m.HrCandidatePage),
      },
      {
        path: 'skills',
        title: 'Skills',
        canActivate: [hrAuthGuard],
        loadComponent: () => import('./pages/hr/hr-skills-page/hr-skills-page').then((m) => m.HrSkillsPage),
      },
      {
        path: 'departments',
        title: 'Departments',
        canActivate: [hrAuthGuard],
        loadComponent: () =>
          import('./pages/hr/hr-departments-page/hr-departments-page').then((m) => m.HrDepartmentsPage),
      },
    ],
  },
  { path: '**', redirectTo: 'home' },
];
