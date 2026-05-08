import { useState, useMemo } from 'react';
import { useContent, useConsoles, useComputers, useSites } from '../hooks/useBigFix';
import { Shield, Wrench, Layers, Bug, Search, RefreshCw, Play, ChevronDown, ChevronUp, Filter, EyeOff, ListFilter } from 'lucide-react';
import type { ContentType, BigFixContent, ContentSeverity } from '../lib/api';

const TYPE_CONFIG: Record<ContentType, { label: string; icon: typeof Shield; color: string; bg: string; border: string }> = {
  fixlet: { label: 'Fixlets', icon: Shield, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  task: { label: 'Tasks', icon: Wrench, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
  baseline: { label: 'Baselines', icon: Layers, color: 'text-cyan-600', bg: 'bg-cyan-50', border: 'border-cyan-200' },
  patch: { label: 'Patches', icon: Bug, color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-200' },
};

const SEVERITY_STYLES: Record<ContentSeverity, { bg: string; text: string }> = {
  critical: { bg: 'bg-red-100', text: 'text-red-700' },
  important: { bg: 'bg-orange-100', text: 'text-orange-700' },
  normal: { bg: 'bg-blue-100', text: 'text-blue-700' },
  low: { bg: 'bg-gray-100', text: 'text-gray-600' },
};

export default function ContentManager() {
  const { consoles } = useConsoles();
  const defaultConsole = consoles.find(c => c.is_default) || consoles[0];
  const consoleId = defaultConsole?.id || null;
  const [activeType, setActiveType] = useState<ContentType>('fixlet');
  const [selectedSite, setSelectedSite] = useState('all');
  const { sites, syncFromConsole: syncSites } = useSites(consoleId);
  const { items, loading, syncFromConsole, deployAction } = useContent(consoleId, activeType, selectedSite);
  const { computers } = useComputers(consoleId);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<ContentSeverity | 'all'>('all');
  const [showHiddenContent, setShowHiddenContent] = useState(false);
  const [showNonRelevantContent, setShowNonRelevantContent] = useState(false);
  const [sortField, setSortField] = useState<'name' | 'severity' | 'is_applicable_count'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [applying, setApplying] = useState<string | null>(null);
  const [showApplyModal, setShowApplyModal] = useState<BigFixContent | null>(null);
  const [selectedComputers, setSelectedComputers] = useState<Set<string>>(new Set());
  const [actionName, setActionName] = useState('');

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncSites();
      await syncFromConsole(activeType, selectedSite === 'all' ? undefined : selectedSite);
    } catch (e) { console.error(e); } finally { setSyncing(false); }
  };

  const filtered = useMemo(() => {
    let list = [...items];
    if (!showHiddenContent) list = list.filter(c => !c.is_hidden);
    if (!showNonRelevantContent) list = list.filter(c => c.is_applicable_count > 0);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q) || c.category.toLowerCase().includes(q) || c.source_name.toLowerCase().includes(q));
    }
    if (severityFilter !== 'all') list = list.filter(c => c.severity === severityFilter);
    list.sort((a, b) => {
      if (sortField === 'is_applicable_count') return sortDir === 'asc' ? a.is_applicable_count - b.is_applicable_count : b.is_applicable_count - a.is_applicable_count;
      const cmp = a[sortField].localeCompare(b[sortField]);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [items, showHiddenContent, showNonRelevantContent, search, severityFilter, sortField, sortDir]);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const SortIcon = ({ field }: { field: typeof sortField }) => (
    sortField === field ? (sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />) : null
  );

  const handleApply = async (content: BigFixContent) => {
    setApplying(content.id);
    try {
      const targetBigfixIds = Array.from(selectedComputers).map(dbId => {
        const comp = computers.find(c => c.id === dbId);
        return comp?.bigfix_id || '';
      }).filter(Boolean);
      await deployAction(content.id, targetBigfixIds, actionName || `Apply: ${content.name}`);
      setShowApplyModal(null);
      setSelectedComputers(new Set());
      setActionName('');
    } finally { setApplying(null); }
  };

  const toggleComputer = (id: string) => {
    setSelectedComputers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllComputers = () => {
    if (selectedComputers.size === computers.length) setSelectedComputers(new Set());
    else setSelectedComputers(new Set(computers.map(c => c.id)));
  };

  const typeConfig = TYPE_CONFIG[activeType];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Content Manager</h1>
          <p className="text-sm text-gray-500 mt-1">Manage fixlets, tasks, baselines, and patches from BigFix console</p>
        </div>
        <button onClick={handleSync} disabled={syncing || !consoleId}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium">
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync from Console'}
        </button>
      </div>

      <div className="flex gap-2">
        {(Object.entries(TYPE_CONFIG) as [ContentType, typeof typeConfig][]).map(([type, cfg]) => (
          <button key={type} onClick={() => setActiveType(type)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeType === type ? `${cfg.bg} ${cfg.color} border ${cfg.border}` : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}>
            <cfg.icon className="w-4 h-4" />
            {cfg.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <select value={selectedSite} onChange={e => setSelectedSite(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-64">
          <option value="all">All Sites</option>
          {sites.map(site => (
            <option key={site.id} value={site.name}>{site.display_name || site.name} ({site.type})</option>
          ))}
        </select>
        <button onClick={syncSites} disabled={!consoleId}
          className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors text-sm font-medium border border-gray-200">
          Refresh Sites
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder={`Search ${typeConfig.label.toLowerCase()}...`} value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          {(['all', 'critical', 'important', 'normal', 'low'] as const).map(s => (
            <button key={s} onClick={() => setSeverityFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                severityFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setShowHiddenContent(v => !v)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
            showHiddenContent ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
          }`}>
          <EyeOff className="w-3.5 h-3.5" />
          Hidden Content
        </button>
        <button onClick={() => setShowNonRelevantContent(v => !v)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
            showNonRelevantContent ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
          }`}>
          <ListFilter className="w-3.5 h-3.5" />
          Non-Relevant Content
        </button>
        <span className="text-xs text-gray-500">{filtered.length} shown of {items.length} synced</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <typeConfig.icon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-lg font-medium">No {typeConfig.label.toLowerCase()} found</p>
          <p className="text-sm mt-1">Sync from your BigFix console or adjust filters.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">ID</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('name')}>
                    <span className="flex items-center gap-1">Name <SortIcon field="name" /></span>
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Severity</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('is_applicable_count')}>
                    <span className="flex items-center gap-1">Applicable <SortIcon field="is_applicable_count" /></span>
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Site</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, i) => {
                  const sev = SEVERITY_STYLES[item.severity];
                  return (
                    <tr key={item.id} className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-50/30'}`}>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">{item.bigfix_id}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{item.name}</p>
                        {item.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{item.description}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sev.bg} ${sev.text}`}>{item.severity}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{item.is_applicable_count}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        <div>{item.source_name || item.site_id || '-'}</div>
                        {item.is_hidden && <span className="inline-flex mt-1 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px] font-medium">hidden</span>}
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => { setShowApplyModal(item); setSelectedComputers(new Set()); setActionName(''); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-medium">
                          <Play className="w-3 h-3" /> Deploy
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showApplyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Deploy: {showApplyModal.name}</h2>
              <p className="text-sm text-gray-500 mt-1">{showApplyModal.type} | ID: {showApplyModal.bigfix_id} | Severity: {showApplyModal.severity}</p>
            </div>
            <div className="p-6 flex-1 overflow-y-auto space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Action Name</label>
                <input type="text" value={actionName} onChange={e => setActionName(e.target.value)} placeholder={`Apply: ${showApplyModal.name}`}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Target Computers ({selectedComputers.size} selected)</label>
                  <button onClick={selectAllComputers} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                    {selectedComputers.size === computers.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
                  {computers.map(c => (
                    <label key={c.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0">
                      <input type="checkbox" checked={selectedComputers.has(c.id)} onChange={() => toggleComputer(c.id)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      <span className="text-sm text-gray-700">{c.name}</span>
                      <span className="text-xs text-gray-400 ml-auto">{c.os}</span>
                      <span className="text-xs text-gray-300 font-mono">{c.bigfix_id}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex items-center justify-end gap-3">
              <button onClick={() => setShowApplyModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={() => handleApply(showApplyModal)} disabled={applying === showApplyModal.id || selectedComputers.size === 0}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium">
                {applying === showApplyModal.id ? 'Deploying...' : 'Deploy Action'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
