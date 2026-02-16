import { AfterViewInit, Directive, ElementRef, Input, OnDestroy, Renderer2 } from '@angular/core';

@Directive({
  selector: '[appRevealOnScroll]',
})
export class RevealOnScrollDirective implements AfterViewInit, OnDestroy {
  @Input() revealDelay = 0;

  private observer: IntersectionObserver | null = null;

  constructor(
    private readonly el: ElementRef<HTMLElement>,
    private readonly renderer: Renderer2
  ) {}

  ngAfterViewInit(): void {
    const node = this.el.nativeElement;
    this.renderer.addClass(node, 'reveal');
    if (this.revealDelay > 0) {
      this.renderer.setStyle(node, '--reveal-delay', `${this.revealDelay}ms`);
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.renderer.addClass(node, 'reveal--visible');
          this.observer?.unobserve(node);
        }
      },
      { threshold: 0.2 }
    );

    this.observer.observe(node);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}
