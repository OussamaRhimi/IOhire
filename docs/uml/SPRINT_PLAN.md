# IOhire Sprint Plan

Baseline: **4 sprints** across ~16 weeks.

| Sprint | Duration | Main Scope |
|---|---:|---|
| Sprint 1 | 4 weeks | HR authentication (Strapi Admin) + taxonomy (Skills/Departments CRUD) + Job Posting management with embedded requirements |
| Sprint 2 | 4 weeks | Candidate application lifecycle: public submit/track/delete, resume upload + consent, HR review/status/notes |
| Sprint 3 | 4.5 weeks | AI pipeline (parsing, scoring, standardized CV), CV templates/PDF, evaluation config, job recommendations, chatbot |
| Sprint 4 | 3 weeks | Decision support (multi-criteria filtering, bulk status), analytics dashboard, admin shell, default template config |

## Entity Model

The system has 4 content types:

| Entity | Key Fields | Notes |
|---|---|---|
| **Candidate** | fullName, email, linkedin, portfolio, resume (media), status, score, publicToken, consent, extractedData (json), standardizedCvMarkdown, cvTemplateKey, hrNotes | Single entity combining candidate info + application data. No separate CandidateApplication. |
| **JobPosting** | title, description, requirements (json), status | Requirements is embedded JSON containing skillsRequired, skillsNiceToHave, departments, minYearsExperience, notes, evaluationConfig. |
| **Skill** | name (unique) | Standalone lookup. Referenced by name in requirements JSON. |
| **Department** | name (unique) | Standalone lookup. Referenced by name in requirements JSON. |

### Key relationships
- Candidate → JobPosting: **manyToOne** (a candidate applies to one job posting)
- JobPosting → Candidate: **oneToMany** (inverse)
- Skill, Department: no schema relations (used as lookup values in requirements JSON)

## Rationale for this order

- Skills and Departments are prerequisites for structured requirements modeling.
- Job posting quality must be established before opening candidate intake.
- AI scoring and recommendation should run on stable candidate + job posting data.
- Bulk decisions and analytics are most valuable after the AI pipeline is mature.

## If your school asks for only 3 sprints

Merge Sprint 3 and Sprint 4:

- Sprint 1: Foundation + Auth + Taxonomy + Jobs
- Sprint 2: Candidate flow + HR review
- Sprint 3: AI pipeline + Recommendations + Chatbot + Decision support + Analytics
