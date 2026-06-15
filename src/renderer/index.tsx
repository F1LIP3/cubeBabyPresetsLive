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
        <div style={{
          padding: '20px',
          fontFamily: 'sans-serif',
          textAlign: 'center',
          color: '#333',
          background: '#f5f5f5',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div>
            <h1 style={{ color: '#e74c3c' }}>Something went wrong</h1>
            <p>The app encountered an error and couldn't continue.</p>
            <details style={{ textAlign: 'left', marginTop: '20px', background: '#fff', padding: '15px', borderRadius: '8px' }}>
              <summary>Debug info</summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: '12px', marginTop: '10px' }}>
                {this.state.error?.message}
{this.state.error?.stack}
              </pre>
            </details>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: '20px',
                padding: '10px 20px',
                background: '#3498db',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
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