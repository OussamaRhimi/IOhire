import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  HrCandidate,
  HrCandidateDetail,
  HrJobPosting,
  JobPostingStatus,
  JobRequirements,
  CandidateStatus,
  CvTemplateMeta,
  PublicApplicationStatus,
  PublicApplicationSubmitResponse,
  PublicJobPosting,
} from './strapi.types';
import { unwrapCollection, unwrapRelation } from './strapi.unwrap';

@Injectable({ providedIn: 'root' })
export class StrapiApi {
  private readonly http = inject(HttpClient);

  async loginHr(input: { email: string; password: string }): Promise<{ jwt: string }> {
    const body = {
      identifier: input.email,
      password: input.password,
    };
    const res = await firstValueFrom(this.http.post<any>('/api/auth/local', body));
    const jwt = typeof res?.jwt === 'string' ? res.jwt.trim() : '';
    if (!jwt) throw new Error('Login failed: missing jwt.');
    return { jwt };
  }

  private async putFirstOk(paths: string[], body: unknown): Promise<void> {
    let lastError: unknown = null;
    for (const p of paths) {
      if (!p) continue;
      try {
        await firstValueFrom(this.http.put(p, body));
        return;
      } catch (e: any) {
        lastError = e;
        const status = typeof e?.status === 'number' ? e.status : null;
        if (status === 404) continue;
        throw e;
      }
    }
    throw lastError ?? new Error('Request failed.');
  }

  private async deleteFirstOk(paths: string[]): Promise<void> {
    let lastError: unknown = null;
    for (const p of paths) {
      if (!p) continue;
      try {
        await firstValueFrom(this.http.delete(p));
        return;
      } catch (e: any) {
        lastError = e;
        const status = typeof e?.status === 'number' ? e.status : null;
        if (status === 404) continue;
        throw e;
      }
    }
    throw lastError ?? new Error('Request failed.');
  }

  async getMeta(): Promise<{ jobPostingStatuses: JobPostingStatus[]; candidateStatuses: CandidateStatus[] }> {
    const res = await firstValueFrom(this.http.get<any>('/api/meta'));
    return {
      jobPostingStatuses: Array.isArray(res?.jobPostingStatuses)
        ? res.jobPostingStatuses.filter((v: any) => typeof v === 'string')
        : [],
      candidateStatuses: Array.isArray(res?.candidateStatuses) ? res.candidateStatuses.filter((v: any) => typeof v === 'string') : [],
    };
  }

  async listOpenJobPostings(): Promise<PublicJobPosting[]> {
    const res = await firstValueFrom(this.http.get<unknown>('/api/public/job-postings'));
    if (!Array.isArray(res)) return [];
    return (res as any[]).map((jp) => ({
      id: typeof jp?.id === 'number' ? jp.id : Number(jp?.id),
      title: typeof jp?.title === 'string' ? jp.title : null,
      description: typeof jp?.description === 'string' ? jp.description : null,
      requirements: (jp?.requirements ?? null) as JobRequirements | null,
    }));
  }

  async submitApplication(input: {
    jobPostingId: number;
    consent: boolean;
    resume: File;
    fullName?: string;
    email?: string;
  }): Promise<PublicApplicationSubmitResponse> {
    const formData = new FormData();
    formData.append('jobPostingId', String(input.jobPostingId));
    formData.append('consent', String(!!input.consent));
    if (input.fullName) formData.append('fullName', input.fullName);
    if (input.email) formData.append('email', input.email);
    formData.append('resume', input.resume);

    return await firstValueFrom(
      this.http.post<PublicApplicationSubmitResponse>('/api/public/applications', formData)
    );
  }

  async getApplicationStatus(token: string): Promise<PublicApplicationStatus> {
    return await firstValueFrom(
      this.http.get<PublicApplicationStatus>(`/api/public/applications/${encodeURIComponent(token)}`)
    );
  }

