# IOhire Sprint Plan (Ground-Up, Constructive)

Recommended baseline: **4 sprints** across 16 weeks.

| Sprint | Suggested Duration | Main Scope |
|---|---:|---|
| Sprint 1 | 3-4 weeks | Foundation + HR authentication + **taxonomy foundation** (Skills/Departments CRUD + search) + JobPosting/JobRequirement management |
| Sprint 2 | 3-4 weeks | CandidateApplication lifecycle: public apply/track/delete, resume upload + consent, HR review/status/notes |
| Sprint 3 | 3-4 weeks | AI enrichment: parsing, scoring, StandardizedCV generation, CVTemplate selection, PDF export, job recommendations |
| Sprint 4 | 2-4 weeks | Advanced HR decision support: multi-filtering, bulk status actions, analytics dashboard, AI processing supervision |

## Rationale for this order

- Skills and Departments are prerequisites for structured JobRequirement modeling.
- JobPosting quality must be established before opening CandidateApplication intake.
- AI scoring and recommendation should run on stable CandidateApplication + JobPosting data.
- Bulk decisions and analytics are most valuable after the AI/data pipeline is mature.

## If your school asks for only 3 sprints

Merge Sprint 3 and Sprint 4:

- Sprint 1: Foundation + Auth + Taxonomy + Jobs
- Sprint 2: CandidateApplication flow + HR review
- Sprint 3: AI enrichment + Recommendation + Advanced decision support + Analytics

You can state in the report that Sprint 4 scope was integrated into Sprint 3 due timeline constraints.
