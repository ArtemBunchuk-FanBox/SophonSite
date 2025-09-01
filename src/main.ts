import { Background } from './components/Background/Background';
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
    this.background = new Background(appContainer, () => {
      // Show company name when animation completes
      this.companyName.show();
    });

    // Add simple keyboard triggers:
    //  - 'w' => wrap back (from UNWRAPPED_IDLE)
    //  - 'u' => unwrap again (from EYE_IDLE)
    document.addEventListener('keydown', this.onKeyDown);
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