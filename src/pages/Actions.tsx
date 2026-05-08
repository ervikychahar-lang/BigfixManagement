import { useState, useMemo, useEffect } from 'react';
import { useActions, useConsoles, useActionResults } from '../hooks/useBigFix';
import { Activity, RefreshCw, Play, Square, Filter, Clock, CheckCircle, XCircle, AlertCircle, Eye, Zap, Search, RotateCcw } from 'lucide-react';
import type { ActionStatus, BigFixAction, AnalysisResult } from '../lib/api';

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: typeof Clock }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-600', icon: Clock },
  running: { bg: 'bg-blue-100', text: 'text-blue-700', icon: Play },
  completed: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: CheckCircle },
  failed: { bg: 'bg-red-100', text: 'text-red-700', icon: XCircle },
  expired: { bg: 'bg-amber-100', text: 'text-amber-700', icon: AlertCircle },
  stopped: { bg: 'bg-gray-100', text: 'text-gray-600', icon: Square },
};

const RESULT_STYLES: Record<string, { bg: string; text: string }> = {
  Completed: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  Failed: { bg: 'bg-red-100', text: 'text-red-700' },
  Running: { bg: 'bg-blue-100', text: 'text-blue-700' },
  NotRun: { bg: 'bg-gray-100', text: 'text-gray-500' },
  Pending: { bg: 'bg-gray-100', text: 'text-gray-600' },
  Downloaded: { bg: 'bg-cyan-100', text: 'text-cyan-700' },
};

