import { Background } from './components/Background/Background';
import { BackgroundMobile } from './components/Background/BackgroundMobile';
import { CompanyName } from './components/CompanyName/CompanyName';
import './styles/main.css';

class App {
  private background!: Background;
  private companyName!: CompanyName;

  constructor() {
    this.init();
  }

  private init(): void {
    const appContainer = document.getElementById('app');
    if (!appContainer) {
      throw new Error('App container not found');
    }

    // Initialize CompanyName component first
    this.companyName = new CompanyName(appContainer);

    // Initialize Three.js background component with callback
    const useMobile = this.detectMobile();
    this.background = (useMobile
      ? new BackgroundMobile(appContainer, () => {
        this.companyName.show();
      })
      : new Background(appContainer, () => {
        this.companyName.show();
      })) as Background;
    console.log('Background mode:', useMobile ? 'mobile' : 'desktop');

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