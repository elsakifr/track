import { CONTRACT_VERSION } from '@track/shared';

// M0 placeholder. Race page, runner search and live map arrive in M2 (docs/roadmap.md).
export function App() {
  return (
    <main className="placeholder">
      <h1>Track</h1>
      <p>Real-time tracking for endurance events.</p>
      <p className="meta">Spectator app scaffold · contract v{CONTRACT_VERSION}</p>
    </main>
  );
}