export default function Actions() {
  const { consoles } = useConsoles();
  const defaultConsole = consoles.find(c => c.is_default) || consoles[0];
  const consoleId = defaultConsole?.id || null;
  const [statusFilter, setStatusFilter] = useState<ActionStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const { actions, loading, syncFromConsole, fetchActionStatus, stopAction, analyzeFailures, redeployAction } = useActions(consoleId, statusFilter === 'all' ? undefined : statusFilter);
  const [syncing, setSyncing] = useState(false);
  const [expandedAction, setExpandedAction] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<Record<string, { analysis: AnalysisResult[]; failedComputers: number; totalComputers: number; actionName: string }>>({});
  const [redeploying, setRedeploying] = useState<string | null>(null);
  const { results, loading: resultsLoading } = useActionResults(expandedAction);

  useEffect(() => {
    if (!consoleId) return;
    const timer = window.setInterval(() => {
      actions
        .filter(action => action.bigfix_id && (action.status === 'running' || action.status === 'pending'))
        .forEach(action => { void fetchActionStatus(action.bigfix_id); });
    }, 30000);
    return () => window.clearInterval(timer);
  }, [actions, consoleId, fetchActionStatus]);

  const handleSync = async () => {
    setSyncing(true);
    try { await syncFromConsole(); } catch (e) { console.error(e); } finally { setSyncing(false); }
  };

  const handleStop = async (actionId: string) => {
    setStopping(actionId);
    try { await stopAction(actionId); } catch (e) { console.error(e); } finally { setStopping(null); }
  };

  const handleFetchStatus = async (action: BigFixAction) => {
    if (!action.bigfix_id) return;
    try { await fetchActionStatus(action.bigfix_id); } catch (e) { console.error(e); }
  };

  const handleAnalyze = async (action: BigFixAction) => {
    setAnalyzing(action.id);
    try {
      if (action.bigfix_id) await fetchActionStatus(action.bigfix_id);
      const result = await analyzeFailures(action.id);
      setAnalysisData(prev => ({
        ...prev,
        [action.id]: {
          analysis: result.analysis || [],
          failedComputers: result.failedComputers || 0,
          totalComputers: result.totalComputers || 0,
          actionName: result.actionName || action.name,
        },
      }));
    } catch (e) { console.error(e); } finally { setAnalyzing(null); }
  };

  const handleRedeploy = async (action: BigFixAction) => {
    setRedeploying(action.id);
    try { await redeployAction(action.id); } catch (e) { console.error(e); } finally { setRedeploying(null); }
  };

  const sorted = useMemo(() => {
    const list = [...actions];
    list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return list;
  }, [actions]);

  const filtered = useMemo(() => {
    if (!search) return sorted;
    const q = search.toLowerCase();
    return sorted.filter(a => a.name.toLowerCase().includes(q) || a.created_by.toLowerCase().includes(q) || a.bigfix_id.includes(q));
  }, [sorted, search]);

  const getProgress = (a: BigFixAction) => {
    if (a.target_count === 0) return 0;
    return Math.round(((a.completed_count + a.failed_count) / a.target_count) * 100);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Actions Monitor</h1>
          <p className="text-sm text-gray-500 mt-1">Monitor, analyze, and auto-fix deployed actions</p>
        </div>
        <button onClick={handleSync} disabled={syncing || !consoleId}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium">
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync Actions'}
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search actions..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-gray-400" />
          {(['all', 'running', 'pending', 'completed', 'failed', 'expired', 'stopped'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
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
          <Activity className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-lg font-medium">No actions found</p>
          <p className="text-sm mt-1">Deploy content or sync from your console.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(action => {
            const style = STATUS_STYLES[action.status] || STATUS_STYLES.running;
            const progress = getProgress(action);
            const isExpanded = expandedAction === action.id;
            const analysis = analysisData[action.id];

            return (
              <div key={action.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-gray-900 truncate">{action.name}</h3>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
                          <style.icon className="w-3 h-3" />{action.status}
                        </span>
                        <span className="text-xs text-gray-400 font-mono">ID: {action.bigfix_id}</span>
                      </div>
                      <p className="text-xs text-gray-500">By: {action.created_by || '-'} | Started: {action.start_time ? new Date(action.start_time).toLocaleString() : '-'}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {(action.status === 'running' || action.status === 'pending') && (
                        <button onClick={() => handleStop(action.id)} disabled={stopping === action.id}
                          className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors text-xs font-medium border border-red-200">
                          <Square className="w-3 h-3" /> {stopping === action.id ? 'Stopping...' : 'Stop'}
                        </button>
                      )}
                      {action.failed_count > 0 && (
                        <button onClick={() => handleAnalyze(action)} disabled={analyzing === action.id}
                          className="flex items-center gap-1 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 disabled:opacity-50 transition-colors text-xs font-medium border border-amber-200">
                          <Zap className="w-3 h-3" /> {analyzing === action.id ? 'Analyzing...' : 'Analyze & Fix'}
                        </button>
                      )}
                      {action.failed_count > 0 && (
                        <button onClick={() => handleRedeploy(action)} disabled={redeploying === action.id}
                          className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors text-xs font-medium border border-blue-200">
                          <RotateCcw className="w-3 h-3" /> {redeploying === action.id ? 'Redeploying...' : 'Redeploy'}
                        </button>
                      )}
                      <button onClick={() => { setExpandedAction(isExpanded ? null : action.id); if (!isExpanded) handleFetchStatus(action); }}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                          isExpanded ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                        }`}>
                        <Eye className="w-3 h-3" /> Details
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-5 gap-2 text-center">
                    <div className="p-2 bg-gray-50 rounded-lg">
                      <p className="text-lg font-bold text-gray-900">{action.target_count}</p>
                      <p className="text-xs text-gray-500">Total</p>
                    </div>
                    <div className="p-2 bg-emerald-50 rounded-lg">
                      <p className="text-lg font-bold text-emerald-700">{action.completed_count}</p>
                      <p className="text-xs text-emerald-600">Completed</p>
                    </div>
                    <div className="p-2 bg-red-50 rounded-lg">
                      <p className="text-lg font-bold text-red-700">{action.failed_count}</p>
                      <p className="text-xs text-red-600">Failed</p>
                    </div>
                    <div className="p-2 bg-blue-50 rounded-lg">
                      <p className="text-lg font-bold text-blue-700">{action.running_count}</p>
                      <p className="text-xs text-blue-600">Running</p>
                    </div>
                    <div className="p-2 bg-gray-50 rounded-lg">
                      <p className="text-lg font-bold text-gray-600">{action.not_run_count}</p>
                      <p className="text-xs text-gray-500">Not Run</p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-500">Progress</span>
                      <span className="font-medium text-gray-700">{progress}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className="flex h-2 rounded-full overflow-hidden">
                        <div className="bg-emerald-500 transition-all" style={{ width: `${action.target_count > 0 ? (action.completed_count / action.target_count) * 100 : 0}%` }} />
                        <div className="bg-red-500 transition-all" style={{ width: `${action.target_count > 0 ? (action.failed_count / action.target_count) * 100 : 0}%` }} />
                        <div className="bg-blue-500 transition-all" style={{ width: `${action.target_count > 0 ? (action.running_count / action.target_count) * 100 : 0}%` }} />
                      </div>
                    </div>
                  </div>
                </div>

                {analysis && analysis.failedComputers > 0 && (
                  <div className="border-t border-amber-200 bg-amber-50 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Zap className="w-4 h-4 text-amber-600" />
                      <h4 className="text-sm font-semibold text-amber-800">Analysis Results: {analysis.failedComputers} failed computers</h4>
                    </div>
                    <div className="space-y-2">
                      {analysis.analysis.map((ar, idx) => (
                        <div key={idx} className="bg-white rounded-lg border border-amber-200 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                                <span className="font-medium text-gray-900 text-sm">{ar.computerName}</span>
                                <span className="text-xs text-gray-400 font-mono">ID: {ar.computerId}</span>
                              </div>
                              <div className="ml-6">
                                <p className="text-xs text-red-600 font-mono bg-red-50 px-2 py-1 rounded mb-2">{ar.status}</p>
                                {(ar.lineNumber > 0 || ar.retryCount > 0) && <p className="text-xs text-gray-500">Failed at line: {ar.lineNumber || '-'} | Retries: {ar.retryCount}</p>}
                                {ar.logExcerpt && <p className="text-xs text-gray-600 font-mono bg-gray-50 border border-gray-200 px-2 py-1 rounded mb-2 break-all">{ar.logExcerpt}</p>}
                                {(ar.rootCause || ar.detail) && (
                                  <div className="mt-2 p-2 bg-gray-50 border border-gray-200 rounded">
                                    {ar.rootCause && <p className="text-xs font-semibold text-gray-800">{ar.rootCause} {ar.confidence && <span className="font-normal text-gray-500">({ar.confidence} confidence)</span>}</p>}
                                    {ar.detail && <p className="text-xs text-gray-600 mt-1">{ar.detail}</p>}
                                    {ar.evidence && ar.evidence.length > 0 && (
                                      <ul className="mt-1 text-xs text-gray-500 list-disc list-inside space-y-0.5">
                                        {ar.evidence.slice(0, 4).map((item, i) => <li key={i}>{item}</li>)}
                                      </ul>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          {ar.proposedResolution && (
                            <div className="ml-6 mt-2 p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                              <div className="flex items-center gap-2 mb-1">
                                <Zap className="w-3.5 h-3.5 text-emerald-600" />
                                <span className="text-sm font-semibold text-emerald-700">{ar.proposedResolution.title}</span>
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                  ar.proposedResolution.type === 'auto' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                }`}>
                                  {ar.proposedResolution.type === 'auto' ? 'Auto-Fix Available' : 'Manual Fix'}
                                </span>
                              </div>
                              <p className="text-xs text-gray-600 mb-2">{ar.proposedResolution.description}</p>
                              {ar.proposedResolution.steps.length > 0 && (
                                <ol className="text-xs text-gray-600 list-decimal list-inside space-y-0.5">
                                  {ar.proposedResolution.steps.map((step, i) => <li key={i}>{step}</li>)}
                                </ol>
                              )}
                              {ar.proposedResolution.type === 'auto' && ar.proposedResolution.script && (
                                <pre className="mt-2 p-2 bg-gray-800 text-green-400 rounded text-xs font-mono overflow-x-auto">{ar.proposedResolution.script}</pre>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {isExpanded && (
                  <div className="border-t border-gray-200 bg-gray-50 p-4">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">Per-Computer Results ({results.length})</h4>
                    {resultsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
                      </div>
                    ) : results.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-4">No detailed results available.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-200">
                              <th className="text-left px-3 py-2 font-semibold text-gray-600">Computer</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-600">OS</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-600">Status</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-600">Error</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-600">Retries</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-600">Completed</th>
                            </tr>
                          </thead>
                          <tbody>
                            {results.map(r => {
                              const rs = RESULT_STYLES[r.status] || { bg: 'bg-gray-100', text: 'text-gray-600' };
                              return (
                                <tr key={r.id} className="border-b border-gray-100">
                                  <td className="px-3 py-2 font-medium text-gray-900">{r.bigfix_computers?.name || '-'}</td>
                                  <td className="px-3 py-2 text-gray-600 text-xs">{r.bigfix_computers?.os || '-'}</td>
                                  <td className="px-3 py-2">
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${rs.bg} ${rs.text}`}>{r.status}</span>
                                  </td>
                                  <td className="px-3 py-2 text-red-600 text-xs max-w-xs truncate">{r.error_message || '-'}</td>
                                  <td className="px-3 py-2 text-gray-600 text-xs">{r.retry_count}</td>
                                  <td className="px-3 py-2 text-gray-500 text-xs">{r.completed_at ? new Date(r.completed_at).toLocaleString() : '-'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
