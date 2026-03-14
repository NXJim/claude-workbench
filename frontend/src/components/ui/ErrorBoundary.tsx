/**
 * Error boundary — UI-STANDARDS Section 2.2
 */

import React from 'react';

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleCopyError = () => {
    const { error } = this.state;
    if (!error) return;
    const details = [
      `Error: ${error.message}`,
      `Page: ${window.location.href}`,
      `Referrer: ${document.referrer}`,
      `Time: ${new Date().toISOString()}`,
      `User-Agent: ${navigator.userAgent}`,
      `Stack trace: ${error.stack || 'N/A'}`,
    ].join('\n');
    navigator.clipboard.writeText(details);
  };

  render() {
    if (this.state.hasError) {
      const { error } = this.state;
      return (
        <div className="flex items-center justify-center h-full p-8">
          <div className="max-w-lg w-full bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-300 mb-2">
              Something went wrong
            </h2>
            <pre className="text-sm text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30 rounded p-3 mb-4 overflow-auto max-h-40">
              {error?.message}
            </pre>
            <div className="flex gap-2">
              <button
                onClick={this.handleCopyError}
                className="px-3 py-2 text-sm bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-900/70"
              >
                Copy Error
              </button>
              <button
                onClick={() => window.history.back()}
                className="px-3 py-2 text-sm bg-surface-100 dark:bg-surface-800 rounded hover:bg-surface-200 dark:hover:bg-surface-700"
              >
                Go Back
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-3 py-2 text-sm bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900/70"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
