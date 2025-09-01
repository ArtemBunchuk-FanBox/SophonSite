import { Background } from './components/Background/Background';
import { CompanyName } from './components/CompanyName';
import './styles/main.css';

class App {
  private background!: Background;
  private companyName!: CompanyName;

  constructor() {
    // Check WebGL support before initializing
    if (!this.checkWebGLSupport()) {
      this.showFallbackMessage();
      return;
    }
    this.init();
  }

  private checkWebGLSupport(): boolean {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      return !!gl;
    } catch (e) {
      return false;
    }
  }

  private showFallbackMessage(): void {
    const appContainer = document.getElementById('app');
    if (!appContainer) return;

    appContainer.innerHTML = `
      <div style="
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: white;
        text-align: center;
        font-family: Arial, sans-serif;
        font-size: 1.2rem;
        line-height: 1.6;
        max-width: 600px;
        padding: 20px;
      ">
        <h1 style="font-size: 2rem; margin-bottom: 20px;">WebGL Not Supported</h1>
        <p>This site requires WebGL to display 3D graphics. Please:</p>
        <ul style="text-align: left; margin: 20px 0;">
          <li>Update your browser to the latest version</li>
          <li>Enable WebGL in your browser settings</li>
          <li>Try a different browser (Chrome, Firefox, Safari, Edge)</li>
        </ul>
      </div>
    `;
  }

  private init(): void {
    console.log('🚀 Initializing Sophon Site...');

    const appContainer = document.getElementById('app');
    if (!appContainer) {
      console.error('❌ App container not found');
      throw new Error('App container not found');
    }

    console.log('✅ App container found');

    try {
      // Initialize CompanyName component first
      console.log('🎯 Initializing CompanyName component...');
      this.companyName = new CompanyName(appContainer);
      console.log('✅ CompanyName component initialized');

      // Initialize Three.js background component with callback
      console.log('🎨 Initializing Background component...');
      this.background = new Background(appContainer, () => {
        console.log('🎬 Background animation complete, showing company name');
        // Show company name when animation completes
        this.companyName.show();
      });
      console.log('✅ Background component initialized');

      // Add simple keyboard triggers:
      //  - 'w' => wrap back (from UNWRAPPED_IDLE)
      //  - 'u' => unwrap again (from EYE_IDLE)
      document.addEventListener('keydown', this.onKeyDown);
      console.log('✅ App initialization complete');

    } catch (error) {
      console.error('❌ Error during component initialization:', error);
      throw error;
    }
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
  try {
    console.log('Initializing app...');
    new App();
    console.log('App initialized successfully');
  } catch (error) {
    console.error('Error initializing app:', error);
    // Show a fallback message
    const appContainer = document.getElementById('app');
    if (appContainer) {
      appContainer.innerHTML = '<div style="color: white; text-align: center; padding: 50px; font-family: Arial;">Error loading application. Please check the console for details.</div>';
    }
  }
});

// Add global error handler
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  // The app instance isn't globally accessible, but Three.js cleanup
  // is handled in the Background component's destroy method
});