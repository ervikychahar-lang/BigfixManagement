import { supabase } from './supabase';

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bigfix-proxy`;

async function callEdgeFunction(action: string, payload: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });

  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Edge function error');
  return result;
}

export const bigfixApi = {
  testConnection: (consoleId: string) => callEdgeFunction('test-connection', { consoleId }),
  fetchComputers: (consoleId: string) => callEdgeFunction('fetch-computers', { consoleId }),
  fetchContent: (consoleId: string, type: string) => callEdgeFunction('fetch-content', { consoleId, type }),
  deployAction: (consoleId: string, contentId: string, targetComputerIds: string[], actionName?: string) =>
    callEdgeFunction('deploy-action', { consoleId, contentId, targetComputerIds, actionName }),
  fetchActions: (consoleId: string) => callEdgeFunction('fetch-actions', { consoleId }),
  fetchActionStatus: (consoleId: string, actionBigfixId: string) =>
    callEdgeFunction('fetch-action-status', { consoleId, actionBigfixId }),
  stopAction: (consoleId: string, actionId: string) => callEdgeFunction('stop-action', { consoleId, actionId }),
  analyzeFailures: (consoleId: string, actionId: string) => callEdgeFunction('analyze-failures', { consoleId, actionId }),
  applyFix: (consoleId: string, actionResultId: string, resolutionId: string, appliedBy: string) =>
    callEdgeFunction('apply-fix', { consoleId, actionResultId, resolutionId, appliedBy }),
  redeployAction: (consoleId: string, actionId: string) => callEdgeFunction('redeploy-action', { consoleId, actionId }),
  fetchSites: (consoleId: string) => callEdgeFunction('fetch-sites', { consoleId }),
};

export type ContentSeverity = 'critical' | 'important' | 'normal' | 'low';
export type ContentType = 'fixlet' | 'task' | 'baseline' | 'patch';
export type ActionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'expired' | 'stopped';
export type ResultStatus = 'Completed' | 'Failed' | 'Running' | 'NotRun' | 'Pending' | 'Downloaded';
export type ResolutionType = 'manual' | 'auto';

export interface BigFixConsole {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password_encrypted: string;
  is_default: boolean;
  last_connected: string | null;
  status: 'connected' | 'disconnected' | 'error';
  created_at: string;
  user_id: string | null;
}

export interface BigFixComputer {
  id: string;
  console_id: string;
  bigfix_id: string;
  name: string;
  os: string;
  ip_address: string;
  subnet: string;
  last_report: string | null;
  is_online: boolean;
  agent_version: string;
  custom_site_count: number;
  created_at: string;
  updated_at: string;
}

export interface BigFixContent {
  id: string;
  console_id: string;
  bigfix_id: string;
  site_id: string;
  type: ContentType;
  name: string;
  description: string;
  severity: ContentSeverity;
  category: string;
  source_id: string;
  source_name: string;
  relevance: string;
  action_script: string;
  is_applicable_count: number;
  is_enabled: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface BigFixAction {
  id: string;
  console_id: string;
  bigfix_id: string;
  content_id: string | null;
  name: string;
  type: string;
  status: ActionStatus;
  target_count: number;
  completed_count: number;
  failed_count: number;
  running_count: number;
  not_run_count: number;
  start_time: string | null;
  end_time: string | null;
  created_by: string;
  is_distributed: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface BigFixActionResult {
  id: string;
  action_id: string;
  computer_id: string;
  status: ResultStatus;
  result_code: string;
  error_message: string;
  retry_count: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  bigfix_computers?: Pick<BigFixComputer, 'name' | 'os' | 'ip_address' | 'bigfix_id'>;
  bigfix_actions?: Pick<BigFixAction, 'name' | 'type' | 'status' | 'bigfix_id' | 'console_id'>;
}

export interface BigFixFailureResolution {
  id: string;
  error_code: string;
  error_pattern: string;
  title: string;
  description: string;
  resolution_type: ResolutionType;
  resolution_script: string;
  resolution_steps: string[];
  is_verified: boolean;
  use_count: number;
  success_rate: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BigFixAppliedResolution {
  id: string;
  action_result_id: string;
  resolution_id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  applied_by: 'manual' | 'auto';
  output: string;
  created_at: string;
  completed_at: string | null;
  bigfix_failure_resolutions?: BigFixFailureResolution;
}

export interface AnalysisResult {
  computerId: string;
  computerName: string;
  status: string;
  isError: boolean;
  state: string;
  lineNumber: number;
  retryCount: number;
  proposedResolution: {
    title: string;
    description: string;
    type: string;
    steps: string[];
    script: string;
  } | null;
}
