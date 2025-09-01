export class CompanyName {
    private container: HTMLElement;
    private element: HTMLDivElement | null = null;
    private visible = false;
    private animationProgress = 0;
    private typewriterProgress = 0;
    private animationId: number | null = null;

    private companyName = "SOPHON SYSTEMS";
    private currentText = "";
    // Replace single-line spans with two-line structure and per-line cursors
    private line1Text = "SOPHON";
    private line2Text = "SYSTEMS";
    private line1Wrap: HTMLDivElement | null = null;
    private line2Wrap: HTMLDivElement | null = null;
    private line1Span: HTMLSpanElement | null = null;
    private line2Span: HTMLSpanElement | null = null;
    private cursor1Span: HTMLSpanElement | null = null;
    private cursor2Span: HTMLSpanElement | null = null;

    // Subtitle (stage text) under the eye
    private subtitleEl: HTMLDivElement | null = null;
    private subtitleAnimId: number | null = null;
    private subtitleText = '';
    private subtitleState: 'idle' | 'typing' | 'backspacing' = 'idle';
    private onStageType?: (e: Event) => void;
    private onStageBackspace?: (e: Event) => void;

    private static readonly SHIMMER_INTERVAL_MS = 10000; // pulse every n seconds (default 10s)
    private static readonly SHIMMER_CYCLE_MS = 4000;      // bright pulse duration (9s)
    private static readonly SHIMMER_FIRST_DELAY_MS = 5000; // first pulse after dim + short hold
    // New: full base glow and fade duration
    private static readonly BASE_GLOW_SHADOW = `0 0 10px #ffffff, 0 0 20px #e6f6ff, 0 0 30px #9edfff, 0 0 40px #9edfff`;
    private static readonly GLOW_FADE_MS = 1000;
    // New: cap how bright the pulse can get
    private static readonly MAX_PULSE_INTENSITY = 0.65;
    // New: baseline dim and initial dim fade
    private static readonly DIM_INTENSITY = 0.3; // stay dim between pulses
    private static readonly DIM_FADE_MS = 3000;  // slow initial dim
    private shimmerActive = false;
    private shimmerStartTime = 0;
    private lastShimmerTime = 0;
    // New: track when dimming started
    private pulseInitTime = 0;

    constructor(container: HTMLElement) {
        this.container = container;
        this.createElement();
    }

    private createElement(): void {
        this.element = document.createElement('div');
        this.element.className = 'company-name';
        this.element.style.cssText = `
            position: absolute;
      top: var(--hero-center);
      left: 50%;
      transform: translate(-50%, -50%);
      font-family: 'Arial', sans-serif;
      font-size: 4rem;
      font-weight: 300;
      letter-spacing: 0.5rem;
      text-align: center;           /* center lines inside fixed-width container */
      line-height: 1.15;
      z-index: 1000;
      opacity: 0;
      pointer-events: none;
      text-shadow: 
        0 0 10px #ffffff,
        0 0 20px #e6f6ff,
        0 0 30px #9edfff,
        0 0 40px #9edfff;
      color: #ffffff;
      text-transform: uppercase;
      transition: opacity 0.5s ease-in-out;
      user-select: none;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
    `;

        // Add responsive CSS via a one-time injected style tag
        const styleId = 'company-name-responsive-style';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                            @media (max-width: 768px) {
                                .company-name {
                                    font-size: 2.75rem !important;
                                    letter-spacing: 0.35rem !important;
                                    max-width: 95vw !important;
                                    line-height: 1.1 !important;
                                }
                                .company-subtitle {
                                    font-size: 1rem !important;
                                    letter-spacing: 0.25rem !important;
                                    top: calc(var(--hero-center) + 84px) !important;
                                    max-width: 95vw !important;
                                    text-align: center !important;
                                }
                            }
                        `;
            document.head.appendChild(style);
        }

        // Build two-line structure
        this.line1Wrap = document.createElement('div');
        this.line2Wrap = document.createElement('div');
        this.line1Wrap.style.cssText = `position: relative; width: 100%;`;
        this.line2Wrap.style.cssText = `position: relative; width: 100%;`;

        this.line1Span = document.createElement('span');
        this.line2Span = document.createElement('span');
        this.line1Span.style.cssText = `display: inline-block;`;
        this.line2Span.style.cssText = `display: inline-block;`;

        this.cursor1Span = document.createElement('span');
        this.cursor2Span = document.createElement('span');
        this.cursor1Span.textContent = '|';
        this.cursor2Span.textContent = '|';
        const cursorCss = `
      position: absolute;
      top: 0;
      left: 0;
      opacity: 0;
      color: inherit;
      text-shadow: inherit;
    `;
        this.cursor1Span.style.cssText = cursorCss;
        this.cursor2Span.style.cssText = cursorCss;

        this.line1Wrap.appendChild(this.line1Span);
        this.line1Wrap.appendChild(this.cursor1Span);
        this.line2Wrap.appendChild(this.line2Span);
        this.line2Wrap.appendChild(this.cursor2Span);
        this.element.appendChild(this.line1Wrap);
        this.element.appendChild(this.line2Wrap);
        this.container.appendChild(this.element);

        // Lock container width to the widest final line to prevent reflow/jumps
        this.element.style.visibility = 'hidden';
        this.line1Span.textContent = this.line1Text;
        this.line2Span.textContent = this.line2Text;
        const w1 = this.line1Span.offsetWidth;
        const w2 = this.line2Span.offsetWidth;
        const maxW = Math.max(w1, w2);
        this.element.style.width = `${Math.ceil(maxW)}px`;
        // Reset for animation
        this.line1Span.textContent = '';
        this.line2Span.textContent = '';
        this.element.style.visibility = 'visible';

        // Subtitle element centered under the eye/company
        this.subtitleEl = document.createElement('div');
        this.subtitleEl.className = 'company-subtitle';
        this.subtitleEl.style.cssText = `
            position: absolute;
      top: calc(var(--hero-center) + 120px);
          left: 50%;
          transform: translateX(-50%);
          font-family: 'Arial', sans-serif;
          font-size: 1.25rem;
          font-weight: 300;
          letter-spacing: 0.35rem;
          color: #ffffff;
          opacity: 0;
          pointer-events: none;
          text-transform: uppercase;
          text-shadow:
            0 0 6px #ffffff,
            0 0 12px #e6f6ff,
            0 0 18px #9edfff;
          z-index: 1000;
          transition: opacity 0.25s ease;
          user-select: none;
          -webkit-user-select: none;
        `;
        this.container.appendChild(this.subtitleEl);

        // Listen for stage text control events
        this.onStageType = (e: Event) => {
            const detail = (e as CustomEvent).detail || {};
            const text = (detail.text ?? '').toString();
            this.typeSubtitle(text);
        };
        this.onStageBackspace = () => this.backspaceSubtitle();
        window.addEventListener('stageTextType', this.onStageType as EventListener);
        window.addEventListener('stageTextBackspace', this.onStageBackspace as EventListener);
    }

    // Type subtitle with simple typewriter effect
    private typeSubtitle(text: string) {
        if (!this.subtitleEl) return;
        const target = (text || '').toUpperCase();
        // Cancel any ongoing animation
        if (this.subtitleAnimId) { cancelAnimationFrame(this.subtitleAnimId); this.subtitleAnimId = null; }
        this.subtitleState = 'typing';
        this.subtitleText = '';
        this.subtitleEl.textContent = '';
        this.subtitleEl.style.opacity = '1';

        const perCharMs = 70;
        const start = performance.now();
        const len = target.length;

        const step = (now: number) => {
            if (this.subtitleState !== 'typing') return;
            const typed = Math.min(len, Math.floor((now - start) / perCharMs));
            if (typed !== this.subtitleText.length) {
                this.subtitleText = target.substring(0, typed);
                this.subtitleEl!.textContent = this.subtitleText;
            }
            if (typed < len) {
                this.subtitleAnimId = requestAnimationFrame(step);
            } else {
                this.subtitleAnimId = null;
                this.subtitleState = 'idle';
            }
        };
        this.subtitleAnimId = requestAnimationFrame(step);
    }

    // Backspace subtitle
    private backspaceSubtitle() {
        if (!this.subtitleEl) return;
        if (this.subtitleAnimId) { cancelAnimationFrame(this.subtitleAnimId); this.subtitleAnimId = null; }
        this.subtitleState = 'backspacing';
        const perCharMs = 50;
        const startLen = this.subtitleText.length;
        const start = performance.now();

        const step = (now: number) => {
            if (this.subtitleState !== 'backspacing') return;
            const gone = Math.min(startLen, Math.floor((now - start) / perCharMs));
            const remain = Math.max(0, startLen - gone);
            if (remain !== this.subtitleText.length) {
                this.subtitleText = this.subtitleText.substring(0, remain);
                this.subtitleEl!.textContent = this.subtitleText;
            }
            if (remain > 0) {
                this.subtitleAnimId = requestAnimationFrame(step);
            } else {
                this.subtitleAnimId = null;
                this.subtitleState = 'idle';
                this.subtitleEl!.style.opacity = '0';
            }
        };
        this.subtitleAnimId = requestAnimationFrame(step);
    }

    public show(): void {
        if (!this.element || this.visible) return;

        console.log('CompanyName.show() called');
        this.visible = true;
        this.animationProgress = 0;
        this.typewriterProgress = 0;
        this.currentText = "";
        this.startTypewriterAnimation();
    }

    public hide(): void {
        if (!this.element || !this.visible) return;

        this.visible = false;
        // Notify background that typing visual should stop (in case we hide mid-typing)
        try { window.dispatchEvent(new CustomEvent('companyNameTypingEnd')); } catch { }
        // Notify background that the name is hidden -> stop persistent glow
        try { window.dispatchEvent(new CustomEvent('companyNameHidden')); } catch { }
        this.element.style.opacity = '0';
        if (this.line1Span) this.line1Span.textContent = '';
        if (this.line2Span) this.line2Span.textContent = '';
        if (this.cursor1Span) this.cursor1Span.style.opacity = '0';
        if (this.cursor2Span) this.cursor2Span.style.opacity = '0';

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.subtitleAnimId) { cancelAnimationFrame(this.subtitleAnimId); this.subtitleAnimId = null; }
        if (this.subtitleEl) { this.subtitleEl.style.opacity = '0'; this.subtitleEl.textContent = ''; this.subtitleText = ''; }
    }

    private startTypewriterAnimation(): void {
        if (!this.element || !this.line1Span || !this.line2Span || !this.cursor1Span || !this.cursor2Span || !this.line1Wrap || !this.line2Wrap) return;

        // Ensure we start with the full glow each time
        this.element.style.textShadow = CompanyName.BASE_GLOW_SHADOW;
        // Notify background: typing has started -> show bright gore outlines
        try { window.dispatchEvent(new CustomEvent('companyNameTypingStart')); } catch { }

        const duration = 2000; // 2 seconds total
        const startTime = performance.now();
        const len1 = this.line1Text.length;
        const len2 = this.line2Text.length;
        const total = len1 + len2;

        const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const typed = Math.floor(progress * total);

            // Characters per line
            const l1 = Math.min(typed, len1);
            const l2 = Math.max(0, typed - len1);

            this.line1Span!.textContent = this.line1Text.substring(0, l1);
            this.line2Span!.textContent = this.line2Text.substring(0, l2);

            // Fade in once typing starts
            if (progress > 0.1) this.element!.style.opacity = '1';

            // Blink cursor
            const showCursor = progress < 1 && Math.floor(elapsed / 500) % 2 === 0;
            // Position cursors after the current text, centered inside each line wrapper
            const placeCursor = (wrap: HTMLDivElement, textSpan: HTMLSpanElement, cursor: HTMLSpanElement) => {
                const wrapW = wrap.clientWidth;
                const textW = textSpan.offsetWidth;
                const left = (wrapW - textW) / 2 + textW;
                cursor.style.left = `${left}px`;
            };

            if (typed < len1) {
                // Typing first line
                this.cursor1Span!.style.opacity = showCursor ? '1' : '0';
                this.cursor2Span!.style.opacity = '0';
                placeCursor(this.line1Wrap!, this.line1Span!, this.cursor1Span!);
            } else if (typed < total) {
                // Typing second line
                this.cursor1Span!.style.opacity = '0';
                this.cursor2Span!.style.opacity = showCursor ? '1' : '0';
                placeCursor(this.line2Wrap!, this.line2Span!, this.cursor2Span!);
            } else {
                // Done
                this.cursor1Span!.style.opacity = '0';
                this.cursor2Span!.style.opacity = '0';
            }

            // Broadcast typing progress 0..1
            try {
                window.dispatchEvent(new CustomEvent('companyNameTypingProgress', { detail: { progress } }));
            } catch { }

            if (progress < 1 && this.visible) {
                this.animationId = requestAnimationFrame(animate);
            } else {
                // Finish: show full text, then enter dim baseline + periodic bright pulse
                this.line1Span!.textContent = this.line1Text;
                this.line2Span!.textContent = this.line2Text;
                this.cursor1Span!.style.opacity = '0';
                this.cursor2Span!.style.opacity = '0';
                this.element!.style.textShadow = CompanyName.BASE_GLOW_SHADOW; // will quickly dim next
                // Notify background: typing finished (keep glow persistent)
                try { window.dispatchEvent(new CustomEvent('companyNameTypingFinished')); } catch { }
                // Notify background: typing finished -> remove bright gore outlines
                try { window.dispatchEvent(new CustomEvent('companyNameTypingEnd')); } catch { }
                this.startPulseAnimation();
            }
        };

        this.animationId = requestAnimationFrame(animate);
    }

    private startPulseAnimation(): void {
        if (!this.element) return;

        // Initialize timing: start dim fade now, schedule the first bright pulse soon
        const now = performance.now();
        this.pulseInitTime = now;
        this.shimmerActive = false;
        this.shimmerStartTime = 0;
        this.lastShimmerTime = now - (CompanyName.SHIMMER_INTERVAL_MS - CompanyName.SHIMMER_FIRST_DELAY_MS);

        const animate = (currentTime: number) => {
            if (!this.visible || !this.element) return;

            let currentIntensity = CompanyName.DIM_INTENSITY;

            // Phase 1: quick fade from full to dim baseline
            const sinceInit = currentTime - this.pulseInitTime;
            if (sinceInit < CompanyName.DIM_FADE_MS) {
                const t = Math.min(1, sinceInit / CompanyName.DIM_FADE_MS);
                const smooth = t * t * (3 - 2 * t); // smoothstep
                currentIntensity = 1 - (1 - CompanyName.DIM_INTENSITY) * smooth;
                this.applyGlowIntensity(currentIntensity);
                // Broadcast current glow intensity
                try { window.dispatchEvent(new CustomEvent('companyNameGlow', { detail: { intensity: currentIntensity } })); } catch { }
                this.animationId = requestAnimationFrame(animate);
                return;
            }

            // Phase 2: periodic bright pulse
            if (!this.shimmerActive && (currentTime - this.lastShimmerTime >= CompanyName.SHIMMER_INTERVAL_MS)) {
                this.shimmerActive = true;
                this.shimmerStartTime = currentTime;
            }

            if (this.shimmerActive) {
                const t = Math.min(1, (currentTime - this.shimmerStartTime) / CompanyName.SHIMMER_CYCLE_MS);
                const s = Math.sin(Math.PI * t); // 0 -> 1 -> 0
                const maxI = CompanyName.MAX_PULSE_INTENSITY;
                currentIntensity = CompanyName.DIM_INTENSITY + (maxI - CompanyName.DIM_INTENSITY) * s;
                this.applyGlowIntensity(currentIntensity);

                if (t >= 1) {
                    this.shimmerActive = false;
                    this.lastShimmerTime = currentTime;
                    currentIntensity = CompanyName.DIM_INTENSITY;
                    this.applyGlowIntensity(currentIntensity);
                }
            } else {
                // Dim hold between pulses
                currentIntensity = CompanyName.DIM_INTENSITY;
                this.applyGlowIntensity(currentIntensity);
            }

            // Broadcast current glow intensity
            try { window.dispatchEvent(new CustomEvent('companyNameGlow', { detail: { intensity: currentIntensity } })); } catch { }

            this.animationId = requestAnimationFrame(animate);
        };

        this.animationId = requestAnimationFrame(animate);
    }

    // Apply glow intensity 0..1 using the same colors as the base glow
    private applyGlowIntensity(intensity: number): void {
        if (!this.element) return;
        const i = Math.max(0, Math.min(1, intensity));
        if (i <= 0) {
            this.element.style.textShadow = 'none';
            return;
        }
        this.element.style.textShadow = `
          0 0 10px rgba(255, 255, 255, ${i}),
          0 0 20px rgba(230, 246, 255, ${i}),
          0 0 30px rgba(158, 223, 255, ${i}),
          0 0 40px rgba(158, 223, 255, ${i})
        `;
    }

    public destroy(): void {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.onStageType) window.removeEventListener('stageTextType', this.onStageType as EventListener);
        if (this.onStageBackspace) window.removeEventListener('stageTextBackspace', this.onStageBackspace as EventListener);
        if (this.element) {
            this.element.remove();
            this.element = null;
        }
        if (this.subtitleEl) {
            this.subtitleEl.remove();
            this.subtitleEl = null;
        }
    }
}