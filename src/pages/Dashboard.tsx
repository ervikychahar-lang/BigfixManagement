import { useDashboardStats, useConsoles } from '../hooks/useBigFix';
import { Monitor, Shield, Wrench, Layers, Bug, Activity, AlertTriangle, CheckCircle, XCircle, Clock, Zap } from 'lucide-react';

interface DashboardProps {
  onNavigate: (page: string) => void;
}

export default function Dashboard({ onNavigate }: DashboardProps) {
  const { consoles } = useConsoles();
  const defaultConsole = consoles.find(c => c.is_default) || consoles[0];
  const consoleId = defaultConsole?.id || null;
  const { stats, loading } = useDashboardStats(consoleId);

  const statCards = [
    { label: 'Total Endpoints', value: stats.totalComputers, icon: Monitor, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', sub: `${stats.onlineComputers} online`, click: 'computers' },
    { label: 'Fixlets', value: stats.totalFixlets, icon: Shield, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', sub: `${stats.criticalContent} critical`, click: 'content' },
    { label: 'Tasks', value: stats.totalTasks, icon: Wrench, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', sub: 'deployed tasks', click: 'content' },
    { label: 'Baselines', value: stats.totalBaselines, icon: Layers, color: 'text-cyan-600', bg: 'bg-cyan-50', border: 'border-cyan-200', sub: 'config baselines', click: 'content' },
    { label: 'Patches', value: stats.totalPatches, icon: Bug, color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-200', sub: 'available patches', click: 'content' },
    { label: 'Active Actions', value: stats.activeActions, icon: Activity, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200', sub: 'in progress', click: 'actions' },
    { label: 'Failed Actions', value: stats.failedActions, icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', sub: 'need attention', click: 'failures' },
    { label: 'Critical Content', value: stats.criticalContent, icon: AlertTriangle, color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', sub: 'high severity', click: 'content' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            {defaultConsole ? `Connected to: ${defaultConsole.name} (${defaultConsole.host}:${defaultConsole.port})` : 'No console configured. Go to Settings to add one.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {defaultConsole && (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
              defaultConsole.status === 'connected' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
              defaultConsole.status === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
              'bg-gray-50 text-gray-600 border border-gray-200'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                defaultConsole.status === 'connected' ? 'bg-emerald-500 animate-pulse' :
                defaultConsole.status === 'error' ? 'bg-red-500' : 'bg-gray-400'
              }`} />
              {defaultConsole.status === 'connected' ? 'Connected' : defaultConsole.status === 'error' ? 'Error' : 'Disconnected'}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {statCards.map(card => (
              <div key={card.label} className={`${card.bg} ${card.border} border rounded-xl p-5 transition-all hover:shadow-md cursor-pointer`}
                onClick={() => onNavigate(card.click)}>
                <div className="flex items-center justify-between mb-3">
                  <card.icon className={`w-5 h-5 ${card.color}`} />
                  <span className="text-2xl font-bold text-gray-900">{card.value}</span>
                </div>
                <p className="text-sm font-semibold text-gray-700">{card.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{card.sub}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Endpoint Health</h2>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">Online</span>
                    <span className="font-medium text-emerald-600">{stats.totalComputers > 0 ? Math.round((stats.onlineComputers / stats.totalComputers) * 100) : 0}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2.5">
                    <div className="bg-emerald-500 h-2.5 rounded-full transition-all" style={{ width: `${stats.totalComputers > 0 ? (stats.onlineComputers / stats.totalComputers) * 100 : 0}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">Offline</span>
                    <span className="font-medium text-gray-500">{stats.totalComputers > 0 ? Math.round(((stats.totalComputers - stats.onlineComputers) / stats.totalComputers) * 100) : 0}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2.5">
                    <div className="bg-gray-400 h-2.5 rounded-full transition-all" style={{ width: `${stats.totalComputers > 0 ? ((stats.totalComputers - stats.onlineComputers) / stats.totalComputers) * 100 : 0}%` }} />
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-emerald-500" />{stats.onlineComputers} online</div>
                <div className="flex items-center gap-1.5"><XCircle className="w-4 h-4 text-gray-400" />{stats.totalComputers - stats.onlineComputers} offline</div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Action Status</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-lg border border-emerald-100">
                  <div className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-600" /><span className="text-sm text-emerald-700">Completed</span></div>
                  <span className="text-sm font-semibold text-emerald-700">{stats.completedActions}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-100">
                  <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-amber-600" /><span className="text-sm text-amber-700">Running / Pending</span></div>
                  <span className="text-sm font-semibold text-amber-700">{stats.activeActions}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg border border-red-100">
                  <div className="flex items-center gap-2"><XCircle className="w-4 h-4 text-red-600" /><span className="text-sm text-red-700">Failed</span></div>
                  <span className="text-sm font-semibold text-red-700">{stats.failedActions}</span>
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Content Distribution</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-3 bg-emerald-50 rounded-lg border border-emerald-100">
                  <Shield className="w-5 h-5 text-emerald-600 mx-auto mb-1" />
                  <p className="text-lg font-bold text-gray-900">{stats.totalFixlets}</p>
                  <p className="text-xs text-gray-500">Fixlets</p>
                </div>
                <div className="text-center p-3 bg-amber-50 rounded-lg border border-amber-100">
                  <Wrench className="w-5 h-5 text-amber-600 mx-auto mb-1" />
                  <p className="text-lg font-bold text-gray-900">{stats.totalTasks}</p>
                  <p className="text-xs text-gray-500">Tasks</p>
                </div>
                <div className="text-center p-3 bg-cyan-50 rounded-lg border border-cyan-100">
                  <Layers className="w-5 h-5 text-cyan-600 mx-auto mb-1" />
                  <p className="text-lg font-bold text-gray-900">{stats.totalBaselines}</p>
                  <p className="text-xs text-gray-500">Baselines</p>
                </div>
                <div className="text-center p-3 bg-rose-50 rounded-lg border border-rose-100">
                  <Bug className="w-5 h-5 text-rose-600 mx-auto mb-1" />
                  <p className="text-lg font-bold text-gray-900">{stats.totalPatches}</p>
                  <p className="text-xs text-gray-500">Patches</p>
                </div>
              </div>
            </div>
          </div>

          {stats.failedActions > 0 && (
            <div className="bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-xl p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                    <Zap className="w-5 h-5 text-red-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Auto-Fix Available</h3>
                    <p className="text-sm text-gray-600">{stats.failedActions} failed action{stats.failedActions > 1 ? 's' : ''} detected. Click to analyze and auto-fix.</p>
                  </div>
                </div>
                <button onClick={() => onNavigate('failures')}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium">
                  Analyze Failures
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
