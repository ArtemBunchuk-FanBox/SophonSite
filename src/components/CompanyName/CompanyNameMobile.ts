import { CompanyName } from './CompanyName';

export class CompanyNameMobile extends CompanyName {
    private mobileCompanyFontSizeHandler?: (e: Event) => void;
    private mobileTitleFontSizeHandler?: (e: Event) => void;

    constructor(container: HTMLElement) {
        super(container);

        // Initialize mobile font size event listeners
        this.setupMobileFontListeners();
    }

    private setupMobileFontListeners(): void {
        // Handler for company name font size event
        this.mobileCompanyFontSizeHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (!detail || !detail.fontSize) return;

            const fontSize = detail.fontSize;
            const letterSpacingRatio = detail.letterSpacingRatio || 0.125;

            // Apply font size to main element - use DOM selectors since base properties are private
            const element = document.querySelector('.company-name') as HTMLElement;
            if (element) {
                element.style.fontSize = `${fontSize}px`;
                element.style.letterSpacing = `${fontSize * letterSpacingRatio}px`;
            }
        };

        // Handler for subtitle/stage text font size event
        this.mobileTitleFontSizeHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (!detail || !detail.fontSize) return;

            const fontSize = detail.fontSize;
            const letterSpacingRatio = detail.letterSpacingRatio || 0.125;

            // Apply font size to subtitle element - use DOM selectors since base properties are private
            const subtitleEl = document.querySelector('.company-subtitle') as HTMLElement;
            if (subtitleEl) {
                subtitleEl.style.fontSize = `${fontSize}px`;
                subtitleEl.style.letterSpacing = `${fontSize * letterSpacingRatio}px`;

                // Adjust subtitle position based on main font size
                // Position subtitle at a distance proportional to the font size
                // Original: top: calc(50% + 120px)
                subtitleEl.style.top = `calc(50% + ${fontSize * 3}px)`;
            }
        };

        // Add event listeners
        window.addEventListener('mobileCompanyFontSize', this.mobileCompanyFontSizeHandler as EventListener);
        window.addEventListener('mobileTitleFontSize', this.mobileTitleFontSizeHandler as EventListener);
    }

    public destroy(): void {
        // Clean up mobile-specific event listeners
        if (this.mobileCompanyFontSizeHandler) {
            window.removeEventListener('mobileCompanyFontSize', this.mobileCompanyFontSizeHandler as EventListener);
        }

        if (this.mobileTitleFontSizeHandler) {
            window.removeEventListener('mobileTitleFontSize', this.mobileTitleFontSizeHandler as EventListener);
        }

        // Call parent destroy
        super.destroy();
    }
}
