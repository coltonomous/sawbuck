import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import Dashboard from './pages/Dashboard';
import Listings from './pages/Listings';
import ListingDetail from './pages/ListingDetail';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Settings from './pages/Settings';
import Analytics from './pages/Analytics';
import './styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<App />}>
              <Route index element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
              <Route path="listings" element={<ErrorBoundary><Listings /></ErrorBoundary>} />
              <Route path="listings/:id" element={<ErrorBoundary><ListingDetail /></ErrorBoundary>} />
              <Route path="projects" element={<ErrorBoundary><Projects /></ErrorBoundary>} />
              <Route path="projects/:id" element={<ErrorBoundary><ProjectDetail /></ErrorBoundary>} />
              <Route path="analytics" element={<ErrorBoundary><Analytics /></ErrorBoundary>} />
              <Route path="settings" element={<ErrorBoundary><Settings /></ErrorBoundary>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>
);
