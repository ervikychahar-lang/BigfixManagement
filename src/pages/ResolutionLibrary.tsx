import { useState, useMemo } from 'react';
import { useResolutions } from '../hooks/useBigFix';
import { BookOpen, Search, Wrench, Zap, Plus, Trash2, CreditCard as Edit2, X, Shield } from 'lucide-react';
import type { BigFixFailureResolution, ResolutionType } from '../lib/api';

const TYPE_STYLES: Record<ResolutionType, { bg: string; text: string; icon: typeof Wrench }> = {
  manual: { bg: 'bg-amber-100', text: 'text-amber-700', icon: Wrench },
  auto: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: Zap },
};

export default function ResolutionLibrary() {
  const { resolutions, loading, addResolution, updateResolution, deleteResolution } = useResolutions();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ResolutionType | 'all'>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({
    error_code: '', error_pattern: '', title: '', description: '',
    resolution_type: 'manual' as ResolutionType, resolution_script: '', resolution_steps: [''],
  });

  const resetForm = () => setForm({ error_code: '', error_pattern: '', title: '', description: '', resolution_type: 'manual', resolution_script: '', resolution_steps: [''] });

  const filtered = useMemo(() => {
    let list = [...resolutions];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(r => r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) || r.error_code.toLowerCase().includes(q));
    }
    if (typeFilter !== 'all') list = list.filter(r => r.resolution_type === typeFilter);
    return list;
  }, [resolutions, search, typeFilter]);

  const handleSave = async () => {
    if (editing) {
      await updateResolution(editing, { ...form, resolution_steps: form.resolution_steps.filter(s => s.trim()) });
      setEditing(null);
    } else {
      await addResolution({ ...form, resolution_steps: form.resolution_steps.filter(s => s.trim()), created_by: null });
      setShowAdd(false);
    }
    resetForm();
  };

  const startEdit = (r: BigFixFailureResolution) => {
    setEditing(r.id);
    setForm({
      error_code: r.error_code, error_pattern: r.error_pattern, title: r.title, description: r.description,
      resolution_type: r.resolution_type, resolution_script: r.resolution_script,
      resolution_steps: r.resolution_steps.length > 0 ? r.resolution_steps : [''],
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Resolution Library</h1>
          <p className="text-sm text-gray-500 mt-1">{resolutions.length} resolutions | {resolutions.filter(r => r.resolution_type === 'auto').length} auto-fix | {resolutions.filter(r => r.is_verified).length} verified</p>
        </div>
        <button onClick={() => { setShowAdd(true); resetForm(); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
          <Plus className="w-4 h-4" /> Add Resolution
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search resolutions..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
        </div>
        <div className="flex items-center gap-2">
          {(['all', 'manual', 'auto'] as const).map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                typeFilter === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {t === 'all' ? 'All' : t === 'manual' ? 'Manual' : 'Auto-Fix'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <BookOpen className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-lg font-medium">No resolutions found</p>
          <p className="text-sm mt-1">Add resolutions to build your fix library.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(r => {
            const typeStyle = TYPE_STYLES[r.resolution_type];
            return (
              <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900 truncate">{r.title}</h3>
                      <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${typeStyle.bg} ${typeStyle.text}`}>
                        <typeStyle.icon className="w-3 h-3" />{r.resolution_type}
                      </span>
                      {r.is_verified && <Shield className="w-4 h-4 text-emerald-500" />}
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-2">{r.description}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-3">
                  {r.error_code && <span className="px-2 py-0.5 bg-red-50 text-red-600 rounded text-xs font-mono border border-red-200">Code: {r.error_code}</span>}
                  {r.error_pattern && <span className="px-2 py-0.5 bg-orange-50 text-orange-600 rounded text-xs font-mono border border-orange-200">Pattern: {r.error_pattern}</span>}
                </div>

                {r.resolution_type === 'manual' && r.resolution_steps.length > 0 && (
                  <div className="mb-3 p-2 bg-amber-50 rounded-lg border border-amber-100">
                    <p className="text-xs font-semibold text-amber-700 mb-1">Steps:</p>
                    <ol className="text-xs text-amber-800 list-decimal list-inside space-y-0.5">
                      {r.resolution_steps.slice(0, 3).map((step, i) => <li key={i} className="truncate">{step}</li>)}
                      {r.resolution_steps.length > 3 && <li className="text-amber-600">+{r.resolution_steps.length - 3} more</li>}
                    </ol>
                  </div>
                )}

                {r.resolution_type === 'auto' && r.resolution_script && (
                  <div className="mb-3 p-2 bg-emerald-50 rounded-lg border border-emerald-100">
                    <p className="text-xs font-semibold text-emerald-700 mb-1">Script:</p>
                    <pre className="text-xs text-emerald-800 font-mono line-clamp-3 whitespace-pre-wrap">{r.resolution_script}</pre>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>Used {r.use_count}x</span>
                    {r.success_rate > 0 && <span>Success: {Number(r.success_rate).toFixed(0)}%</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => startEdit(r)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => updateResolution(r.id, { is_verified: !r.is_verified })}
                      className={`p-1.5 rounded transition-colors ${r.is_verified ? 'text-emerald-500 hover:bg-emerald-50' : 'text-gray-400 hover:text-emerald-600 hover:bg-emerald-50'}`}>
                      <Shield className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deleteResolution(r.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(showAdd || editing) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-auto">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">{editing ? 'Edit Resolution' : 'Add Resolution'}</h2>
              <button onClick={() => { setShowAdd(false); setEditing(null); resetForm(); }}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input type="text" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g., Restart BigFix Agent" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Error Code</label>
                  <input type="text" value={form.error_code} onChange={e => setForm(p => ({ ...p, error_code: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g., 401" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Error Pattern (regex)</label>
                  <input type="text" value={form.error_pattern} onChange={e => setForm(p => ({ ...p, error_pattern: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g., timeout.*" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" rows={2} placeholder="Describe the resolution..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <div className="flex gap-2">
                  {(['manual', 'auto'] as const).map(t => (
                    <button key={t} onClick={() => setForm(p => ({ ...p, resolution_type: t }))}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        form.resolution_type === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}>
                      {t === 'manual' ? <Wrench className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              {form.resolution_type === 'auto' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Auto-Fix Script</label>
                  <textarea value={form.resolution_script} onChange={e => setForm(p => ({ ...p, resolution_script: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" rows={4} placeholder="Enter BigFix action script..." />
                </div>
              )}
              {form.resolution_type === 'manual' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Manual Steps</label>
                  {form.resolution_steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-gray-400 w-5">{i + 1}.</span>
                      <input type="text" value={step} onChange={e => {
                        const steps = [...form.resolution_steps];
                        steps[i] = e.target.value;
                        setForm(p => ({ ...p, resolution_steps: steps }));
                      }}
                        className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder={`Step ${i + 1}`} />
                      {form.resolution_steps.length > 1 && (
                        <button onClick={() => setForm(p => ({ ...p, resolution_steps: p.resolution_steps.filter((_, j) => j !== i) }))}>
                          <X className="w-4 h-4 text-gray-400 hover:text-red-500" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button onClick={() => setForm(p => ({ ...p, resolution_steps: [...p.resolution_steps, ''] }))}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Add Step</button>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => { setShowAdd(false); setEditing(null); resetForm(); }} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={!form.title}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium">
                {editing ? 'Save Changes' : 'Add Resolution'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
