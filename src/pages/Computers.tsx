import { useState, useMemo } from 'react';
import { useComputers, useConsoles } from '../hooks/useBigFix';
import { Monitor, Search, RefreshCw, Wifi, WifiOff, ChevronDown, ChevronUp, Filter } from 'lucide-react';
import type { BigFixComputer } from '../lib/api';

export default function Computers() {
  const { consoles } = useConsoles();
  const defaultConsole = consoles.find(c => c.is_default) || consoles[0];
  const consoleId = defaultConsole?.id || null;
  const { computers, loading, syncFromConsole } = useComputers(consoleId);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [filterOnline, setFilterOnline] = useState<'all' | 'online' | 'offline'>('all');
  const [sortField, setSortField] = useState<keyof BigFixComputer>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSync = async () => {
    setSyncing(true);
    try { await syncFromConsole(); } catch (e) { console.error(e); } finally { setSyncing(false); }
  };

  const filtered = useMemo(() => {
    let list = [...computers];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.os.toLowerCase().includes(q) || c.ip_address.includes(q) || c.bigfix_id.includes(q));
    }
    if (filterOnline === 'online') list = list.filter(c => c.is_online);
    else if (filterOnline === 'offline') list = list.filter(c => !c.is_online);
    list.sort((a, b) => {
      const aVal = a[sortField] ?? '';
      const bVal = b[sortField] ?? '';
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [computers, search, filterOnline, sortField, sortDir]);

  const toggleSort = (field: keyof BigFixComputer) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const SortIcon = ({ field }: { field: keyof BigFixComputer }) => (
    sortField === field ? (sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />) : null
  );

  const onlineCount = computers.filter(c => c.is_online).length;
  const offlineCount = computers.length - onlineCount;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Computers & Endpoints</h1>
          <p className="text-sm text-gray-500 mt-1">{computers.length} endpoints | {onlineCount} online, {offlineCount} offline</p>
        </div>
        <button onClick={handleSync} disabled={syncing || !consoleId}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium">
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync from Console'}
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search by name, OS, IP, or BigFix ID..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          {(['all', 'online', 'offline'] as const).map(f => (
            <button key={f} onClick={() => setFilterOnline(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filterOnline === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
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
          <Monitor className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-lg font-medium">No computers found</p>
          <p className="text-sm mt-1">{computers.length === 0 ? 'Sync from your BigFix console to populate endpoints.' : 'Try adjusting your search or filters.'}</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('bigfix_id')}>
                    <span className="flex items-center gap-1">ID <SortIcon field="bigfix_id" /></span>
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('name')}>
                    <span className="flex items-center gap-1">Name <SortIcon field="name" /></span>
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('os')}>
                    <span className="flex items-center gap-1">OS <SortIcon field="os" /></span>
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('ip_address')}>
                    <span className="flex items-center gap-1">IP Address <SortIcon field="ip_address" /></span>
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('agent_version')}>
                    <span className="flex items-center gap-1">Agent <SortIcon field="agent_version" /></span>
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('last_report')}>
                    <span className="flex items-center gap-1">Last Report <SortIcon field="last_report" /></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((comp, i) => (
                  <tr key={comp.id} className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-50/30'}`}>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{comp.bigfix_id}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{comp.name}</td>
                    <td className="px-4 py-3 text-gray-600">{comp.os || '-'}</td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">{comp.ip_address || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                        comp.is_online ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {comp.is_online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                        {comp.is_online ? 'Online' : 'Offline'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{comp.agent_version || '-'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{comp.last_report ? new Date(comp.last_report).toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
