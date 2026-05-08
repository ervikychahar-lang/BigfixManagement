import { useState, useEffect, useCallback } from 'react';
import { bigfixApi } from '../lib/api';
import type {
  BigFixConsole,
  BigFixComputer,
  BigFixContent,
  BigFixAction,
  BigFixActionResult,
  BigFixFailureResolution,
  BigFixAppliedResolution,
  BigFixSite,
  ContentType,
  ActionStatus,
  AnalysisResult,
} from '../lib/api';

type ListResponse<T> = { data: T[] };
type ItemResponse<T> = { data: T };

export function useConsoles() {
  const [consoles, setConsoles] = useState<BigFixConsole[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const result = await bigfixApi.listConsoles() as ListResponse<BigFixConsole>;
    setConsoles(result.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const addConsole = async (console: Omit<BigFixConsole, 'id' | 'created_at' | 'last_connected' | 'status' | 'user_id'>) => {
    const result = await bigfixApi.addConsole(console) as ItemResponse<BigFixConsole>;
    await fetch();
    return result.data;
  };

  const updateConsole = async (id: string, updates: Partial<BigFixConsole>) => {
    await bigfixApi.updateConsole(id, updates);
    setConsoles(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  const deleteConsole = async (id: string) => {
    await bigfixApi.deleteConsole(id);
    setConsoles(prev => prev.filter(c => c.id !== id));
  };

  const testConnection = async (id: string) => {
    const result = await bigfixApi.testConnection(id);
    await fetch();
    return result;
  };

  return { consoles, loading, fetch, addConsole, updateConsole, deleteConsole, testConnection };
}

export function useComputers(consoleId: string | null) {
  const [computers, setComputers] = useState<BigFixComputer[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!consoleId) { setComputers([]); setLoading(false); return; }
    setLoading(true);
    const result = await bigfixApi.listComputers(consoleId) as ListResponse<BigFixComputer>;
    setComputers(result.data || []);
    setLoading(false);
  }, [consoleId]);

  useEffect(() => { fetch(); }, [fetch]);

  const syncFromConsole = async () => {
    if (!consoleId) return;
    const result = await bigfixApi.fetchComputers(consoleId);
    await fetch();
    return result;
  };

  return { computers, loading, fetch, syncFromConsole };
}

export function useContent(consoleId: string | null, type?: ContentType, siteId?: string) {
  const [items, setItems] = useState<BigFixContent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!consoleId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const result = await bigfixApi.listContent(consoleId, type, siteId) as ListResponse<BigFixContent>;
    setItems(result.data || []);
    setLoading(false);
  }, [consoleId, type, siteId]);

  useEffect(() => { fetch(); }, [fetch]);

  const syncFromConsole = async (contentType: ContentType, siteId?: string) => {
    if (!consoleId) return;
    const result = await bigfixApi.fetchContent(consoleId, contentType, siteId);
    await fetch();
    return result;
  };

  const deployAction = async (contentId: string, targetComputerIds: string[], actionName?: string) => {
    if (!consoleId) return;
    return bigfixApi.deployAction(consoleId, contentId, targetComputerIds, actionName);
  };

  return { items, loading, fetch, syncFromConsole, deployAction };
}

export function useSites(consoleId: string | null) {
  const [sites, setSites] = useState<BigFixSite[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!consoleId) { setSites([]); setLoading(false); return; }
    setLoading(true);
    const result = await bigfixApi.listSites(consoleId) as ListResponse<BigFixSite>;
    setSites(result.data || []);
    setLoading(false);
  }, [consoleId]);

  useEffect(() => { fetch(); }, [fetch]);

  const syncFromConsole = async () => {
    if (!consoleId) return;
    const result = await bigfixApi.fetchSites(consoleId);
    await fetch();
    return result;
  };

  return { sites, loading, fetch, syncFromConsole };
}

