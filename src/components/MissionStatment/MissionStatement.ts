export class MissionStatement {
    protected container: HTMLElement;
    protected root: HTMLDivElement | null = null;
    protected spacer: HTMLDivElement | null = null;
    protected visible = false;
    protected asHeroSection = false;
    protected textEl: HTMLParagraphElement | null = null;
    private onScrollBound?: () => void;
    private rafScheduled = false;

    constructor(container: HTMLElement, asHeroSection = false) {
        this.container = container;
        this.asHeroSection = asHeroSection;
        this.create();
    }

    protected create() {
        // Spacer to push mission below the initial hero view when not embedded in hero
        if (!this.asHeroSection) {
            this.spacer = document.createElement('div');
            this.spacer.className = 'hero-spacer';
            this.spacer.style.cssText = `
                    width: 100%;
                    height: 100vh; /* one full screen */
                    pointer-events: none;
                `;
        }

        // Mission section card
        this.root = document.createElement('div');
        this.root.className = 'mission-section';
        this.root.setAttribute('aria-hidden', 'true');
        this.root.style.cssText = `
            opacity: 0;
            transform: translateY(24px);
            transition: opacity 800ms ease, transform 800ms ease;
        `;

        const inner = document.createElement('div');
        inner.className = 'mission-card';

        const p = document.createElement('p');
        p.className = 'mission-text';
        p.innerHTML = `Our systems deliver <span class="highlight">intelligence</span> that drives fast and impactful decisions across industries, from campaign strategy to creative greenlighting.`;
        this.textEl = p;

        inner.appendChild(p);
        this.root.appendChild(inner);
        // Append after spacer, both will be added when we show()
    }

    public show() {
        if (!this.root || this.visible) return;
        this.visible = true;
        if (this.spacer && !this.spacer.isConnected) this.container.appendChild(this.spacer);
        if (!this.root.isConnected) this.container.appendChild(this.root);
        // Defer to allow styles to apply before transition
        requestAnimationFrame(() => {
            if (!this.root) return;
            this.root.style.opacity = '1';
            this.root.style.transform = 'translateY(0)';
            this.root.setAttribute('aria-hidden', 'false');
            // Start scroll-based micro animations
            this.attachScrollEffects();
            this.applyScrollEffects();
        });
    }

    public hide() {
        if (!this.root || !this.visible) return;
        this.visible = false;
        this.root.style.opacity = '0';
        this.root.style.transform = 'translateY(24px)';
        this.root.setAttribute('aria-hidden', 'true');
    }

    public destroy() {
        if (this.root) {
            this.root.remove();
            this.root = null;
        }
        if (this.spacer) {
            this.spacer.remove();
            this.spacer = null;
        }
        this.detachScrollEffects();
    }

    // Attach scroll listener to create subtle motion/opacity/line-height effects
    private attachScrollEffects() {
        if (this.onScrollBound) return;
        this.onScrollBound = () => {
            if (this.rafScheduled) return;
            this.rafScheduled = true;
            requestAnimationFrame(() => {
                this.rafScheduled = false;
                this.applyScrollEffects();
            });
        };
        window.addEventListener('scroll', this.onScrollBound, { passive: true });
        window.addEventListener('resize', this.onScrollBound, { passive: true });
    }

    private detachScrollEffects() {
        if (this.onScrollBound) {
            window.removeEventListener('scroll', this.onScrollBound);
            window.removeEventListener('resize', this.onScrollBound);
            this.onScrollBound = undefined;
        }
    }

    private applyScrollEffects() {
        if (!this.root || !this.textEl) return;
        const rect = this.root.getBoundingClientRect();
        const vh = Math.max(1, window.innerHeight);
        // Distance of section center to viewport center (normalized ~[-1,1])
        const center = rect.top + rect.height / 2;
        const norm = (center - vh / 2) / (vh / 2);
        // Subtle vertical translation (px)
        const maxDY = 1.25; // px, very subtle motion
        const dy = Math.max(-maxDY, Math.min(maxDY, -norm * maxDY));
        // Subtle opacity change (close to 1)
        const opacity = 0.992 + 0.008 * (1 - Math.min(1, Math.abs(norm)));
        // Subtle line-height modulation around base
        const baseLH = 1.08; // match CSS baseline
        const lh = baseLH - 0.02 * Math.min(1, Math.abs(norm));

        this.textEl.style.transform = `translate3d(0, ${dy.toFixed(3)}px, 0)`;
        this.textEl.style.opacity = opacity.toFixed(4);
        this.textEl.style.lineHeight = lh.toFixed(4);
    }
}
