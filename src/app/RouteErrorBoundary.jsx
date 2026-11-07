import { Component } from 'react';
import { navigateTo } from './useRoute.js';
import { PageShell } from '../components/layout/PageShell.jsx';
import { Button } from '../components/ui/Button.jsx';
import { getRouteErrorMessage, isChunkLoadError } from './routeError.js';

export class RouteErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) console.error('CBoard route render failed', error, info.componentStack);
  }

  retry = () => {
    if (isChunkLoadError(this.state.error)) {
      window.location.reload();
      return;
    }
    this.setState({ error: null });
  };

  reloadApp = () => window.location.reload();

  goToBoard = () => navigateTo('/board');

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <PageShell>
        <section className="panel m-6 p-6" role="alert" aria-labelledby="route-error-title">
          <h1 id="route-error-title" className="text-2xl font-bold text-[var(--color-text)]">This section could not load.</h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-[var(--color-text-secondary)]">
            {getRouteErrorMessage(error, import.meta.env.DEV)}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="primary" onClick={this.retry}>Try again</Button>
            <Button onClick={this.reloadApp}>Reload app</Button>
            <Button onClick={this.goToBoard}>Go to CBoard</Button>
          </div>
        </section>
      </PageShell>
    );
  }
}
