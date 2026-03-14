import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ConfirmDialogProvider } from '@/components/ui/ConfirmDialog';
import { AppShell } from '@/components/layout/AppShell';

export default function App() {
  return (
    <ErrorBoundary>
      <ConfirmDialogProvider>
        <AppShell />
      </ConfirmDialogProvider>
    </ErrorBoundary>
  );
}
