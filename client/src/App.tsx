import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar';

export default function App() {
  const location = useLocation();

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <div key={location.pathname} style={{ animation: 'fadeInUp 0.2s ease-out' }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
