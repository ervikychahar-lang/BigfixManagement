import { useState } from 'react';
import { LayoutDashboard, Monitor, Shield, Activity, AlertTriangle, BookOpen, Settings, Menu, X, Server } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Computers from './pages/Computers';
import ContentManager from './pages/ContentManager';
import Actions from './pages/Actions';
import FailureReports from './pages/FailureReports';
import ResolutionLibrary from './pages/ResolutionLibrary';
import SettingsPage from './pages/Settings';

type Page = 'dashboard' | 'computers' | 'content' | 'actions' | 'failures' | 'resolutions' | 'settings';

const NAV_ITEMS: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'computers', label: 'Endpoints', icon: Monitor },
  { id: 'content', label: 'Content', icon: Shield },
  { id: 'actions', label: 'Actions', icon: Activity },
  { id: 'failures', label: 'Failures', icon: AlertTriangle },
  { id: 'resolutions', label: 'Knowledge Base', icon: BookOpen },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function App() {
  const [activePage, setActivePage] = useState<Page>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard': return <Dashboard onNavigate={(p) => setActivePage(p as Page)} />;
      case 'computers': return <Computers />;
      case 'content': return <ContentManager />;
      case 'actions': return <Actions />;
      case 'failures': return <FailureReports />;
      case 'resolutions': return <ResolutionLibrary />;
      case 'settings': return <SettingsPage />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 flex flex-col transition-transform duration-200 ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      }`}>
        <div className="p-5 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <Server className="w-4.5 h-4.5 text-white" />
              </div>
              <div>
                <h1 className="text-base font-bold text-gray-900 leading-tight">BigFix Manager</h1>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Console Control</p>
              </div>
            </div>
            <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-1 text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map(item => (
            <button key={item.id} onClick={() => { setActivePage(item.id); setSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activePage === item.id
                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 border border-transparent'
              }`}>
              <item.icon className={`w-4.5 h-4.5 ${activePage === item.id ? 'text-blue-600' : 'text-gray-400'}`} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-200">
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
            <p className="text-xs font-semibold text-blue-700">BigFix Management</p>
            <p className="text-[10px] text-blue-600 mt-0.5">Connect your console in Settings</p>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-200 px-4 lg:px-6 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              {NAV_ITEMS.filter(i => i.id === activePage).map(item => (
                <div key={item.id} className="flex items-center gap-2">
                  <item.icon className="w-4.5 h-4.5 text-gray-400" />
                  <h2 className="text-sm font-semibold text-gray-900">{item.label}</h2>
                </div>
              ))}
            </div>
          </div>
        </header>
        <div className="p-4 lg:p-6 max-w-7xl mx-auto">
          {renderPage()}
        </div>
      </main>
    </div>
  );
}

export default App;
