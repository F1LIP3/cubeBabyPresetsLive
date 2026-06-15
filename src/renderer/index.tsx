import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './App.css';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <h1 className="error-boundary-heading">Something went wrong</h1>
            <p className="error-boundary-text">The app encountered an error and couldn't continue.</p>
            <details className="error-boundary-details">
              <summary>Debug info</summary>
              <pre className="error-boundary-stack">
                {this.state.error?.message}
{this.state.error?.stack}
              </pre>
            </details>
            <button className="error-boundary-reload" onClick={() => window.location.reload()}>
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return <React.StrictMode>{this.props.children}</React.StrictMode>;
  }
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<ErrorBoundary><App /></ErrorBoundary>);