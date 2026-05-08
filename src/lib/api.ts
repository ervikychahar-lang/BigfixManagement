import { supabase } from './supabase';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const configuredProxyUrl = import.meta.env.VITE_BIGFIX_PROXY_URL;
const functionUrl = configuredProxyUrl
  ? configuredProxyUrl.replace(/\/$/, '')
  : supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/functions/v1/bigfix-proxy` : '';

async function callEdgeFunction(action: string, payload: Record<string, unknown>) {
  if (!functionUrl) {
    throw new Error('Missing Supabase URL. Set VITE_SUPABASE_URL.');
  }

  const sessionResult = supabase ? await supabase.auth.getSession() : null;
  const token = sessionResult?.data.session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY || 'local';
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal,
    });

    const text = await response.text();
    const result = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(result.error || `Edge function returned ${response.status}`);
    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Connection timed out after 60 seconds. Check BigFix reachability and firewall rules.');
    }
    if (error instanceof SyntaxError) {
      throw new Error('Edge function returned an invalid response. Check Supabase function logs.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export const bigfixApi = {
  listConsoles: () => callEdgeFunction('list-consoles', {}),
  addConsole: (console: Record<string, unknown>) => callEdgeFunction('add-console', { console }),
  updateConsole: (id: string, updates: Record<string, unknown>) => callEdgeFunction('update-console', { id, updates }),
  deleteConsole: (id: string) => callEdgeFunction('delete-console', { id }),
  listComputers: (consoleId: string) => callEdgeFunction('list-computers', { consoleId }),
  listContent: (consoleId: string, type?: string, siteId?: string) => callEdgeFunction('list-content', { consoleId, type, siteId }),
  listApplicableComputers: (consoleId: string, contentId: string) => callEdgeFunction('list-applicable-computers', { consoleId, contentId }),
  listActions: (consoleId: string, status?: string) => callEdgeFunction('list-actions', { consoleId, status }),
  listActionResults: (actionId: string) => callEdgeFunction('list-action-results', { actionId }),
  listFailedResults: (consoleId: string) => callEdgeFunction('list-failed-results', { consoleId }),
  listResolutions: () => callEdgeFunction('list-resolutions', {}),
  addResolution: (resolution: Record<string, unknown>) => callEdgeFunction('add-resolution', { resolution }),
  updateResolution: (id: string, updates: Record<string, unknown>) => callEdgeFunction('update-resolution', { id, updates }),
  deleteResolution: (id: string) => callEdgeFunction('delete-resolution', { id }),
  listAppliedResolutions: (actionResultId: string) => callEdgeFunction('list-applied-resolutions', { actionResultId }),
  dashboardStats: (consoleId: string) => callEdgeFunction('dashboard-stats', { consoleId }),
  listSites: (consoleId: string) => callEdgeFunction('list-sites', { consoleId }),
  testConnection: (consoleId: string) => callEdgeFunction('test-connection', { consoleId }),
  fetchComputers: (consoleId: string) => callEdgeFunction('fetch-computers', { consoleId }),
  fetchContent: (consoleId: string, type: string, siteId?: string) => callEdgeFunction('fetch-content', { consoleId, type, siteId }),
  deployAction: (consoleId: string, contentId: string, targetComputerIds: string[], actionName?: string) =>
    callEdgeFunction('deploy-action', { consoleId, contentId, targetComputerIds, actionName }),
  fetchActions: (consoleId: string) => callEdgeFunction('fetch-actions', { consoleId }),
  fetchActionStatus: (consoleId: string, actionBigfixId: string) =>
    callEdgeFunction('fetch-action-status', { consoleId, actionBigfixId }),
  stopAction: (consoleId: string, actionId: string) => callEdgeFunction('stop-action', { consoleId, actionId }),
  analyzeFailures: (consoleId: string, actionId: string) => callEdgeFunction('analyze-failures', { consoleId, actionId }),
  applyFix: (consoleId: string, actionResultId: string, resolutionId: string, appliedBy: string, redeployAfterFix = false) =>
    callEdgeFunction('apply-fix', { consoleId, actionResultId, resolutionId, appliedBy, redeployAfterFix }),
  applyGeneratedFix: (consoleId: string, actionResultId: string, proposedResolution: Record<string, unknown>, redeployAfterFix = true) =>
    callEdgeFunction('apply-generated-fix', { consoleId, actionResultId, proposedResolution, redeployAfterFix }),
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
  sites?: string[];
  created_at: string;
  updated_at: string;
}

export interface BigFixSite {
  id: string;
  console_id: string;
  name: string;
  display_name: string;
  type: string;
  created_at: string;
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
  is_hidden?: boolean;
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
  log_excerpt?: string;
  line_number?: number;
  state?: string;
  retry_count: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  bigfix_computers?: Pick<BigFixComputer, 'name' | 'os' | 'ip_address' | 'bigfix_id'>;
  bigfix_actions?: Pick<BigFixAction, 'name' | 'type' | 'status' | 'bigfix_id' | 'console_id' | 'created_by' | 'start_time'>;
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
  actionResultId?: string;
  computerId: string;
  computerName: string;
  status: string;
  isError: boolean;
  state: string;
  lineNumber: number;
  logExcerpt?: string;
  retryCount: number;
  rootCause?: string;
  confidence?: string;
  evidence?: string[];
  detail?: string;
  computerOnline?: boolean;
  proposedResolution: {
    title: string;
    description: string;
    type: string;
    steps: string[];
    script: string;
    resolutionId?: string;
    generatedScript?: boolean;
  } | null;
}
