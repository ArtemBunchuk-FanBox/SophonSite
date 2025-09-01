import { MissionStatement } from './MissionStatement';

export class MissionStatementMobile extends MissionStatement {
    protected create() {
        super.create();
        // Adjust any mobile-specific styles by injecting a small style tag once
        const styleId = 'mission-mobile-style';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                        @media (max-width: 768px) {
                            .mission-card { padding: 16px 14px; border-radius: 10px; background: transparent; backdrop-filter: none; box-shadow: none; }
                            .mission-text { font-size: 2rem; line-height: 1.25; letter-spacing: 0.2rem; text-align: center; }
                        }
                    `;
            document.head.appendChild(style);
        }
    }
}
