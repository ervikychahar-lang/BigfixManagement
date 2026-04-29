import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { bigfixApi } from '../lib/api';
import type { BigFixConsole, BigFixComputer, BigFixContent, BigFixAction, BigFixActionResult, BigFixFailureResolution, BigFixAppliedResolution, ContentType, ActionStatus, AnalysisResult } from '../lib/api';

export function useConsoles() {
  const [consoles, setConsoles] = useState<BigFixConsole[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('bigfix_consoles').select('*').order('created_at', { ascending: false });
    if (!error && data) setConsoles(data as BigFixConsole[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const addConsole = async (console: Omit<BigFixConsole, 'id' | 'created_at' | 'last_connected' | 'status' | 'user_id'>) => {
    const { data, error } = await supabase.from('bigfix_consoles').insert(console).select().maybeSingle();
    if (error) throw error;
    if (data) setConsoles(prev => [data as BigFixConsole, ...prev]);
    return data;
  };

  const updateConsole = async (id: string, updates: Partial<BigFixConsole>) => {
    const { error } = await supabase.from('bigfix_consoles').update(updates).eq('id', id);
    if (error) throw error;
    setConsoles(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  const deleteConsole = async (id: string) => {
    const { error } = await supabase.from('bigfix_consoles').delete().eq('id', id);
    if (error) throw error;
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
    const { data, error } = await supabase.from('bigfix_computers').select('*').eq('console_id', consoleId).order('name');
    if (!error && data) setComputers(data as BigFixComputer[]);
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

export function useContent(consoleId: string | null, type?: ContentType) {
  const [items, setItems] = useState<BigFixContent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!consoleId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    let query = supabase.from('bigfix_content').select('*').eq('console_id', consoleId);
    if (type) query = query.eq('type', type);
    query = query.order('created_at', { ascending: false });
    const { data, error } = await query;
    if (!error && data) setItems(data as BigFixContent[]);
    setLoading(false);
  }, [consoleId, type]);

  useEffect(() => { fetch(); }, [fetch]);

  const syncFromConsole = async (contentType: ContentType) => {
    if (!consoleId) return;
    const result = await bigfixApi.fetchContent(consoleId, contentType);
    await fetch();
    return result;
  };

  const deployAction = async (contentId: string, targetComputerIds: string[], actionName?: string) => {
    if (!consoleId) return;
    const result = await bigfixApi.deployAction(consoleId, contentId, targetComputerIds, actionName);
    return result;
  };

  return { items, loading, fetch, syncFromConsole, deployAction };
}

export function useActions(consoleId: string | null, status?: ActionStatus) {
  const [actions, setActions] = useState<BigFixAction[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!consoleId) { setActions([]); setLoading(false); return; }
    setLoading(true);
    let query = supabase.from('bigfix_actions').select('*').eq('console_id', consoleId);
    if (status) query = query.eq('status', status);
    query = query.order('created_at', { ascending: false });
    const { data, error } = await query;
    if (!error && data) setActions(data as BigFixAction[]);
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
    const result = await bigfixApi.fetchActionStatus(consoleId, actionBigfixId);
    return result;
  };

  const stopAction = async (actionId: string) => {
    if (!consoleId) return;
    const result = await bigfixApi.stopAction(consoleId, actionId);
    await fetch();
    return result;
  };

  const analyzeFailures = async (actionId: string): Promise<{ success: boolean; analysis: AnalysisResult[]; failedComputers: number; totalComputers: number; actionName: string }> => {
    if (!consoleId) throw new Error('No console');
    const result = await bigfixApi.analyzeFailures(consoleId, actionId);
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
    const { data, error } = await supabase.from('bigfix_action_results')
      .select('*, bigfix_computers(name, os, ip_address, bigfix_id), bigfix_actions(name, type, status, bigfix_id, console_id)')
      .eq('action_id', actionId)
      .order('created_at', { ascending: false });
    if (!error && data) setResults(data as unknown as BigFixActionResult[]);
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
    const { data, error } = await supabase.from('bigfix_action_results')
      .select('*, bigfix_computers(name, os, ip_address, bigfix_id), bigfix_actions!inner(name, type, status, bigfix_id, console_id)')
      .eq('status', 'Failed')
      .eq('bigfix_actions.console_id', consoleId)
      .order('created_at', { ascending: false });
    if (!error && data) setFailures(data as unknown as BigFixActionResult[]);
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
    const { data, error } = await supabase.from('bigfix_failure_resolutions').select('*').order('use_count', { ascending: false });
    if (!error && data) setResolutions(data as BigFixFailureResolution[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const addResolution = async (resolution: Omit<BigFixFailureResolution, 'id' | 'created_at' | 'updated_at' | 'use_count' | 'success_rate' | 'is_verified'>) => {
    const { data, error } = await supabase.from('bigfix_failure_resolutions').insert(resolution).select().maybeSingle();
    if (error) throw error;
    await fetch();
    return data;
  };

  const updateResolution = async (id: string, updates: Partial<BigFixFailureResolution>) => {
    const { error } = await supabase.from('bigfix_failure_resolutions').update(updates).eq('id', id);
    if (error) throw error;
    await fetch();
  };

  const deleteResolution = async (id: string) => {
    const { error } = await supabase.from('bigfix_failure_resolutions').delete().eq('id', id);
    if (error) throw error;
    await fetch();
  };

  const applyFix = async (consoleId: string, actionResultId: string, resolutionId: string, appliedBy: 'manual' | 'auto') => {
    const result = await bigfixApi.applyFix(consoleId, actionResultId, resolutionId, appliedBy);
    return result;
  };

  return { resolutions, loading, fetch, addResolution, updateResolution, deleteResolution, applyFix };
}

export function useAppliedResolutions(actionResultId: string | null) {
  const [applied, setApplied] = useState<BigFixAppliedResolution[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!actionResultId) { setApplied([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('bigfix_applied_resolutions')
      .select('*, bigfix_failure_resolutions(*)')
      .eq('action_result_id', actionResultId)
      .order('created_at', { ascending: false });
    if (!error && data) setApplied(data as unknown as BigFixAppliedResolution[]);
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
    const [computersRes, contentRes, actionsRes] = await Promise.all([
      supabase.from('bigfix_computers').select('id, is_online', { count: 'exact' }).eq('console_id', consoleId),
      supabase.from('bigfix_content').select('type, severity', { count: 'exact' }).eq('console_id', consoleId),
      supabase.from('bigfix_actions').select('status', { count: 'exact' }).eq('console_id', consoleId),
    ]);

    const computers = computersRes.data || [];
    const content = contentRes.data || [];
    const actions = actionsRes.data || [];

    setStats({
      totalComputers: computersRes.count || 0,
      onlineComputers: computers.filter(c => c.is_online).length,
      totalFixlets: content.filter(c => c.type === 'fixlet').length,
      totalTasks: content.filter(c => c.type === 'task').length,
      totalBaselines: content.filter(c => c.type === 'baseline').length,
      totalPatches: content.filter(c => c.type === 'patch').length,
      activeActions: actions.filter(a => a.status === 'running' || a.status === 'pending').length,
      failedActions: actions.filter(a => a.status === 'failed').length,
      criticalContent: content.filter(c => c.severity === 'critical').length,
      totalActions: actionsRes.count || 0,
      completedActions: actions.filter(a => a.status === 'completed').length,
    });
    setLoading(false);
  }, [consoleId]);

  useEffect(() => { fetch(); }, [fetch]);

  return { stats, loading, fetch };
}
