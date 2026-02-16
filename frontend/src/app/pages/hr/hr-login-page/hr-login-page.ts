import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { setHrJwt } from '../../../core/auth/auth.storage';
import { toErrorMessage } from '../../../core/http/http-error';
import { StrapiApi } from '../../../core/strapi/strapi.api';
import { Footer } from '../../../shared/footer/footer';
import { Topbar } from '../../../shared/topbar/topbar';

@Component({
  selector: 'app-hr-login-page',
  imports: [ReactiveFormsModule, Topbar, Footer],
  templateUrl: './hr-login-page.html',
})
export class HrLoginPage {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(StrapiApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  async save() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    try {
      const email = this.form.controls.email.value.trim();
      const password = this.form.controls.password.value;
      const { jwt } = await this.api.loginHr({ email, password });
      setHrJwt(jwt);
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/admin';
      await this.router.navigateByUrl(returnUrl);
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