export function useActions(consoleId: string | null, status?: ActionStatus) {
  const [actions, setActions] = useState<BigFixAction[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!consoleId) { setActions([]); setLoading(false); return; }
    setLoading(true);
    const result = await bigfixApi.listActions(consoleId, status) as ListResponse<BigFixAction>;
    setActions(result.data || []);
    setLoading(false);
  }, [consoleId, status]);

  useEffect(() => { fetch(); }, [fetch]);

  const syncFromConsole = async () => {
    if (!consoleId) return;
    const result = await bigfixApi.fetchActions(consoleId);
    await fetch();
    return result;
  };

  const fetchActionStatus = async (actionBigfixId: string) => {
    if (!consoleId) return;
    return bigfixApi.fetchActionStatus(consoleId, actionBigfixId);
  };

  const stopAction = async (actionId: string) => {
    if (!consoleId) return;
    const result = await bigfixApi.stopAction(consoleId, actionId);
    await fetch();
    return result;
  };

  const analyzeFailures = async (actionId: string): Promise<{ success: boolean; analysis: AnalysisResult[]; failedComputers: number; totalComputers: number; actionName: string }> => {
    if (!consoleId) throw new Error('No console');
    const result = await bigfixApi.analyzeFailures(consoleId, actionId) as { success: boolean; analysis: AnalysisResult[]; failedComputers: number; totalComputers: number; actionName: string };
    await fetch();
    return result;
  };

  const redeployAction = async (actionId: string) => {
    if (!consoleId) return;
    const result = await bigfixApi.redeployAction(consoleId, actionId);
    await fetch();
    return result;
  };

  return { actions, loading, fetch, syncFromConsole, fetchActionStatus, stopAction, analyzeFailures, redeployAction };
}

export function useActionResults(actionId: string | null) {
  const [results, setResults] = useState<BigFixActionResult[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!actionId) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const result = await bigfixApi.listActionResults(actionId) as ListResponse<BigFixActionResult>;
    setResults(result.data || []);
    setLoading(false);
  }, [actionId]);

  useEffect(() => { fetch(); }, [fetch]);

  return { results, loading, fetch };
}

export function useFailedResults(consoleId: string | null) {
  const [failures, setFailures] = useState<BigFixActionResult[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!consoleId) { setFailures([]); setLoading(false); return; }
    setLoading(true);
    const result = await bigfixApi.listFailedResults(consoleId) as ListResponse<BigFixActionResult>;
    setFailures(result.data || []);
    setLoading(false);
  }, [consoleId]);

  useEffect(() => { fetch(); }, [fetch]);

  return { failures, loading, fetch };
}

export function useResolutions() {
  const [resolutions, setResolutions] = useState<BigFixFailureResolution[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const result = await bigfixApi.listResolutions() as ListResponse<BigFixFailureResolution>;
    setResolutions(result.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const addResolution = async (resolution: Omit<BigFixFailureResolution, 'id' | 'created_at' | 'updated_at' | 'use_count' | 'success_rate' | 'is_verified'>) => {
    const result = await bigfixApi.addResolution(resolution) as ItemResponse<BigFixFailureResolution>;
    await fetch();
    return result.data;
  };

  const updateResolution = async (id: string, updates: Partial<BigFixFailureResolution>) => {
    await bigfixApi.updateResolution(id, updates);
    await fetch();
  };

  const deleteResolution = async (id: string) => {
    await bigfixApi.deleteResolution(id);
    await fetch();
  };

  const applyFix = async (consoleId: string, actionResultId: string, resolutionId: string, appliedBy: 'manual' | 'auto', redeployAfterFix = false) => {
    return bigfixApi.applyFix(consoleId, actionResultId, resolutionId, appliedBy, redeployAfterFix);
  };

  return { resolutions, loading, fetch, addResolution, updateResolution, deleteResolution, applyFix };
}

export function useAppliedResolutions(actionResultId: string | null) {
  const [applied, setApplied] = useState<BigFixAppliedResolution[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!actionResultId) { setApplied([]); setLoading(false); return; }
    setLoading(true);
    const result = await bigfixApi.listAppliedResolutions(actionResultId) as ListResponse<BigFixAppliedResolution>;
    setApplied(result.data || []);
    setLoading(false);
  }, [actionResultId]);

  useEffect(() => { fetch(); }, [fetch]);

  return { applied, loading, fetch };
}

export function useDashboardStats(consoleId: string | null) {
  const [stats, setStats] = useState({
    totalComputers: 0,
    onlineComputers: 0,
    totalFixlets: 0,
    totalTasks: 0,
    totalBaselines: 0,
    totalPatches: 0,
    activeActions: 0,
    failedActions: 0,
    criticalContent: 0,
    totalActions: 0,
    completedActions: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!consoleId) { setLoading(false); return; }
    setLoading(true);
    const result = await bigfixApi.dashboardStats(consoleId) as { data: typeof stats };
    setStats(result.data);
    setLoading(false);
  }, [consoleId]);

  useEffect(() => { fetch(); }, [fetch]);

  return { stats, loading, fetch };
}
