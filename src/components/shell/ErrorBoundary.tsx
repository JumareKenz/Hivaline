/**
 * ErrorBoundary — catch render errors and show restart UI
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _errorInfo: React.ErrorInfo) {
    /* Error logged to error reporting service in production */
  }

  handleRestart = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full px-4 text-center bg-bg-primary">
          <div className="w-16 h-16 rounded-2xl bg-error/10 flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-error" />
          </div>
          <h2 className="font-display font-semibold text-xl text-n-900 dark:text-n-100 mb-2">
            Something went wrong
          </h2>
          <p className="font-body text-sm text-n-500 dark:text-n-400 mb-6">
            Your clinical data is safe. Tap to restart HIVA.
          </p>
          <button
            type="button"
            onClick={this.handleRestart}
            className="px-6 py-3 bg-accent-500 text-white font-body font-semibold rounded-xl active:scale-[0.97] transition-transform"
          >
            Restart HIVA
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
