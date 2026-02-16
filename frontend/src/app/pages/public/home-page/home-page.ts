import { Component, HostListener, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, type LucideIconData } from 'lucide-angular';
import {
  ArrowRight,
  Award,
  BarChart3,
  Building2,
  CheckCircle,
  Database,
  FileText,
  Globe,
  Mail,
  MapPin,
  Phone,
  Shield,
  Upload,
  Zap,
} from 'lucide-angular/src/icons';
import { RevealOnScrollDirective } from '../../../shared/animations/reveal-on-scroll.directive';

type FeatureItem = {
  icon: LucideIconData;
  title: string;
  description: string;
};

type StatItem = {
  value: string;
  label: string;
};

@Component({
  selector: 'app-home-page',
  imports: [RouterLink, LucideAngularModule, RevealOnScrollDirective],
  templateUrl: './home-page.html',
  styleUrl: './home-page.css',
})
export class HomePage {
  readonly scrollY = signal(0);
  readonly activeFeature = signal(0);

  readonly iconUpload: LucideIconData = Upload;
  readonly iconDatabase: LucideIconData = Database;
  readonly iconShield: LucideIconData = Shield;
  readonly iconBarChart3: LucideIconData = BarChart3;
  readonly iconZap: LucideIconData = Zap;
  readonly iconMapPin: LucideIconData = MapPin;
  readonly iconBuilding2: LucideIconData = Building2;
  readonly iconAward: LucideIconData = Award;
  readonly iconArrowRight: LucideIconData = ArrowRight;
  readonly iconCheckCircle: LucideIconData = CheckCircle;
  readonly iconGlobe: LucideIconData = Globe;
  readonly iconMail: LucideIconData = Mail;
  readonly iconPhone: LucideIconData = Phone;

  readonly features: FeatureItem[] = [
    {
      icon: Upload,
      title: 'Easy CV Upload',
      description: 'Candidates submit CVs directly with optional pre-filling forms.',
    },
    {
      icon: Database,
      title: 'Automatic Parsing',
      description: 'Extract and structure name, contact, education, and experience data automatically.',
    },
    {
      icon: FileText,
      title: 'Template Generation',
      description: 'Generate standardized company CV templates for all parsed profiles.',
    },
    {
      icon: BarChart3,
      title: 'Automated Assessment',
      description: 'Score applications by completeness and fit for the open position.',
    },
    {
      icon: Zap,
      title: 'Compatibility Matching',
      description: 'Match candidate profiles against job requirements automatically.',
    },
    {
      icon: Shield,
      title: 'GDPR Compliant',
      description: 'Secure storage and role-based CV view and download controls.',
    },
  ];

  readonly stats: StatItem[] = [
    { value: '500+', label: 'CVs Processed' },
    { value: '95%', label: 'Parsing Accuracy' },
    { value: '60%', label: 'Time Saved' },
    { value: '24/7', label: 'Availability' },
  ];

  readonly expertise: string[] = [
    'Software Development',
    'AI and Machine Learning',
    'Cloud Solutions',
    'Digital Transformation',
  ];
  readonly productName = 'ioHire';
  readonly companyName = 'iOvision';
  readonly companyLocation = 'Sfax, Tunisia';

  @HostListener('window:scroll')
  onScroll() {
    if (typeof window === 'undefined') return;
    this.scrollY.set(window.scrollY);
  }

  setActiveFeature(index: number) {
    this.activeFeature.set(index);
  }
}
