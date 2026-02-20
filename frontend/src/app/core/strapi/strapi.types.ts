export type CandidateStatus =
  | 'new'
  | 'processing'
  | 'processed'
  | 'reviewing'
  | 'shortlisted'
  | 'rejected'
  | 'hired'
  | 'error';

export type JobPostingStatus = 'draft' | 'open' | 'closed';

export type JobRequirements = {
  skillsRequired?: string[];
  skillsNiceToHave?: string[];
  departments?: string[];
  minYearsExperience?: number;
  notes?: string;
  evaluationConfig?: EvaluationConfig;
};

export type CompletenessPointsConfig = {
  fullName: number;
  email: number;
  phone: number;
  location: number;
  links: number;
  linkedin: number;
  portfolio: number;
  summary: number;
  competencies: number;
  experience: number;
  experienceDates: number;
  education: number;
};

export type CustomCriterion = {
  name: string;
  type: 'bonus' | 'penalty';
  points: number;
  keywords: string[];
  requireAll: boolean;
};

export type QualityThresholds = {
  excellent: number;
  good: number;
  fair: number;
};

export type EvaluationConfig = {
  fitWeight: number;
  completenessWeight: number;
  requiredSkillsWeight: number;
  niceToHaveSkillsWeight: number;
  experienceWeight: number;
  completenessPoints: CompletenessPointsConfig;
  customCriteria: CustomCriterion[];
  qualityThresholds: QualityThresholds;
};

export type HrLookupItem = {
  id: number;
  documentId: string | null;
  name: string;
};

export type PublicJobPosting = {
  id: number;
  title: string | null;
  description: string | null;
  requirements: JobRequirements | null;
};

export type PublicJobRecommendation = {
  id: number;
  title: string | null;
  description: string | null;
  requirements: JobRequirements | null;
  compatibility: number;
  matchedRequired: string[];
  missingRequired: string[];
  matchedNiceToHave: string[];
  missingNiceToHave: string[];
};

export type PublicRecommendationResponse = {
  skills: string[];
  totalConsidered: number;
  top: PublicJobRecommendation[];
  message: string | null;
};

export type PublicApplicationSubmitResponse = { id: number; token: string };

export type PublicApplicationStatus = {
  id: number;
  status: CandidateStatus | null;
  createdAt: string | null;
  updatedAt: string | null;
  jobTitle: string | null;
  score: number | null;
  missing: string[];
  standardizedCvReady?: boolean;
  standardizedCvMarkdown: string | null;
};

export type HrJobPosting = {
  id: number | null;
  documentId: string | null;
  title: string | null;
  description: string | null;
  requirements?: JobRequirements | null;
  status: JobPostingStatus | null;
  createdAt: string | null;
};

export type HrCandidate = {
  id: number;
  documentId: string | null;
  fullName: string | null;
  email: string | null;
  jobId: number | null;
  status: CandidateStatus | null;
  score: number | null;
  hrNotes: string | null;
  createdAt: string | null;
  updatedAt?: string | null;
  jobTitle: string | null;
  missing: string[];
};

export type HrCandidateDetail = {
  id: number;
  documentId: string | null;
  fullName: string | null;
  email: string | null;
  linkedin: string | null;
  portfolio: string | null;
  cvTemplateKey: string | null;
  status: CandidateStatus | null;
  score: number | null;
  hrNotes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  extractedData: unknown | null;
  standardizedCvMarkdown: string | null;
  jobPosting: {
    id: number | null;
    documentId: string | null;
    title: string | null;
    status: JobPostingStatus | null;
    requirements: JobRequirements | null;
  } | null;
  resume: {
    id: number | null;
    name: string | null;
    mime: string | null;
    ext: string | null;
    size: number | null;
  } | null;
};

export type CvTemplateMeta = {
  key: string;
  name: string;
  description: string;
};
