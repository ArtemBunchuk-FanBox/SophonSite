import { Background } from './components/Hero/SophonAnimation/SophonAnimation';
import { BackgroundMobile } from './components/Hero/SophonAnimation/SophonAnimationMobile';
import { CompanyName } from './components/Hero/CompanyName/CompanyName';
import { CompanyNameMobile } from './components/Hero/CompanyName/CompanyNameMobile';
import { MissionStatement } from './components/MissionStatment/MissionStatement';
import { MissionStatementMobile } from './components/MissionStatment/MissionStatementMobile';
import './styles/main.css';

class App {
  private background!: Background;
  private companyName!: CompanyName;
  private mission!: MissionStatement;

  constructor() {
    this.init();
  }

  private init(): void {
    const appContainer = document.getElementById('app');
    if (!appContainer) {
      throw new Error('App container not found');
    }

    // Detect if mobile device
    const useMobile = this.detectMobile();
    console.log('Device mode:', useMobile ? 'mobile' : 'desktop');

    // Create Hero section container
    const hero = document.createElement('section');
    hero.className = 'hero';
    appContainer.appendChild(hero);

    // Create Mission section container (separate section under the hero)
    const missionSection = document.createElement('section');
    missionSection.className = 'mission';
    appContainer.appendChild(missionSection);

    // Initialize CompanyName inside Hero - use mobile version if on mobile device
    this.companyName = useMobile
      ? new CompanyNameMobile(hero)
      : new CompanyName(hero);

    // Initialize Mission Statement in its own section (no hero spacer)
    this.mission = useMobile
      ? new MissionStatementMobile(missionSection, true)
      : new MissionStatement(missionSection, true);

    // Initialize Three.js background component with callback
    // Reveal mission once company name finishes typing
    const onNameFinished = () => {
      // Small delay so mission appears slightly after the name reveal
      const delay = 800; // ms
      setTimeout(() => {
        this.mission.show();
      }, delay);
      window.removeEventListener('companyNameTypingFinished', onNameFinished as EventListener);
    };
    window.addEventListener('companyNameTypingFinished', onNameFinished as EventListener);

    this.background = (useMobile
      ? new BackgroundMobile(hero, () => {
        this.companyName.show();
        // Allow vertical scrolling only after hero animation completes
        document.body.style.overflowY = 'auto';
        document.body.style.overflowX = 'hidden';
      })
      : new Background(hero, () => {
        this.companyName.show();
        // Allow vertical scrolling only after hero animation completes
        document.body.style.overflowY = 'auto';
        document.body.style.overflowX = 'hidden';
      })) as Background;

    // Add simple keyboard triggers:
    //  - 'w' => wrap back (from UNWRAPPED_IDLE)
    //  - 'u' => unwrap again (from EYE_IDLE)
    document.addEventListener('keydown', this.onKeyDown);
  }

  private detectMobile(): boolean {
    const isTouch = 'ontouchstart' in window || (navigator as any).maxTouchPoints > 0;
    const smallScreen = Math.min(window.innerWidth, window.innerHeight) <= 768;
    const ua = navigator.userAgent || (navigator as any).vendor || (window as any).opera || '';
    const isUA = /android|iphone|ipad|ipod|mobile|silk|kindle|blackberry|bb|opera mini|windows phone/i.test(ua);
    return (isTouch && smallScreen) || isUA;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === 'w') this.background?.startWrap();
    if (k === 'u') this.background?.startUnwrap();
  };

  public destroy(): void {
    if (this.background) {
      this.background.destroy();
    }
    if (this.companyName) {
      this.companyName.destroy();
    }
    if (this.mission) {
      this.mission.destroy();
    }
    // Clean any potential lingering listener
    try { window.removeEventListener('companyNameTypingFinished', (this as any).onNameFinished as EventListener); } catch { }
    document.removeEventListener('keydown', this.onKeyDown);
  }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('App initializing...'); // Test hot reload
  new App();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  // The app instance isn't globally accessible, but Three.js cleanup
  // is handled in the Background component's destroy method
});