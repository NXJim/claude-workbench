import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ConfirmDialogProvider } from '@/components/ui/ConfirmDialog';
import { AppShell } from '@/components/layout/AppShell';
import { EditorPage } from '@/components/editor/EditorPage';

export default function App() {
  // Standalone editor route — /edit?path=...
  if (window.location.pathname === '/edit') {
    return (
      <ErrorBoundary>
        <EditorPage />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <ConfirmDialogProvider>
        <AppShell />
      </ConfirmDialogProvider>
    </ErrorBoundary>
  );
}
