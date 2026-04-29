import { useState } from 'react';
import { useConsoles } from '../hooks/useBigFix';
import { Plus, Trash2, Plug, Check, X, Server, Star } from 'lucide-react';

export default function Settings() {
  const { consoles, loading, addConsole, updateConsole, deleteConsole, testConnection } = useConsoles();
  const [showAdd, setShowAdd] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { success: boolean; message: string; serverVersion?: string }>>({});
  const [form, setForm] = useState({
    name: '', host: '', port: 52311, username: '', password_encrypted: '', is_default: false,
  });

  const resetForm = () => setForm({ name: '', host: '', port: 52311, username: '', password_encrypted: '', is_default: false });

  const handleAdd = async () => {
    await addConsole(form);
    setShowAdd(false);
    resetForm();
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    setTestResult(prev => ({ ...prev, [id]: { success: false, message: 'Connecting to BigFix server...' } }));
    try {
      const result = await testConnection(id);
      setTestResult(prev => ({ ...prev, [id]: { success: result.success, message: result.message || 'Connection successful', serverVersion: result.serverVersion } }));
    } catch (e) {
      setTestResult(prev => ({ ...prev, [id]: { success: false, message: (e as Error).message } }));
    } finally { setTesting(null); }
  };

  const handleSetDefault = async (id: string) => {
    for (const c of consoles) {
      if (c.id === id) await updateConsole(id, { is_default: true });
      else if (c.is_default) await updateConsole(c.id, { is_default: false });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500 mt-1">Manage BigFix console connections (REST API on port 52311)</p>
        </div>
        <button onClick={() => { setShowAdd(true); resetForm(); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
          <Plus className="w-4 h-4" /> Add Console
        </button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-blue-800 mb-2">BigFix REST API Connection</h2>
        <p className="text-xs text-blue-700 leading-relaxed">
          Connect to your HCL BigFix server using the REST API. The default port is <strong>52311</strong> (HTTPS).
          The tool authenticates using your BigFix Console operator credentials via HTTP Basic Auth.
          Make sure the REST API is enabled on your BigFix server and your operator has the necessary permissions.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : consoles.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <Server className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-lg font-medium">No consoles configured</p>
          <p className="text-sm mt-1">Add your BigFix console to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {consoles.map(console => {
            const test = testResult[console.id];
            return (
              <div key={console.id} className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900">{console.name}</h3>
                      {console.is_default && (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
                          <Star className="w-3 h-3" /> Default
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        console.status === 'connected' ? 'bg-emerald-100 text-emerald-700' :
                        console.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {console.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">https://{console.host}:{console.port}/api</p>
                    <p className="text-xs text-gray-400 mt-1">User: {console.username} | Last connected: {console.last_connected ? new Date(console.last_connected).toLocaleString() : 'Never'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!console.is_default && (
                      <button onClick={() => handleSetDefault(console.id)} title="Set as default"
                        className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors">
                        <Star className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => handleTest(console.id)} disabled={testing === console.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 transition-colors text-xs font-medium border border-emerald-200 disabled:opacity-50">
                      <Plug className="w-3.5 h-3.5" /> {testing === console.id ? 'Testing...' : 'Test Connection'}
                    </button>
                    <button onClick={() => deleteConsole(console.id)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {test && (
                  <div className={`mt-3 p-3 rounded-lg text-xs font-medium ${
                    test.success ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
                  }`}>
                    <div className="flex items-center gap-2">
                      {test.success ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                      <span>{test.message}</span>
                    </div>
                    {test.serverVersion && <p className="mt-1 ml-6 text-emerald-600">Server Version: {test.serverVersion}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Add BigFix Console</h2>
              <p className="text-sm text-gray-500 mt-1">Enter your BigFix REST API connection details</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Console Name</label>
                <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g., Production Console" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Host</label>
                  <input type="text" value={form.host} onChange={e => setForm(p => ({ ...p, host: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="bigfix.company.com" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
                  <input type="number" value={form.port} onChange={e => setForm(p => ({ ...p, port: parseInt(e.target.value) || 52311 }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username (Operator)</label>
                <input type="text" value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="BigFix Console operator username" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input type="password" value={form.password_encrypted} onChange={e => setForm(p => ({ ...p, password_encrypted: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Operator password" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_default} onChange={e => setForm(p => ({ ...p, is_default: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                <span className="text-sm text-gray-700">Set as default console</span>
              </label>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => { setShowAdd(false); resetForm(); }} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={handleAdd} disabled={!form.name || !form.host || !form.username || !form.password_encrypted}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium">
                Add Console
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
