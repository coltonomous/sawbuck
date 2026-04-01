import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import AuthGuard from './components/AuthGuard';
import { ToastProvider } from './components/Toast';
import './styles/globals.css';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Listings = lazy(() => import('./pages/Listings'));
const ListingDetail = lazy(() => import('./pages/ListingDetail'));
const Projects = lazy(() => import('./pages/Projects'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'));
const Settings = lazy(() => import('./pages/Settings'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Login = lazy(() => import('./pages/Login'));

function SuspenseRoute({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin h-8 w-8 border-4 border-amber-500 border-t-transparent rounded-full" /></div>}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<SuspenseRoute><Login /></SuspenseRoute>} />
            <Route element={<AuthGuard><App /></AuthGuard>}>
              <Route index element={<SuspenseRoute><Dashboard /></SuspenseRoute>} />
              <Route path="listings" element={<SuspenseRoute><Listings /></SuspenseRoute>} />
              <Route path="listings/:id" element={<SuspenseRoute><ListingDetail /></SuspenseRoute>} />
              <Route path="projects" element={<SuspenseRoute><Projects /></SuspenseRoute>} />
              <Route path="projects/:id" element={<SuspenseRoute><ProjectDetail /></SuspenseRoute>} />
              <Route path="analytics" element={<SuspenseRoute><Analytics /></SuspenseRoute>} />
              <Route path="settings" element={<SuspenseRoute><Settings /></SuspenseRoute>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>
);
