import { useState, useMemo } from 'react';
import { useFailedResults, useConsoles, useResolutions, useAppliedResolutions } from '../hooks/useBigFix';
import { AlertTriangle, Search, Wrench, Zap, Eye, Plus, X, Check, RefreshCw, Shield } from 'lucide-react';
import type { BigFixActionResult, ResolutionType, AnalysisResult } from '../lib/api';
import { bigfixApi } from '../lib/api';

const RESOLUTION_TYPE_STYLES: Record<ResolutionType, { bg: string; text: string }> = {
  manual: { bg: 'bg-amber-100', text: 'text-amber-700' },
  auto: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
};

export default function FailureReports() {
  const { consoles } = useConsoles();
  const defaultConsole = consoles.find(c => c.is_default) || consoles[0];
  const consoleId = defaultConsole?.id || null;
  const { failures, loading, fetch: refetchFailures } = useFailedResults(consoleId);
  const { resolutions, addResolution, applyFix } = useResolutions();
  const [search, setSearch] = useState('');
  const [selectedFailure, setSelectedFailure] = useState<BigFixActionResult | null>(null);
  const [showAddResolution, setShowAddResolution] = useState(false);
  const [showApplyModal, setShowApplyModal] = useState<BigFixActionResult | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [analysisResults, setAnalysisResults] = useState<Record<string, AnalysisResult[]>>({});
  const [newResolution, setNewResolution] = useState({
    error_code: '', error_pattern: '', title: '', description: '',
    resolution_type: 'manual' as ResolutionType, resolution_script: '', resolution_steps: [''],
  });

  const { applied, loading: appliedLoading } = useAppliedResolutions(selectedFailure?.id || null);

  const filtered = useMemo(() => {
    if (!search) return failures;
    const q = search.toLowerCase();
    return failures.filter(f =>
      (f.error_message || '').toLowerCase().includes(q) ||
      (f.result_code || '').toLowerCase().includes(q) ||
      ((f as any).bigfix_computers?.name || '').toLowerCase().includes(q) ||
      ((f as any).bigfix_actions?.name || '').toLowerCase().includes(q)
    );
  }, [failures, search]);

  const matchingResolutions = (failure: BigFixActionResult) => {
    return resolutions.filter(r => {
      if (r.error_code && failure.result_code && r.error_code === failure.result_code) return true;
      if (r.error_pattern) {
        try { return new RegExp(r.error_pattern, 'i').test(failure.error_message || ''); } catch { return false; }
      }
      return false;
    });
  };

  const handleApplyFix = async (failure: BigFixActionResult, resolutionId: string, appliedBy: 'manual' | 'auto') => {
    if (!consoleId) return;
    setApplying(failure.id);
    try {
      await applyFix(consoleId, failure.id, resolutionId, appliedBy);
      await refetchFailures();
      setShowApplyModal(null);
    } catch (e) { console.error(e); } finally { setApplying(null); }
  };

  const handleAnalyzeFailure = async (failure: BigFixActionResult) => {
    if (!consoleId) return;
    setAnalyzing(failure.id);
    try {
      const actionId = (failure as any).bigfix_actions?.id || failure.action_id;
      if (actionId) {
        const result = await bigfixApi.analyzeFailures(consoleId, actionId);
        if (result.analysis) {
          setAnalysisResults(prev => ({ ...prev, [failure.id]: result.analysis }));
        }
      }
    } catch (e) { console.error(e); } finally { setAnalyzing(null); }
  };

  const handleAddResolution = async () => {
    await addResolution({
      ...newResolution,
      resolution_steps: newResolution.resolution_steps.filter(s => s.trim()),
      created_by: null,
    });
    setShowAddResolution(false);
    setNewResolution({ error_code: '', error_pattern: '', title: '', description: '', resolution_type: 'manual', resolution_script: '', resolution_steps: [''] });
  };

  const uniqueErrorCodes = useMemo(() => {
    const codes = new Map<string, number>();
    failures.forEach(f => {
      const code = f.result_code || 'unknown';
      codes.set(code, (codes.get(code) || 0) + 1);
    });
    return Array.from(codes.entries()).sort((a, b) => b[1] - a[1]);
  }, [failures]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Failure Reports & Auto-Fix</h1>
          <p className="text-sm text-gray-500 mt-1">{failures.length} failures | Auto-analyze errors and apply fixes</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetchFailures()} className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium border border-gray-200">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={() => setShowAddResolution(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
            <Plus className="w-4 h-4" /> Add Resolution
          </button>
        </div>
      </div>

      {uniqueErrorCodes.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Error Code Distribution</h2>
          <div className="flex flex-wrap gap-2">
            {uniqueErrorCodes.map(([code, count]) => (
              <span key={code} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-xs font-medium border border-red-200">
                <AlertTriangle className="w-3 h-3" />
                {code}: {count} occurrence{count > 1 ? 's' : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input type="text" placeholder="Search by error message, code, computer, or action..." value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <Shield className="w-12 h-12 mx-auto mb-3 text-emerald-300" />
          <p className="text-lg font-medium">No failures found</p>
          <p className="text-sm mt-1">{failures.length === 0 ? 'All actions are healthy!' : 'Try adjusting your search.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(failure => {
            const matches = matchingResolutions(failure);
            const computer = (failure as any).bigfix_computers;
            const action = (failure as any).bigfix_actions;
            const analysis = analysisResults[failure.id];

            return (
              <div key={failure.id} className="bg-white border border-red-200 rounded-xl overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                        <h3 className="font-semibold text-gray-900 truncate">{action?.name || 'Unknown Action'}</h3>
                      </div>
                      <div className="text-xs text-gray-500 space-x-3">
                        <span>Computer: {computer?.name || '-'}</span>
                        <span>OS: {computer?.os || '-'}</span>
                        <span>IP: {computer?.ip_address || '-'}</span>
                        <span className="font-mono">BigFix ID: {computer?.bigfix_id || '-'}</span>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium flex-shrink-0">
                      Code: {failure.result_code || 'ERROR'}
                    </span>
                  </div>

                  {failure.error_message && (
                    <div className="mt-2 p-2 bg-red-50 rounded-lg border border-red-100">
                      <p className="text-xs text-red-700 font-mono break-all">{failure.error_message}</p>
                    </div>
                  )}

                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-xs text-gray-500">
                      {failure.started_at && <span>Started: {new Date(failure.started_at).toLocaleString()}</span>}
                      {failure.completed_at && <span className="ml-3">Failed: {new Date(failure.completed_at).toLocaleString()}</span>}
                      {failure.retry_count > 0 && <span className="ml-3">Retries: {failure.retry_count}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {matches.length > 0 && (
                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium border border-emerald-200">
                          {matches.length} fix{matches.length > 1 ? 'es' : ''} available
                        </span>
                      )}
                      <button onClick={() => handleAnalyzeFailure(failure)} disabled={analyzing === failure.id}
                        className="flex items-center gap-1 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors text-xs font-medium border border-amber-200 disabled:opacity-50">
                        <Zap className="w-3 h-3" /> {analyzing === failure.id ? 'Analyzing...' : 'Auto-Analyze'}
                      </button>
                      <button onClick={() => setSelectedFailure(selectedFailure?.id === failure.id ? null : failure)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100 transition-colors text-xs font-medium border border-gray-200">
                        <Eye className="w-3 h-3" /> History
                      </button>
                      <button onClick={() => setShowApplyModal(failure)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-medium">
                        <Wrench className="w-3 h-3" /> Fix
                      </button>
                    </div>
                  </div>

                  {analysis && analysis.length > 0 && (
                    <div className="mt-3 border-t border-amber-200 pt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="w-4 h-4 text-amber-600" />
                        <span className="text-sm font-semibold text-amber-800">Auto-Analysis</span>
                      </div>
                      {analysis.map((ar, idx) => ar.proposedResolution && (
                        <div key={idx} className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg mb-2">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-semibold text-emerald-700">{ar.proposedResolution.title}</span>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              ar.proposedResolution.type === 'auto' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                            }`}>
                              {ar.proposedResolution.type === 'auto' ? 'Auto-Fix' : 'Manual'}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 mb-2">{ar.proposedResolution.description}</p>
                          {ar.proposedResolution.steps.length > 0 && (
                            <ol className="text-xs text-gray-600 list-decimal list-inside space-y-0.5 mb-2">
                              {ar.proposedResolution.steps.map((step, i) => <li key={i}>{step}</li>)}
                            </ol>
                          )}
                          {ar.proposedResolution.type === 'auto' && ar.proposedResolution.script && (
                            <pre className="p-2 bg-gray-800 text-green-400 rounded text-xs font-mono overflow-x-auto">{ar.proposedResolution.script}</pre>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {selectedFailure?.id === failure.id && (
                  <div className="border-t border-gray-200 bg-gray-50 p-4">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">Resolution History</h4>
                    {appliedLoading ? (
                      <div className="flex items-center justify-center py-4">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
                      </div>
                    ) : applied.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-2">No resolutions applied yet</p>
                    ) : (
                      <div className="space-y-2">
                        {applied.map(ar => (
                          <div key={ar.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200">
                            <div>
                              <p className="text-sm font-medium text-gray-900">{(ar as any).bigfix_failure_resolutions?.title || 'Unknown'}</p>
                              <p className="text-xs text-gray-500">Applied: {ar.applied_by} | {new Date(ar.created_at).toLocaleString()}</p>
                              {ar.output && <p className="text-xs text-gray-400 mt-1">{ar.output}</p>}
                            </div>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              ar.status === 'succeeded' ? 'bg-emerald-100 text-emerald-700' :
                              ar.status === 'failed' ? 'bg-red-100 text-red-700' :
                              ar.status === 'running' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                            }`}>
                              {ar.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showApplyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Apply Fix</h2>
              <p className="text-sm text-gray-500 mt-1">Error: {showApplyModal.result_code} - {showApplyModal.error_message?.substring(0, 80)}</p>
            </div>
            <div className="p-6 flex-1 overflow-y-auto space-y-3">
              {matchingResolutions(showApplyModal).length > 0 ? (
                <>
                  <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide mb-2">Matching Resolutions</p>
                  {matchingResolutions(showApplyModal).map(r => {
                    const typeStyle = RESOLUTION_TYPE_STYLES[r.resolution_type];
                    return (
                      <div key={r.id} className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-semibold text-gray-900">{r.title}</p>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeStyle.bg} ${typeStyle.text}`}>{r.resolution_type}</span>
                        </div>
                        <p className="text-xs text-gray-600 mb-2">{r.description}</p>
                        {r.resolution_type === 'manual' && r.resolution_steps.length > 0 && (
                          <ol className="text-xs text-gray-600 list-decimal list-inside space-y-0.5 mb-2">
                            {r.resolution_steps.map((step, i) => <li key={i}>{step}</li>)}
                          </ol>
                        )}
                        {r.resolution_type === 'auto' && r.resolution_script && (
                          <pre className="p-2 bg-gray-800 text-green-400 rounded text-xs font-mono mb-2 overflow-x-auto">{r.resolution_script}</pre>
                        )}
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-gray-500">
                            <span>Used {r.use_count}x</span>
                            {r.success_rate > 0 && <span className="ml-2">Success: {Number(r.success_rate).toFixed(0)}%</span>}
                            {r.is_verified && <Check className="w-3 h-3 text-emerald-500 inline ml-1" />}
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => handleApplyFix(showApplyModal, r.id, 'manual')}
                              disabled={applying === showApplyModal.id}
                              className="px-3 py-1 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-700 disabled:opacity-50">
                              <Wrench className="w-3 h-3 inline mr-1" />Manual Fix
                            </button>
                            {r.resolution_type === 'auto' && (
                              <button onClick={() => handleApplyFix(showApplyModal, r.id, 'auto')}
                                disabled={applying === showApplyModal.id}
                                className="px-3 py-1 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-700 disabled:opacity-50">
                                <Zap className="w-3 h-3 inline mr-1" />Auto-Fix
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              ) : null}

              {resolutions.length > 0 && (
                <>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-4 mb-2">All Resolutions</p>
                  {resolutions.filter(r => !matchingResolutions(showApplyModal).some(m => m.id === r.id)).map(r => (
                    <div key={r.id} className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium text-gray-900">{r.title}</p>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RESOLUTION_TYPE_STYLES[r.resolution_type].bg} ${RESOLUTION_TYPE_STYLES[r.resolution_type].text}`}>
                          {r.resolution_type}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mb-2">{r.description}</p>
                      <div className="flex gap-2">
                        <button onClick={() => handleApplyFix(showApplyModal, r.id, 'manual')}
                          disabled={applying === showApplyModal.id}
                          className="px-3 py-1 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-700 disabled:opacity-50">
                          <Wrench className="w-3 h-3 inline mr-1" />Manual
                        </button>
                        {r.resolution_type === 'auto' && (
                          <button onClick={() => handleApplyFix(showApplyModal, r.id, 'auto')}
                            disabled={applying === showApplyModal.id}
                            className="px-3 py-1 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-700 disabled:opacity-50">
                            <Zap className="w-3 h-3 inline mr-1" />Auto
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end">
              <button onClick={() => setShowApplyModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}

      {showAddResolution && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-auto">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Add Resolution</h2>
              <button onClick={() => setShowAddResolution(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input type="text" value={newResolution.title} onChange={e => setNewResolution(p => ({ ...p, title: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g., Restart BigFix Agent" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Error Code</label>
                  <input type="text" value={newResolution.error_code} onChange={e => setNewResolution(p => ({ ...p, error_code: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g., 4294967290" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Error Pattern (regex)</label>
                  <input type="text" value={newResolution.error_pattern} onChange={e => setNewResolution(p => ({ ...p, error_pattern: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g., Download Failed" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea value={newResolution.description} onChange={e => setNewResolution(p => ({ ...p, description: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" rows={2} placeholder="Describe the resolution..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <div className="flex gap-2">
                  {(['manual', 'auto'] as const).map(t => (
                    <button key={t} onClick={() => setNewResolution(p => ({ ...p, resolution_type: t }))}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        newResolution.resolution_type === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}>
                      {t === 'manual' ? <Wrench className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              {newResolution.resolution_type === 'auto' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Auto-Fix Script (BigFix ActionScript)</label>
                  <textarea value={newResolution.resolution_script} onChange={e => setNewResolution(p => ({ ...p, resolution_script: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" rows={4} placeholder="Enter BigFix action script..." />
                </div>
              )}
              {newResolution.resolution_type === 'manual' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Manual Steps</label>
                  {newResolution.resolution_steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-gray-400 w-5">{i + 1}.</span>
                      <input type="text" value={step} onChange={e => {
                        const steps = [...newResolution.resolution_steps];
                        steps[i] = e.target.value;
                        setNewResolution(p => ({ ...p, resolution_steps: steps }));
                      }}
                        className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder={`Step ${i + 1}`} />
                      {newResolution.resolution_steps.length > 1 && (
                        <button onClick={() => setNewResolution(p => ({ ...p, resolution_steps: p.resolution_steps.filter((_, j) => j !== i) }))}>
                          <X className="w-4 h-4 text-gray-400 hover:text-red-500" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button onClick={() => setNewResolution(p => ({ ...p, resolution_steps: [...p.resolution_steps, ''] }))}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Add Step</button>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => setShowAddResolution(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={handleAddResolution} disabled={!newResolution.title}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium">
                Add Resolution
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