  async deleteApplication(token: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/public/applications/${encodeURIComponent(token)}`));
  }

  async listHrJobPostings(): Promise<HrJobPosting[]> {
    const params = new HttpParams()
      .set('sort', 'createdAt:desc')
      .set('pagination[pageSize]', '100')
      .set('fields[0]', 'title')
      .set('fields[1]', 'description')
      .set('fields[2]', 'requirements')
      .set('fields[3]', 'status')
      .set('fields[4]', 'createdAt')
      .set('fields[5]', 'documentId');

    const res = await firstValueFrom(this.http.get<unknown>('/api/job-postings', { params }));
    const items = unwrapCollection<any>(res);
    return items.map((jp) => ({
      id: typeof jp.id === 'number' ? jp.id : null,
      documentId: typeof jp.documentId === 'string' ? jp.documentId : null,
      title: typeof jp.title === 'string' ? jp.title : null,
      description: typeof jp.description === 'string' ? jp.description : null,
      requirements: (jp.requirements ?? null) as JobRequirements | null,
      status: typeof jp.status === 'string' ? (jp.status as any) : null,
      createdAt: typeof jp.createdAt === 'string' ? jp.createdAt : null,
    }));
  }

  async createHrJobPosting(input: {
    title: string;
    description: string;
    status: JobPostingStatus;
    requirements?: JobRequirements | null;
  }): Promise<void> {
    await firstValueFrom(this.http.post('/api/job-postings', { data: input }));
  }

  async updateHrJobPostingStatus(entityKeys: string[], status: JobPostingStatus): Promise<void> {
    const paths = entityKeys
      .map((k) => (typeof k === 'string' ? k.trim() : ''))
      .filter(Boolean)
      .map((k) => `/api/job-postings/${encodeURIComponent(k)}`);

    await this.putFirstOk(paths, { data: { status } });
  }

  async deleteHrJobPosting(entityKeys: string[]): Promise<void> {
    const paths = entityKeys
      .map((k) => (typeof k === 'string' ? k.trim() : ''))
      .filter(Boolean)
      .map((k) => `/api/job-postings/${encodeURIComponent(k)}`);

    await this.deleteFirstOk(paths);
  }

  async listHrCandidates(): Promise<HrCandidate[]> {
    const params = new HttpParams()
      .set('sort', 'createdAt:desc')
      .set('pagination[pageSize]', '200')
      .set('fields[0]', 'fullName')
      .set('fields[1]', 'email')
      .set('fields[2]', 'status')
      .set('fields[3]', 'score')
      .set('fields[4]', 'createdAt')
      .set('fields[5]', 'updatedAt')
      .set('fields[6]', 'hrNotes')
      .set('fields[7]', 'extractedData')
      .set('fields[8]', 'documentId')
      .set('populate[0]', 'jobPosting');

    const res = await firstValueFrom(this.http.get<unknown>('/api/candidates', { params }));
    const items = unwrapCollection<any>(res);

    return items.map((c) => {
      const job = unwrapRelation<any>(c.jobPosting);
      const evaluation = c.extractedData?.evaluation ?? null;
      const missing = Array.isArray(evaluation?.missingFields)
        ? evaluation.missingFields
        : Array.isArray(evaluation?.missing)
          ? evaluation.missing
          : [];

      return {
        id: typeof c.id === 'number' ? c.id : Number(c.id),
        documentId: typeof c.documentId === 'string' ? c.documentId : null,
        fullName: typeof c.fullName === 'string' ? c.fullName : null,
        email: typeof c.email === 'string' ? c.email : null,
        status: typeof c.status === 'string' ? c.status : null,
        score: typeof c.score === 'number' ? c.score : c.score ? Number(c.score) : null,
        hrNotes: typeof c.hrNotes === 'string' ? c.hrNotes : null,
        createdAt: typeof c.createdAt === 'string' ? c.createdAt : null,
        updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : null,
        jobTitle: typeof job?.title === 'string' ? job.title : null,
        missing: missing.filter((v: any) => typeof v === 'string'),
      };
    });
  }

  async updateHrCandidate(entityKeys: string[], patch: { status?: string; hrNotes?: string | null; cvTemplateKey?: string }): Promise<void> {
    const paths = entityKeys
      .map((k) => (typeof k === 'string' ? k.trim() : ''))
      .filter(Boolean)
      .map((k) => `/api/candidates/${encodeURIComponent(k)}`);

    await this.putFirstOk(paths, { data: patch });
  }

  async hrReprocessCandidate(id: number): Promise<void> {
    await firstValueFrom(this.http.post(`/api/hr/candidates/${id}/reprocess`, {}));
  }

  async hrDeleteCandidate(id: number): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/hr/candidates/${id}`));
  }

  async getHrCandidate(id: number): Promise<HrCandidateDetail> {
    return await firstValueFrom(this.http.get<HrCandidateDetail>(`/api/hr/candidates/${id}/detail`));
  }

  async listHrCvTemplates(): Promise<CvTemplateMeta[]> {
    const res = await firstValueFrom(this.http.get<any>('/api/hr/cv-templates'));
    const items = Array.isArray(res?.templates) ? res.templates : [];
    return items
      .map((t: any) => ({
        key: typeof t?.key === 'string' ? t.key : '',
        name: typeof t?.name === 'string' ? t.name : '',
        description: typeof t?.description === 'string' ? t.description : '',
      }))
      .filter((t: CvTemplateMeta) => !!t.key && !!t.name);
  }

  async setHrCandidateTemplate(
    keys: { id: number; documentId: string | null },
    templateKey: string
  ): Promise<{ ok: boolean; updatedMarkdown: boolean }> {
    try {
      const res = await firstValueFrom(this.http.patch<any>(`/api/hr/candidates/${keys.id}/template`, { templateKey }));
      return { ok: !!res?.ok, updatedMarkdown: !!res?.updatedMarkdown };
    } catch (e: any) {
      // Fallback for deployments missing the custom HR PATCH route: update via core content API.
      const status = typeof e?.status === 'number' ? e.status : null;
      if (status !== 404) throw e;

      await this.updateHrCandidate([keys.documentId ?? '', String(keys.id)], { cvTemplateKey: templateKey });
      return { ok: true, updatedMarkdown: false };
    }
  }

  async getHrCvTemplateSample(templateKey: string): Promise<{ html: string | null; markdown: string | null }> {
    const tryParse = (res: any) => ({
      html: typeof res?.html === 'string' && res.html.trim() ? res.html : null,
      markdown: typeof res?.markdown === 'string' && res.markdown.trim() ? res.markdown : null,
    });

    try {
      const res = await firstValueFrom(
        this.http.get<any>(`/api/hr/cv-templates/${encodeURIComponent(templateKey)}/sample-html`)
      );
      return tryParse(res);
    } catch {
      // Backward-compatible fallback for older backend builds.
      const res = await firstValueFrom(
        this.http.get<any>(`/api/hr/cv-templates/${encodeURIComponent(templateKey)}/sample-markdown`)
      );
      return tryParse(res);
    }
  }
}
