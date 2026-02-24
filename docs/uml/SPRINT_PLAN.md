# IOhire Sprint Plan

Baseline: **4 sprints** across ~15 weeks (Feb 20 – Jun 2, 102 calendar days).

| Sprint | Duration | Main Scope |
|---|---:|---|
| Sprint 1 | 3.5 weeks (25 days) | HR authentication (Strapi Admin) + taxonomy (Skills/Departments CRUD) + Job Posting management + cascade deletion + admin shell layout |
| Sprint 2 | 4 weeks (27 days) | Candidate application lifecycle: public submit/track/delete, resume upload + consent, HR review/status/notes |
| Sprint 3 | 3.5 weeks (26 days) | AI pipeline (parsing, scoring, standardized CV), CV templates/PDF, reprocess |
| Sprint 4 | 3.5 weeks (24 days) | Decision support (filtering, bulk status), analytics dashboard, AI evaluation config, job recommendations, chatbot, default template |

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

- Admin shell provides the HR portal layout foundation from the start.
- Skills and Departments are prerequisites for structured requirements modeling.
- Job posting quality must be established before opening candidate intake.
- AI scoring and CV generation should run on stable candidate + job posting data.
- Advanced AI features (evaluation config, recommendations, chatbot) and decision support are most valuable after the core AI pipeline is mature.

## If your school asks for only 3 sprints

Merge Sprint 3 and Sprint 4:

- Sprint 1: Foundation + Auth + Taxonomy + Jobs + Admin Shell
- Sprint 2: Candidate flow + HR review
- Sprint 3: AI pipeline + Templates + Decision support + Analytics + Recommendations + Chatbot
