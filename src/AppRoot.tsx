import App from './App';
import { ToastProvider } from './components/ui/Toast';

/**
 * The composition root: everything the screen needs wrapped around `App`.
 * `main.tsx` and the component tests both render THIS, so a test exercises
 * the same tree the browser does.
 */
export default function AppRoot() {
  return (
    <ToastProvider>
      <App />
    </ToastProvider>
  );
}
