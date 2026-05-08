import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const port = Number(process.env.BIGFIX_PROXY_PORT || 8787);
const host = process.env.BIGFIX_PROXY_HOST || '127.0.0.1';
const rejectUnauthorized = process.env.BIGFIX_TLS_REJECT_UNAUTHORIZED === 'true';
const dbPath = process.env.BIGFIX_LOCAL_DB || path.join(process.cwd(), 'data', 'local-db.json');

const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.BIGFIX_PROXY_ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const emptyDb = {
  bigfix_consoles: [],
  bigfix_sites: [],
  bigfix_computers: [],
  bigfix_content: [],
  bigfix_actions: [],
  bigfix_action_results: [],
  bigfix_failure_resolutions: [],
  bigfix_applied_resolutions: [],
  analyzer_config: null,
};

const defaultFailureResolutions = [
  {
    error_code: '1603',
    error_pattern: '1603|fatal error during installation|msi.*fatal',
    title: 'MSI fatal install failure',
    description: 'Windows Installer returned a fatal install error. The common causes are pending reboot, locked files, missing prerequisites, or insufficient install permissions.',
    resolution_type: 'manual',
    resolution_script: '',
    resolution_steps: [
      'Check the action log around the failing line for the exact MSI command and return code.',
      'Confirm the endpoint has no pending reboot and enough free disk space.',
      'Run the installer manually with verbose logging if the vendor package needs more detail.',
      'Retry after closing conflicting applications or clearing the pending reboot condition.',
    ],
    is_verified: true,
  },
  {
    error_code: '1618',
    error_pattern: '1618|another installation is already in progress|msiexec',
    title: 'MSI install already running',
    description: 'Another Windows Installer transaction is active, so the deployment cannot start cleanly yet.',
    resolution_type: 'manual',
    resolution_script: '',
    resolution_steps: [
      'Wait for the existing MSI installation to complete.',
      'Check Task Manager or services for active msiexec.exe work.',
      'Reboot the endpoint if Windows Installer is stuck, then redeploy.',
    ],
    is_verified: true,
  },
  {
    error_code: '',
    error_pattern: 'download|hash|sha1|sha256|size mismatch|http|url',
    title: 'Download or prefetch failure',
    description: 'The action failed before execution because the payload could not be downloaded or verified.',
    resolution_type: 'manual',
    resolution_script: '',
    resolution_steps: [
      'Open the action log and verify the failing URL, hash, or prefetch line.',
      'Confirm the BigFix server/relay can download the payload and the endpoint can reach its relay.',
      'Clear stale relay cache only after confirming the source URL and hash are correct.',
      'Retry the action after relay connectivity is healthy.',
    ],
    is_verified: true,
  },
  {
    error_code: '',
    error_pattern: 'disk|space|not enough storage|insufficient',
    title: 'Endpoint disk space issue',
    description: 'The endpoint likely does not have enough free space for download, extraction, or installation.',
    resolution_type: 'manual',
    resolution_script: '',
    resolution_steps: [
      'Check free space on the system drive and the BigFix client folder drive.',
      'Clean temporary files or expand the disk.',
      'Retry the action after space is available.',
    ],
    is_verified: true,
  },
  {
    error_code: '',
    error_pattern: 'besclient|client.*stuck|agent.*stuck|not responding',
    title: 'Restart BigFix Client service',
    description: 'Use when the endpoint agent appears stuck or is not processing actions correctly.',
    resolution_type: 'auto',
    resolution_script: 'if {windows of operating system}\nwaithidden sc.exe stop BESClient\npause while {exists running service "BESClient"}\nwaithidden sc.exe start BESClient\nendif',
    resolution_steps: [
      'Deploy the service restart to the affected endpoint.',
      'Refresh action status after the client reports back.',
    ],
    is_verified: true,
  },
];

function readDb() {
  const db = fs.existsSync(dbPath)
    ? { ...structuredClone(emptyDb), ...JSON.parse(fs.readFileSync(dbPath, 'utf8')) }
    : structuredClone(emptyDb);
  return normalizeDb(db);
}

function writeDb(db) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, JSON.stringify(normalizeDb(db), null, 2));
}

function normalizeDb(db) {
  db.analyzer_config = db.analyzer_config || {
    mode: 'local',
    provider: 'none',
    base_url: '',
    api_key: '',
    auth_header: 'Authorization',
    org_id: '',
    timeout_seconds: 30,
    enabled: false,
    updated_at: now(),
  };
  if (!db.bigfix_failure_resolutions || db.bigfix_failure_resolutions.length === 0) {
    db.bigfix_failure_resolutions = defaultFailureResolutions.map(item => ({
      id: randomUUID(),
      ...item,
      use_count: 0,
      success_rate: 0,
      created_by: null,
      created_at: now(),
      updated_at: now(),
    }));
  }
  db.bigfix_computers = (db.bigfix_computers || []).map(computer => {
    const ipLooksLikeDate = computer.ip_address && !Number.isNaN(Date.parse(computer.ip_address));
    return {
      ...computer,
      ip_address: ipLooksLikeDate ? '' : computer.ip_address,
      is_online: Boolean(computer.is_online) || isRecentReport(computer.last_report),
    };
  });
  db.bigfix_content = (db.bigfix_content || []).map(item => ({
    ...item,
    site_id: decodeBigFixValue(item.site_id),
    source_name: decodeBigFixValue(item.source_name),
    is_hidden: Boolean(item.is_hidden),
  }));
  db.bigfix_action_results = (db.bigfix_action_results || []).map(result => ({
    ...result,
    status: normalizeResultStatus(result.status),
  }));
  db.bigfix_actions = (db.bigfix_actions || []).map(action => {
    const results = db.bigfix_action_results.filter(result => result.action_id === action.id);
    if (results.length === 0) return action;
    const completed = results.filter(result => result.status === 'Completed').length;
    const failed = results.filter(result => result.status === 'Failed').length;
    const running = results.filter(result => result.status === 'Running').length;
    const pending = results.filter(result => result.status === 'Pending' || result.status === 'NotRun').length;
    return {
      ...action,
      target_count: results.length,
      completed_count: completed,
      failed_count: failed,
      running_count: running,
      not_run_count: pending,
      status: deriveActionStatusFromResults(results, action.status),
    };
  });
  return db;
}

function normalizeResultStatus(status) {
  const value = String(status || '').toLowerCase();
  if (!value) return 'Pending';
  if (value.includes('failed') || value.includes('error')) return 'Failed';
  if (value.includes('fixed') || value.includes('completed') || value.includes('complete')) return 'Completed';
  if (value.includes('running') || value.includes('evaluating') || value.includes('waiting') || value.includes('active')) return 'Running';
  if (value.includes('notrun') || value.includes('not run') || value.includes('not started') || value.includes('not relevant')) return 'NotRun';
  if (value.includes('downloaded')) return 'Downloaded';
  if (value.includes('pending') || value.includes('open')) return 'Pending';
  return status || 'Pending';
}

function deriveActionStatusFromResults(results, fallback = 'pending') {
  const normalizedFallback = normalizeResultStatus(fallback);
  if (results.length === 0) {
    if (normalizedFallback === 'Failed') return 'failed';
    if (normalizedFallback === 'Completed') return 'completed';
    if (normalizedFallback === 'Running') return 'running';
    if (normalizedFallback === 'NotRun' || normalizedFallback === 'Downloaded' || normalizedFallback === 'Pending') return 'pending';
    return String(fallback || 'pending').toLowerCase();
  }
  const failed = results.filter(result => result.status === 'Failed').length;
  const running = results.filter(result => result.status === 'Running').length;
  const completed = results.filter(result => result.status === 'Completed').length;
  const pending = results.filter(result => ['Pending', 'NotRun', 'Downloaded'].includes(result.status)).length;
  if (running > 0 || pending > 0) return 'running';
  if (failed > 0) return 'failed';
  if (completed === results.length) return 'completed';
  return deriveActionStatusFromResults([], fallback);
}

function deriveActionStatusFromSummary(action) {
  const failed = parseInt(action.FailedCount, 10) || 0;
  const running = parseInt(action.RunningCount, 10) || 0;
  const completed = parseInt(action.CompletedCount, 10) || 0;
  const notRun = parseInt(action.NotRunCount, 10) || 0;
  const target = parseInt(action.TargetCount, 10) || 0;
  if (running > 0) return 'running';
  if (failed > 0) return 'failed';
  if (target > 0 && completed === target) return 'completed';
  if (notRun > 0 || target > 0) return 'pending';
  return deriveActionStatusFromResults([], action.Status || 'pending');
}

function now() {
  return new Date().toISOString();
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { ...corsHeaders, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function normalizeBigFixHost(value) {
  return String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\/api\/?$/i, '').replace(/\/$/, '');
}

function bigfixUrl(consoleConfig, apiPath) {
  const normalizedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  return new URL(`https://${normalizeBigFixHost(consoleConfig.host)}:${consoleConfig.port}/api${normalizedPath}`);
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function explainBigFixError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('self-signed') || lower.includes('certificate') || lower.includes('tls')) {
    return `${message}. Local lab ke liye BIGFIX_TLS_REJECT_UNAUTHORIZED=false rakho. Production me trusted certificate use karo.`;
  }
  if (lower.includes('timeout')) {
    return `${message}. Host, port 52311, firewall, aur Hyper-V route check karo.`;
  }
  return message;
}

function bigfixRequest(consoleConfig, apiPath, method = 'GET', body) {
  const url = bigfixUrl(consoleConfig, apiPath);
  const credentials = Buffer.from(`${consoleConfig.username}:${consoleConfig.password_encrypted}`).toString('base64');
  const requestBody = body ? Buffer.from(body) : undefined;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      rejectUnauthorized,
      timeout: 45000,
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/xml',
        ...(requestBody ? { 'Content-Length': requestBody.length } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`BigFix API error ${response.statusCode}: ${text.slice(0, 500)}`));
          return;
        }
        resolve(text);
      });
    });

    req.on('timeout', () => req.destroy(new Error(`BigFix request timed out after 45 seconds for ${url.href}`)));
    req.on('error', reject);
    if (requestBody) req.write(requestBody);
    req.end();
  });
}

function parseTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match ? cleanXmlText(match[1]) : '';
}

function cleanXmlText(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAttributes(attrText) {
  const attrs = {};
  const attrRegex = /(\w+)="([^"]*)"/g;
  let match;
  while ((match = attrRegex.exec(attrText || '')) !== null) attrs[match[1]] = match[2];
  return attrs;
}

function idFromResource(resource) {
  return String(resource || '').split('/').filter(Boolean).pop() || '';
}

function decodeBigFixValue(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
}

function isRecentReport(value) {
  const time = Date.parse(String(value || ''));
  if (Number.isNaN(time)) return false;
  return Date.now() - time < 24 * 60 * 60 * 1000;
}

function parseBlocks(xml, regex, tags) {
  const items = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const block = match[1];
    const item = {};
    for (const tag of tags) item[tag] = parseTag(block, tag);
    items.push(item);
  }
  return items;
}

function parseComputersXML(xml) {
  const computers = [];
  const regex = /<Computer\b([^>]*)>([\s\S]*?)<\/Computer>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const attrs = parseAttributes(match[1]);
    const block = match[2];
    const id = parseTag(block, 'ID') || idFromResource(attrs.Resource);
    computers.push({
      Name: parseTag(block, 'Name') || parseTag(block, 'ComputerName') || id,
      ID: id,
      OS: parseTag(block, 'OS') || parseTag(block, 'OperatingSystem'),
      IPAddress: parseTag(block, 'IPAddress') || parseTag(block, 'IPAddresses'),
      Subnet: parseTag(block, 'Subnet'),
      AgentVersion: parseTag(block, 'AgentVersion') || parseTag(block, 'ClientVersion'),
      LastReport: parseTag(block, 'LastReport') || parseTag(block, 'LastReportTime'),
      IsOnline: parseTag(block, 'IsOnline') || parseTag(block, 'Active') || 'false',
      CustomSiteCount: parseTag(block, 'CustomSiteCount') || '0',
    });
  }
  return computers;
}

function parseContentXML(xml) {
  const items = [];
  const regex = /<(Fixlet|Task|Baseline|Patch)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const attrs = parseAttributes(match[2]);
    const block = match[3];
    const resourceParts = String(attrs.Resource || '').split('/').filter(Boolean);
    const id = parseTag(block, 'ID') || resourceParts.at(-1) || '';
    const siteName = decodeBigFixValue(parseTag(block, 'SourceName') || parseTag(block, 'SiteName') || resourceParts.at(-2) || '');
    items.push({
      Name: parseTag(block, 'Name') || parseTag(block, 'Title') || id,
      ID: id,
      Description: parseTag(block, 'Description'),
      Severity: parseTag(block, 'Severity') || parseTag(block, 'SourceSeverity') || 'normal',
      Category: parseTag(block, 'Category'),
      SourceID: parseTag(block, 'SourceID'),
      SourceName: siteName,
      Relevance: parseTag(block, 'Relevance'),
      ActionScript: parseTag(block, 'ActionScript'),
      SiteID: parseTag(block, 'SiteID') || siteName,
      IsApplicableCount: parseTag(block, 'IsApplicableCount') || '0',
      IsEnabled: parseTag(block, 'IsEnabled') || 'true',
      IsHidden: parseTag(block, 'IsHidden') || parseTag(block, 'Hidden') || 'false',
    });
  }
  return items;
}

function parseActionsXML(xml) {
  const actions = [];
  const regex = /<Action\b([^>]*)>([\s\S]*?)<\/Action>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const attrs = parseAttributes(match[1]);
    const block = match[2];
    const id = parseTag(block, 'ID') || idFromResource(attrs.Resource);
    actions.push({
      Name: parseTag(block, 'Name') || parseTag(block, 'Title') || id,
      ID: id,
      Type: parseTag(block, 'Type') || 'fixlet',
      Status: parseTag(block, 'Status') || parseTag(block, 'State') || 'pending',
      TargetCount: parseTag(block, 'TargetCount') || '0',
      CompletedCount: parseTag(block, 'CompletedCount') || '0',
      FailedCount: parseTag(block, 'FailedCount') || '0',
      RunningCount: parseTag(block, 'RunningCount') || '0',
      NotRunCount: parseTag(block, 'NotRunCount') || '0',
      StartTime: parseTag(block, 'StartTime') || parseTag(block, 'StartDateTime'),
      EndTime: parseTag(block, 'EndTime'),
      CreatedBy: parseTag(block, 'CreatedBy') || parseTag(block, 'Issuer'),
      IsDistributed: parseTag(block, 'IsDistributed') || 'false',
    });
  }
  return actions;
}

function parseActionResultBlock(block, attrs = {}) {
  const result = {
    ComputerID: attrs.ComputerID || attrs.ID || parseTag(block, 'ComputerID') || parseTag(block, 'ID') || idFromResource(attrs.Resource),
    ComputerName: attrs.ComputerName || attrs.Name || parseTag(block, 'ComputerName') || parseTag(block, 'Name'),
    Status: parseTag(block, 'Status'),
    State: parseTag(block, 'State'),
    LineNumber: parseTag(block, 'LineNumber') || parseTag(block, 'Line'),
    ResultCode: parseTag(block, 'ResultCode') || parseTag(block, 'ExitCode'),
    ErrorMessage: parseTag(block, 'ErrorMessage') || parseTag(block, 'Error'),
    RetryCount: parseTag(block, 'RetryCount') || '0',
    StartedAt: parseTag(block, 'StartTime') || parseTag(block, 'StartedAt'),
    CompletedAt: parseTag(block, 'EndTime') || parseTag(block, 'CompletedAt'),
  };
  result.LogExcerpt = buildLogExcerpt(result, extractActionLogDetail(block));
  return result;
}

function parseActionStatusXML(xml) {
  const resultBlocks = [];
  const resultRegex = /<Result\b([^>]*)>([\s\S]*?)<\/Result>/g;
  let resultMatch;
  while ((resultMatch = resultRegex.exec(xml)) !== null) {
    resultBlocks.push(parseActionResultBlock(resultMatch[2], parseAttributes(resultMatch[1])));
  }
  if (resultBlocks.length > 0) return resultBlocks;

  const computerBlocks = [];
  const computerRegex = /<Computer\b([^>]*)>([\s\S]*?)<\/Computer>/g;
  let match;
  while ((match = computerRegex.exec(xml)) !== null) {
    const attrs = parseAttributes(match[1]);
    const block = match[2];
    computerBlocks.push(parseActionResultBlock(block, attrs));
  }
  return computerBlocks;
}

function extractActionLogDetail(block) {
  const tags = [
    'Log',
    'ActionLog',
    'ActionLogText',
    'LogText',
    'LogExcerpt',
    'ExecutionLog',
    'Output',
    'StdOut',
    'StdErr',
    'ResultText',
    'ErrorText',
    'LastError',
    'FailureReason',
    'Message',
    'DownloadStatus',
  ];
  const details = [];
  for (const tag of tags) {
    const value = parseTag(block, tag);
    if (value && !details.includes(value)) details.push(value);
  }
  return details.join(' | ').slice(0, 4000);
}

function buildLogExcerpt(result, logDetail = '') {
  const parts = [];
  if (result.Status) parts.push(`Status: ${result.Status}`);
  if (result.State) parts.push(`State: ${result.State}`);
  if (result.LineNumber) parts.push(`Line: ${result.LineNumber}`);
  if (result.ResultCode) parts.push(`Exit/Result code: ${result.ResultCode}`);
  if (result.ErrorMessage) parts.push(`Message: ${result.ErrorMessage}`);
  if (logDetail) parts.push(`Log detail: ${logDetail}`);
  return parts.join(' | ');
}

function parseSitesXML(xml, consoleId) {
  const sites = [];
  const siteRegex = /<(CustomSite|ExternalSite|OperatorSite|MasterActionSite)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let match;
  while ((match = siteRegex.exec(xml)) !== null) {
    const type = match[1];
    const attrs = match[2];
    const block = match[3];
    const resource = attrs.match(/Resource="([^"]+)"/)?.[1] || '';
    const name = parseTag(block, 'Name') || parseTag(block, 'DisplayName') || resource.split('/').pop() || type;
    const displayName = parseTag(block, 'DisplayName') || parseTag(block, 'Name') || name;
    sites.push({
      id: `${consoleId}:${type}:${name}`,
      console_id: consoleId,
      name,
      display_name: displayName,
      type,
      created_at: now(),
    });
  }
  return sites;
}

function parseTupleQueryXML(xml) {
  const rows = [];
  const tupleRegex = /<Tuple>([\s\S]*?)<\/Tuple>/g;
  let tupleMatch;
  while ((tupleMatch = tupleRegex.exec(xml)) !== null) {
    const answers = [];
    const answerRegex = /<Answer\b[^>]*>([\s\S]*?)<\/Answer>/g;
    let answerMatch;
    while ((answerMatch = answerRegex.exec(tupleMatch[1])) !== null) {
      answers.push(answerMatch[1].trim());
    }
    if (answers.length) rows.push(answers);
  }
  if (rows.length > 0) return rows;
  const answers = [];
  const answerRegex = /<Answer\b[^>]*>([\s\S]*?)<\/Answer>/g;
  let answerMatch;
  while ((answerMatch = answerRegex.exec(xml)) !== null) answers.push([answerMatch[1].trim()]);
  return answers;
}

async function fetchComputerDetails(consoleConfig, computerId) {
  try {
    const xml = await bigfixRequest(consoleConfig, `/computer/${computerId}`);
    const parsed = parseComputersXML(xml)[0];
    if (parsed) return parsed;
    const prop = (names) => {
      for (const name of names) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = xml.match(new RegExp(`<Property[^>]*(?:Name|Resource)="${escaped}"[^>]*>([\\s\\S]*?)<\\/Property>`, 'i'));
        if (match) return match[1].trim();
      }
      return '';
    };
    return {
      ID: computerId,
      Name: prop(['Computer Name', 'Name']) || computerId,
      OS: prop(['OS', 'Operating System']),
      IPAddress: prop(['IP Address', 'IP Addresses']),
      Subnet: prop(['Subnet Address', 'Subnet']),
      AgentVersion: prop(['BES Client Version', 'Client Version', 'Agent Version']),
      LastReport: prop(['Last Report Time', 'LastReportTime']),
      IsOnline: prop(['Active', 'IsOnline']) || 'false',
      CustomSiteCount: '0',
    };
  } catch (error) {
    console.warn(`Computer detail fetch failed for ${computerId}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function siteTypePath(type) {
  if (type === 'ExternalSite') return 'external';
  if (type === 'CustomSite') return 'custom';
  if (type === 'OperatorSite') return 'operator';
  if (type === 'MasterActionSite') return 'master';
  return String(type || '').toLowerCase();
}

function contentPath(contentType, site) {
  const plural = contentType === 'baseline' ? 'baselines' : `${contentType}s`;
  if (!site || site === 'all') return `/${plural}`;
  return `/${plural}/${siteTypePath(site.type)}/${encodeURIComponent(site.name)}`;
}

async function fetchContentForSite(consoleConfig, contentType, site) {
  try {
    return await bigfixRequest(consoleConfig, contentPath(contentType, site));
  } catch (error) {
    console.warn(`Content fetch failed for ${contentType} ${site?.display_name || 'all'}: ${error instanceof Error ? error.message : String(error)}`);
    return '';
  }
}

async function fetchActionDetails(consoleConfig, actionId) {
  try {
    return parseActionsXML(await bigfixRequest(consoleConfig, `/action/${actionId}`))[0] || null;
  } catch {
    return null;
  }
}

function contentRelevanceType(contentType) {
  if (contentType === 'task') return 'bes tasks';
  if (contentType === 'baseline') return 'bes baselines';
  return 'bes fixlets';
}

async function queryComputers(consoleConfig) {
  const queries = [
    {
      relevance: '(id of it as string, name of it | "", operating system of it | "", concatenation "," of ip addresses of it, last report time of it as string | "", if exists client version of it then client version of it as string else "", if active flag of it then "true" else "false") of bes computers',
      map: row => ({
        ID: row[0] || '',
        Name: row[1] || row[0] || '',
        OS: row[2] || '',
        IPAddress: row[3] || '',
        LastReport: row[4] || '',
        AgentVersion: row[5] || '',
        IsOnline: row[6] || '',
        Subnet: '',
        CustomSiteCount: '0',
      }),
    },
    {
      relevance: '(id of it as string, name of it | "", operating system of it | "", last report time of it as string | "") of bes computers',
      map: row => ({
        ID: row[0] || '',
        Name: row[1] || row[0] || '',
        OS: row[2] || '',
        IPAddress: '',
        LastReport: row[3] || '',
        AgentVersion: '',
        IsOnline: isRecentReport(row[3]) ? 'true' : 'false',
        Subnet: '',
        CustomSiteCount: '0',
      }),
    },
  ];

  for (const query of queries) {
    try {
      const rows = parseTupleQueryXML(await bigfixRequest(consoleConfig, `/query?relevance=${encodeURIComponent(query.relevance)}`));
      if (rows.length === 0) continue;
      return rows.map(query.map);
    } catch (error) {
      console.warn(`Computer relevance variant failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return [];
}

async function queryContent(consoleConfig, contentType, siteName) {
  const objectType = contentRelevanceType(contentType);
  const siteFilter = siteName && siteName !== 'all' ? ` whose (name of site of it = ${JSON.stringify(siteName)})` : '';
  const queries = [
    `(id of it as string, name of it | "", name of site of it | "", source severity of it | "normal", category of it | "", source id of it | "", source of it | "", number of applicable computers of it as string, if hidden flag of it then "true" else "false") of ${objectType}${siteFilter}`,
    `(id of it as string, name of it | "", name of site of it | "", source severity of it | "normal", category of it | "", source id of it | "", source of it | "", number of applicable computers of it as string) of ${objectType}${siteFilter}`,
  ];

  for (const relevance of queries) {
    try {
    const rows = parseTupleQueryXML(await bigfixRequest(consoleConfig, `/query?relevance=${encodeURIComponent(relevance)}`));
    return rows.map(row => ({
      ID: row[0] || '',
      Name: row[1] || row[0] || '',
      SourceName: row[2] || siteName || '',
      SiteID: row[2] || siteName || '',
      Severity: row[3] || 'normal',
      Category: row[4] || '',
      SourceID: row[5] || '',
      Description: row[6] || '',
      Source: row[6] || '',
      Relevance: '',
      ActionScript: '',
      IsApplicableCount: row[7] || '0',
      IsEnabled: 'true',
      IsHidden: row[8] || 'false',
    }));
    } catch (error) {
      console.warn(`Content relevance failed for ${contentType}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return [];
}

async function queryApplicableComputers(consoleConfig, content) {
  const objectType = contentRelevanceType(content.type);
  const filters = [`id of it as string = ${JSON.stringify(String(content.bigfix_id || ''))}`];
  const siteName = decodeBigFixValue(content.site_id || content.source_name || '');
  if (siteName) filters.push(`name of site of it = ${JSON.stringify(siteName)}`);
  const relevance = `(id of it as string, name of it | "", operating system of it | "", concatenation "," of ip addresses of it, last report time of it as string | "", if exists client version of it then client version of it as string else "", if active flag of it then "true" else "false") of applicable computers of ${objectType} whose (${filters.join(' and ')})`;
  const rows = parseTupleQueryXML(await bigfixRequest(consoleConfig, `/query?relevance=${encodeURIComponent(relevance)}`));
  const seen = new Set();
  return rows
    .map(row => ({
      bigfix_id: row[0] || '',
      name: row[1] || row[0] || '',
      os: row[2] || '',
      ip_address: row[3] || '',
      last_report: row[4] || null,
      agent_version: row[5] || '',
      is_online: row[6] === 'true',
    }))
    .filter(item => {
      if (!item.bigfix_id || seen.has(item.bigfix_id)) return false;
      seen.add(item.bigfix_id);
      return true;
    });
}

async function queryActions(consoleConfig) {
  const relevance = '(id of it as string, name of it | "", state of it as string | "", issuer name of it | "", time issued of it as string | "") of bes actions';
  try {
    const rows = parseTupleQueryXML(await bigfixRequest(consoleConfig, `/query?relevance=${encodeURIComponent(relevance)}`));
    return rows.map(row => ({
      ID: row[0] || '',
      Name: row[1] || row[0] || '',
      Type: 'action',
      Status: row[2] || 'pending',
      TargetCount: '0',
      CompletedCount: '0',
      FailedCount: '0',
      RunningCount: '0',
      NotRunCount: '0',
      StartTime: row[4] || '',
      EndTime: '',
      CreatedBy: row[3] || '',
      IsDistributed: 'false',
    }));
  } catch (error) {
    console.warn(`Action relevance failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function queryActionResults(consoleConfig, actionId) {
  const relevance = `(id of computer of it as string, name of computer of it | "", status of it as string | "", state of it as string | "", line number of it as string | "", exit code of it as string | "", start time of it as string | "", end time of it as string | "", retry count of it as string | "") of results of bes action whose (id of it = ${Number(actionId)})`;
  try {
    const rows = parseTupleQueryXML(await bigfixRequest(consoleConfig, `/query?relevance=${encodeURIComponent(relevance)}`));
    return rows.map(row => {
      const result = {
      ComputerID: row[0] || '',
      ComputerName: row[1] || '',
      Status: row[2] || 'Pending',
      State: row[3] || '',
      LineNumber: row[4] || '',
      ResultCode: row[5] || '',
      ErrorMessage: '',
      RetryCount: row[8] || '0',
      StartedAt: row[6] || '',
      CompletedAt: row[7] || '',
      };
      return { ...result, LogExcerpt: buildLogExcerpt(result) };
    });
  } catch (error) {
    console.warn(`Action result relevance failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function fetchAndStoreActionStatus(db, consoleConfig, consoleId, actionBigfixId) {
  let parsed = [];
  try {
    parsed = parseActionStatusXML(await bigfixRequest(consoleConfig, `/action/${actionBigfixId}/status`));
  } catch (error) {
    console.warn(`Action status REST failed for ${actionBigfixId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed.length === 0) {
    parsed = await queryActionResults(consoleConfig, actionBigfixId);
    if (parsed.length > 0) console.log(`Fetched ${parsed.length} action results by relevance fallback for ${actionBigfixId}`);
  }

  const action = db.bigfix_actions.find(item => item.console_id === consoleId && item.bigfix_id === actionBigfixId);
  if (!action) return { count: parsed.length };

  for (const result of parsed) {
    let computer = db.bigfix_computers.find(item => item.console_id === consoleId && item.bigfix_id === result.ComputerID);
    if (!computer && result.ComputerID) {
      computer = {
        id: randomUUID(),
        console_id: consoleId,
        bigfix_id: result.ComputerID,
        name: result.ComputerName || result.ComputerID,
        os: '',
        ip_address: '',
        subnet: '',
        agent_version: '',
        last_report: null,
        is_online: false,
        custom_site_count: 0,
        created_at: now(),
        updated_at: now(),
      };
      db.bigfix_computers.push(computer);
    }
    if (!computer) continue;
    upsertBy(db, 'bigfix_action_results', item => item.action_id === action.id && item.computer_id === computer.id, {
      action_id: action.id,
      computer_id: computer.id,
      status: normalizeResultStatus(result.Status || result.State),
      state: result.State,
      line_number: parseInt(result.LineNumber, 10) || 0,
      result_code: result.ResultCode,
      error_message: result.ErrorMessage,
      log_excerpt: result.LogExcerpt,
      retry_count: parseInt(result.RetryCount, 10) || 0,
      started_at: result.StartedAt || null,
      completed_at: result.CompletedAt || null,
      updated_at: now(),
    });
  }

  const storedResults = db.bigfix_action_results.filter(item => item.action_id === action.id);
  action.completed_count = storedResults.filter(item => item.status === 'Completed').length;
  action.failed_count = storedResults.filter(item => item.status === 'Failed').length;
  action.running_count = storedResults.filter(item => item.status === 'Running').length;
  action.not_run_count = storedResults.filter(item => ['NotRun', 'Pending', 'Downloaded'].includes(item.status)).length;
  action.target_count = storedResults.length || parsed.length || action.target_count;
  action.status = deriveActionStatusFromResults(storedResults, action.status);
  action.updated_at = now();
  return { count: parsed.length };
}

function sortByCreatedDesc(items) {
  return [...items].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

function getConsole(db, consoleId) {
  const consoleConfig = db.bigfix_consoles.find(item => item.id === consoleId);
  if (!consoleConfig) throw new Error('Console not found');
  return consoleConfig;
}

function upsertBy(db, table, predicate, record) {
  const index = db[table].findIndex(predicate);
  if (index >= 0) db[table][index] = { ...db[table][index], ...record };
  else db[table].push({ id: randomUUID(), created_at: now(), ...record });
}

function enrichResult(db, result) {
  const computer = db.bigfix_computers.find(item => item.id === result.computer_id);
  const action = db.bigfix_actions.find(item => item.id === result.action_id);
  return {
    ...result,
    bigfix_computers: computer ? {
      name: computer.name,
      os: computer.os,
      ip_address: computer.ip_address,
      bigfix_id: computer.bigfix_id,
    } : undefined,
    bigfix_actions: action ? {
      name: action.name,
      type: action.type,
      status: action.status,
      bigfix_id: action.bigfix_id,
      console_id: action.console_id,
      created_by: action.created_by,
      start_time: action.start_time,
    } : undefined,
  };
}

function matchResolution(resolutions, result) {
  return resolutions.find(item => {
    if (item.error_code && result.result_code && String(item.error_code) === String(result.result_code)) return true;
    if (!item.error_pattern) return false;
    try { return new RegExp(item.error_pattern, 'i').test(`${result.error_message || ''} ${result.log_excerpt || ''} ${result.result_code || ''}`); } catch { return false; }
  });
}

function generateActionScriptFromSteps(steps, diagnosis, resolutionTitle = 'Generated Auto-Fix') {
  const text = `${resolutionTitle} ${(steps || []).join(' ')} ${diagnosis?.rootCause || ''} ${diagnosis?.detail || ''}`.toLowerCase();
  const lines = [
    `// Auto-generated from proposed solution steps: ${resolutionTitle}`,
    'if {windows of operating system}',
  ];
  let addedCommand = false;

  if (/besclient|client service|agent|relay autoselection|relay selection/.test(text)) {
    lines.push('waithidden sc.exe stop BESClient');
    lines.push('pause while {exists running service "BESClient"}');
    lines.push('waithidden sc.exe start BESClient');
    addedCommand = true;
  }

  if (/disk|space|temp|temporary|storage/.test(text)) {
    lines.push('waithidden cmd.exe /C if exist "%windir%\\Temp" del /q /f /s "%windir%\\Temp\\*"');
    addedCommand = true;
  }

  if (/download|prefetch|hash|sha1|sha256|relay cache/.test(text)) {
    lines.push('delete __Download');
    addedCommand = true;
  }

  if (!addedCommand) {
    lines.push('waithidden cmd.exe /C echo Auto-fix analysis completed');
  }

  lines.push('endif');
  return lines.join('\n');
}

function diagnoseFailure(result, computer, action, resolution) {
  const message = String(result.error_message || '');
  const logExcerpt = String(result.log_excerpt || '');
  const code = String(result.result_code || '');
  const text = `${code} ${message} ${logExcerpt} ${result.state || ''}`.toLowerCase();
  const evidence = [];
  if (code) evidence.push(`Result code: ${code}`);
  if (message) evidence.push(`Message: ${message}`);
  if (logExcerpt) evidence.push(`Log: ${logExcerpt}`);
  if (result.line_number) evidence.push(`Line number: ${result.line_number}`);
  if (result.completed_at) evidence.push(`Failed at: ${result.completed_at}`);
  if (computer?.last_report) evidence.push(`Last report: ${computer.last_report}`);

  let rootCause = 'Action execution failed on endpoint';
  let confidence = resolution ? 'high' : 'medium';
  let detail = logExcerpt || 'No exact BigFix message was captured. Use the action log on the endpoint for the failing line.';

  if (/1603|fatal error during installation|msi.*fatal/.test(text)) {
    rootCause = 'MSI fatal installation failure';
    detail = 'The package started but Windows Installer rejected the install. Pending reboot, locked files, missing prerequisites, or vendor installer conditions are common causes.';
  } else if (/1618|another installation is already in progress|msiexec/.test(text)) {
    rootCause = 'Another MSI installation is already running';
    detail = 'Windows Installer allows only one install transaction at a time, so this action should be retried after the active install completes.';
  } else if (/download|hash|sha1|sha256|size mismatch|prefetch|http|url/.test(text)) {
    rootCause = 'Download or payload verification failure';
    detail = 'The action likely failed before execution because the endpoint or relay could not download or verify the payload.';
  } else if (/disk|space|not enough storage|insufficient/.test(text)) {
    rootCause = 'Insufficient disk space or storage access';
    detail = 'The endpoint likely needs free space for download, extraction, or installer temporary files.';
  } else if (/locked/.test(text)) {
    rootCause = 'Endpoint is locked for actions';
    detail = 'The BigFix Client reported a locked state, so the action cannot run until the endpoint is unlocked.';
  } else if (/timeout|timed out|unreachable|connection/.test(text)) {
    rootCause = 'Network or endpoint response timeout';
    detail = 'The action did not complete within the expected window. Check endpoint connectivity, relay path, and whether the process is still running.';
  } else if (!message && !code) {
    confidence = 'low';
  }

  return {
    rootCause,
    confidence,
    evidence,
    detail,
    actionName: action?.name || '',
    computerOnline: Boolean(computer?.is_online),
  };
}

function proposedResolutionForFailure(resolution, diagnosis) {
  if (resolution) {
    const generatedScript = resolution.resolution_type === 'auto' && !resolution.resolution_script;
    return {
      title: resolution.title,
      description: resolution.description,
      type: resolution.resolution_type,
      steps: resolution.resolution_steps || [],
      script: resolution.resolution_script || (generatedScript ? generateActionScriptFromSteps(resolution.resolution_steps || [], diagnosis, resolution.title) : ''),
      resolutionId: resolution.id,
      generatedScript,
    };
  }

  const text = `${diagnosis?.rootCause || ''} ${diagnosis?.detail || ''} ${(diagnosis?.evidence || []).join(' ')}`.toLowerCase();
  let title = 'Manual log-based remediation';
  let description = 'Generated from the failed action log evidence. Review the captured log detail before redeploying.';
  let type = 'manual';
  let steps = [
    'Review the captured log line and result code for the exact failing operation.',
    'Fix the endpoint or package condition identified in the log evidence.',
    'Redeploy the original action after remediation.',
  ];

  if (/besclient|client service|agent.*stuck|not responding|relay autoselection|relay selection/.test(text)) {
    title = 'Restart BigFix Client and retry';
    description = 'The log evidence points to a stuck client/relay-processing condition. This can be remediated automatically by restarting the BESClient service before redeploy.';
    type = 'auto';
    steps = ['Restart the BESClient service on the affected endpoint.', 'Wait for the client to report back.', 'Redeploy the original action.'];
  } else if (/download|prefetch|hash|sha1|sha256|size mismatch|relay cache/.test(text)) {
    title = 'Clear BigFix download cache and retry';
    description = 'The log evidence points to a download, prefetch, or hash-verification failure. This can be remediated automatically by clearing the action download cache before redeploy.';
    type = 'auto';
    steps = ['Clear the BigFix action download cache.', 'Force the endpoint to download a fresh payload from its relay.', 'Redeploy the original action.'];
  } else if (/temp|temporary/.test(text) && /disk|space|storage/.test(text)) {
    title = 'Clean temporary files and retry';
    description = 'The log evidence points to temporary storage pressure. This can be remediated automatically by clearing Windows temp files before redeploy.';
    type = 'auto';
    steps = ['Clean Windows temporary files.', 'Confirm the endpoint can report back.', 'Redeploy the original action.'];
  } else if (/disk|space|not enough storage|insufficient/.test(text)) {
    title = 'Free endpoint disk space';
    description = 'The log evidence points to insufficient disk space. Keep this manual unless your environment allows automated cleanup beyond temporary files.';
    steps = ['Check free space on the system and BigFix client drives.', 'Remove stale payloads or expand disk capacity.', 'Redeploy after enough free space is available.'];
  } else if (/1618|another msi installation|msiexec/.test(text)) {
    title = 'Wait for active installer and retry';
    description = 'The log evidence points to another Windows Installer transaction. Manual confirmation is safer before redeploying.';
    steps = ['Check for active msiexec.exe or software installation activity.', 'Wait for the installer to finish or reboot if it is stuck.', 'Redeploy the original action.'];
  } else if (/1603|msi fatal|fatal installation/.test(text)) {
    title = 'Investigate MSI fatal install condition';
    description = 'The log evidence points to MSI error 1603. This is usually package or endpoint state specific, so manual validation is required.';
    steps = ['Check the failing MSI command and vendor log around the captured line.', 'Verify prerequisites, pending reboot, permissions, and locked files.', 'Fix the package condition and redeploy.'];
  } else if (/locked/.test(text)) {
    title = 'Unlock endpoint for actions';
    description = 'The log evidence says the endpoint is locked for actions. Unlock it before redeploying.';
    steps = ['Confirm the endpoint lock state in BigFix.', 'Unlock the endpoint or adjust the locking policy.', 'Redeploy the original action.'];
  } else if (/timeout|timed out|unreachable|connection/.test(text)) {
    title = 'Restore endpoint or relay connectivity';
    description = 'The log evidence points to connectivity or timeout. Manual network/client validation is required before redeploy.';
    steps = ['Confirm the endpoint is online and reporting.', 'Check relay connectivity and firewall path.', 'Redeploy after the endpoint reports successfully.'];
  }

  const script = type === 'auto' ? generateActionScriptFromSteps(steps, diagnosis, title) : '';
  return {
    title,
    description,
    type,
    steps,
    script,
    generatedScript: true,
  };
}

function normalizeExternalAnalysis(value) {
  if (!value || typeof value !== 'object') return null;
  const proposal = value.proposedResolution || value.proposed_resolution || value.resolution || value.recommendation || {};
  const steps = Array.isArray(proposal.steps) ? proposal.steps
    : Array.isArray(proposal.resolution_steps) ? proposal.resolution_steps
      : Array.isArray(value.steps) ? value.steps
        : [];
  const type = String(proposal.type || proposal.resolution_type || value.type || '').toLowerCase() === 'auto' ? 'auto' : 'manual';
  const title = String(proposal.title || value.title || value.rootCause || value.root_cause || '').trim();
  const description = String(proposal.description || value.description || value.detail || '').trim();
  if (!title && !description && steps.length === 0) return null;
  return {
    rootCause: value.rootCause || value.root_cause || value.category || undefined,
    confidence: value.confidence || 'external',
    detail: value.detail || value.summary || description,
    evidence: Array.isArray(value.evidence) ? value.evidence : undefined,
    proposedResolution: {
      title: title || 'Runbook AI recommendation',
      description: description || 'Recommendation returned by external analyzer.',
      type,
      steps,
      script: String(proposal.script || proposal.resolution_script || value.script || ''),
      resolutionId: proposal.resolutionId || proposal.resolution_id || value.runbookId || value.runbook_id,
      generatedScript: Boolean(proposal.generatedScript || proposal.generated_script || value.generatedScript),
    },
    source: 'external',
  };
}

function analyzerPayload(result, computer, action, diagnosis, resolution) {
  return {
    source: 'bigfix-management-tool',
    action: {
      id: action?.id,
      bigfix_id: action?.bigfix_id,
      name: action?.name,
      type: action?.type,
      status: action?.status,
      created_by: action?.created_by,
      start_time: action?.start_time,
    },
    computer: {
      id: computer?.id,
      bigfix_id: computer?.bigfix_id,
      name: computer?.name,
      os: computer?.os,
      ip_address: computer?.ip_address,
      last_report: computer?.last_report,
      is_online: computer?.is_online,
    },
    failure: {
      status: result.status,
      state: result.state,
      result_code: result.result_code,
      error_message: result.error_message,
      log_excerpt: result.log_excerpt,
      line_number: result.line_number,
      retry_count: result.retry_count,
      started_at: result.started_at,
      completed_at: result.completed_at,
    },
    local_diagnosis: diagnosis,
    matched_resolution: resolution ? {
      id: resolution.id,
      title: resolution.title,
      type: resolution.resolution_type,
      steps: resolution.resolution_steps || [],
    } : null,
  };
}

function externalAnalyzerPath(provider) {
  if (provider === 'aex') return '/api/analyze/bigfix-failure';
  if (provider === 'runbook-ai') return '/api/runbook-ai/analyze';
  return '/api/analyze';
}

function callExternalAnalyzer(config, payload) {
  return new Promise((resolve, reject) => {
    const baseUrl = String(config.base_url || '').replace(/\/$/, '');
    if (!baseUrl) return resolve(null);
    const endpoint = new URL(baseUrl + externalAnalyzerPath(config.provider));
    const body = JSON.stringify({ orgId: config.org_id || undefined, payload });
    const headers = {
      'Content-Type': 'application/json',
      [config.auth_header || 'Authorization']: String(config.api_key || '').startsWith('Bearer ')
        ? config.api_key
        : `Bearer ${config.api_key || ''}`,
    };
    const client = endpoint.protocol === 'http:' ? http : https;
    const req = client.request(endpoint, {
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      timeout: Number(config.timeout_seconds || 30) * 1000,
      rejectUnauthorized,
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Analyzer API error ${res.statusCode}: ${text.slice(0, 500)}`));
          return;
        }
        try {
          resolve(normalizeExternalAnalysis(text ? JSON.parse(text) : null));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Analyzer API request timed out')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function analyzeWithHybridProvider(db, result, computer, action, resolution, diagnosis) {
  const config = db.analyzer_config || {};
  const localProposal = proposedResolutionForFailure(resolution, diagnosis);
  const local = {
    rootCause: diagnosis.rootCause,
    confidence: diagnosis.confidence,
    evidence: diagnosis.evidence,
    detail: diagnosis.detail,
    proposedResolution: localProposal,
    source: 'local',
  };

  if (!config.enabled || config.mode === 'local' || !config.base_url || !config.api_key) return local;
  try {
    const external = await callExternalAnalyzer(config, analyzerPayload(result, computer, action, diagnosis, resolution));
    if (external?.proposedResolution) {
      if (external.proposedResolution.type === 'auto' && !external.proposedResolution.script) {
        external.proposedResolution.script = generateActionScriptFromSteps(external.proposedResolution.steps || [], {
          rootCause: external.rootCause || diagnosis.rootCause,
          detail: external.detail || diagnosis.detail,
        }, external.proposedResolution.title);
        external.proposedResolution.generatedScript = true;
      }
      return {
        ...local,
        ...external,
        evidence: external.evidence || local.evidence,
        detail: external.detail || local.detail,
      };
    }
  } catch (error) {
    console.warn(`External analyzer failed, using local fallback: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ...local, source: 'local-fallback' };
}

async function handleAction(body) {
  const db = readDb();

  switch (body.action) {
    case 'list-consoles':
      return { data: sortByCreatedDesc(db.bigfix_consoles) };

    case 'get-analyzer-config': {
      const config = db.analyzer_config || {};
      return { data: { ...config, api_key: config.api_key ? '********' : '' } };
    }

    case 'update-analyzer-config': {
      const current = db.analyzer_config || {};
      const updates = body.config || {};
      db.analyzer_config = {
        ...current,
        ...updates,
        api_key: updates.api_key === '********' ? current.api_key : updates.api_key,
        mode: updates.mode || current.mode || 'local',
        provider: updates.provider || current.provider || 'none',
        timeout_seconds: Number(updates.timeout_seconds || current.timeout_seconds || 30),
        enabled: Boolean(updates.enabled),
        updated_at: now(),
      };
      writeDb(db);
      return { data: { ...db.analyzer_config, api_key: db.analyzer_config.api_key ? '********' : '' } };
    }

    case 'add-console': {
      const record = {
        id: randomUUID(),
        ...body.console,
        port: Number(body.console.port || 52311),
        status: 'disconnected',
        last_connected: null,
        user_id: null,
        created_at: now(),
      };
      if (record.is_default) db.bigfix_consoles = db.bigfix_consoles.map(item => ({ ...item, is_default: false }));
      db.bigfix_consoles.unshift(record);
      writeDb(db);
      return { data: record };
    }

    case 'update-console': {
      db.bigfix_consoles = db.bigfix_consoles.map(item => item.id === body.id ? { ...item, ...body.updates } : item);
      if (body.updates?.is_default) db.bigfix_consoles = db.bigfix_consoles.map(item => ({ ...item, is_default: item.id === body.id }));
      writeDb(db);
      return { success: true };
    }

    case 'delete-console':
      db.bigfix_consoles = db.bigfix_consoles.filter(item => item.id !== body.id);
      db.bigfix_computers = db.bigfix_computers.filter(item => item.console_id !== body.id);
      db.bigfix_content = db.bigfix_content.filter(item => item.console_id !== body.id);
      db.bigfix_actions = db.bigfix_actions.filter(item => item.console_id !== body.id);
      writeDb(db);
      return { success: true };

    case 'list-computers':
      return { data: db.bigfix_computers.filter(item => item.console_id === body.consoleId).sort((a, b) => String(a.name).localeCompare(String(b.name))) };

    case 'list-content': {
      let data = db.bigfix_content.filter(item => item.console_id === body.consoleId);
      if (body.type) data = data.filter(item => item.type === body.type);
      if (body.siteId && body.siteId !== 'all') {
        data = data.filter(item => decodeBigFixValue(item.site_id) === body.siteId || decodeBigFixValue(item.source_name) === body.siteId);
      }
      return { data: sortByCreatedDesc(data) };
    }

    case 'list-applicable-computers': {
      const consoleConfig = getConsole(db, body.consoleId);
      const content = db.bigfix_content.find(item => item.id === body.contentId && item.console_id === body.consoleId);
      if (!content) throw new Error('Content not found');
      const applicable = await queryApplicableComputers(consoleConfig, content);
      const data = applicable.map(item => {
        const cached = db.bigfix_computers.find(computer => computer.console_id === body.consoleId && computer.bigfix_id === item.bigfix_id);
        return {
          id: cached?.id || item.bigfix_id,
          console_id: body.consoleId,
          subnet: cached?.subnet || '',
          custom_site_count: cached?.custom_site_count || 0,
          created_at: cached?.created_at || now(),
          updated_at: cached?.updated_at || now(),
          ...cached,
          ...item,
        };
      }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      return { data, count: data.length };
    }

    case 'list-sites':
      return { data: db.bigfix_sites.filter(item => item.console_id === body.consoleId).sort((a, b) => String(a.display_name).localeCompare(String(b.display_name))) };

    case 'list-actions': {
      let data = db.bigfix_actions.filter(item => item.console_id === body.consoleId);
      if (body.status) data = data.filter(item => item.status === body.status);
      return { data: sortByCreatedDesc(data) };
    }

    case 'list-action-results':
      return { data: sortByCreatedDesc(db.bigfix_action_results.filter(item => item.action_id === body.actionId)).map(item => enrichResult(db, item)) };

    case 'list-failed-results': {
      const actionIds = new Set(db.bigfix_actions.filter(item => item.console_id === body.consoleId).map(item => item.id));
      return { data: sortByCreatedDesc(db.bigfix_action_results.filter(item => item.status === 'Failed' && actionIds.has(item.action_id))).map(item => enrichResult(db, item)) };
    }

    case 'list-resolutions':
      return { data: [...db.bigfix_failure_resolutions].sort((a, b) => (b.use_count || 0) - (a.use_count || 0)) };

    case 'add-resolution': {
      const record = {
        id: randomUUID(),
        ...body.resolution,
        is_verified: false,
        use_count: 0,
        success_rate: 0,
        created_at: now(),
        updated_at: now(),
      };
      db.bigfix_failure_resolutions.unshift(record);
      writeDb(db);
      return { data: record };
    }

    case 'update-resolution':
      db.bigfix_failure_resolutions = db.bigfix_failure_resolutions.map(item => item.id === body.id ? { ...item, ...body.updates, updated_at: now() } : item);
      writeDb(db);
      return { success: true };

    case 'delete-resolution':
      db.bigfix_failure_resolutions = db.bigfix_failure_resolutions.filter(item => item.id !== body.id);
      writeDb(db);
      return { success: true };

    case 'list-applied-resolutions':
      return {
        data: sortByCreatedDesc(db.bigfix_applied_resolutions.filter(item => item.action_result_id === body.actionResultId)).map(item => ({
          ...item,
          bigfix_failure_resolutions: db.bigfix_failure_resolutions.find(resolution => resolution.id === item.resolution_id),
        })),
      };

    case 'dashboard-stats': {
      const computers = db.bigfix_computers.filter(item => item.console_id === body.consoleId);
      const content = db.bigfix_content.filter(item => item.console_id === body.consoleId);
      const actions = db.bigfix_actions.filter(item => item.console_id === body.consoleId);
      return {
        data: {
          totalComputers: computers.length,
          onlineComputers: computers.filter(item => item.is_online).length,
          totalFixlets: content.filter(item => item.type === 'fixlet').length,
          totalTasks: content.filter(item => item.type === 'task').length,
          totalBaselines: content.filter(item => item.type === 'baseline').length,
          totalPatches: content.filter(item => item.type === 'patch').length,
          activeActions: actions.filter(item => item.status === 'running' || item.status === 'pending').length,
          failedActions: actions.filter(item => item.status === 'failed').length,
          criticalContent: content.filter(item => item.severity === 'critical').length,
          totalActions: actions.length,
          completedActions: actions.filter(item => item.status === 'completed').length,
        },
      };
    }

    case 'test-connection': {
      const consoleConfig = getConsole(db, body.consoleId);
      try {
        const text = await bigfixRequest(consoleConfig, `/query?relevance=${encodeURIComponent('version of server')}`);
        const versionMatch = text.match(/<Answer[^>]*>([^<]+)<\/Answer>/) || text.match(/ServerVersion="([^"]+)"/);
        consoleConfig.status = 'connected';
        consoleConfig.last_connected = now();
        writeDb(db);
        return { success: true, message: 'Connection successful', serverVersion: versionMatch?.[1] || 'Unknown' };
      } catch (error) {
        consoleConfig.status = 'error';
        writeDb(db);
        return { success: false, message: explainBigFixError(error) };
      }
    }

    case 'fetch-computers': {
      const consoleConfig = getConsole(db, body.consoleId);
      let parsed = await queryComputers(consoleConfig);
      console.log(`Fetched ${parsed.length} computers by relevance query`);
      if (parsed.length === 0) {
        console.warn('Computer relevance returned 0 rows; falling back to /computers + /computer/{id}');
        const summary = parseComputersXML(await bigfixRequest(consoleConfig, '/computers'));
        const detailed = await Promise.all(summary.map(async comp => {
          if (!comp.ID) return comp;
          return await fetchComputerDetails(consoleConfig, comp.ID) || comp;
        }));
        parsed = detailed;
        console.log(`Fetched ${parsed.length} computers by /computers fallback`);
      }
      for (const comp of parsed) {
        if (!comp.ID) continue;
        upsertBy(db, 'bigfix_computers', item => item.console_id === body.consoleId && item.bigfix_id === comp.ID, {
          console_id: body.consoleId,
          bigfix_id: comp.ID,
          name: comp.Name || comp.ID,
          os: comp.OS || '',
          ip_address: comp.IPAddress || '',
          subnet: comp.Subnet || '',
          agent_version: comp.AgentVersion || '',
          last_report: comp.LastReport || null,
          is_online: String(comp.IsOnline).toLowerCase() === 'true' || isRecentReport(comp.LastReport),
          custom_site_count: parseInt(comp.CustomSiteCount, 10) || 0,
          updated_at: now(),
        });
      }
      consoleConfig.status = 'connected';
      consoleConfig.last_connected = now();
      writeDb(db);
      return { success: true, count: parsed.length, message: `Synced ${parsed.length} computers` };
    }

    case 'fetch-content': {
      const consoleConfig = getConsole(db, body.consoleId);
      const contentType = body.type || 'fixlet';
      const requestedSites = body.siteId && body.siteId !== 'all'
        ? db.bigfix_sites.filter(site => site.console_id === body.consoleId && site.name === body.siteId)
        : db.bigfix_sites.filter(site => site.console_id === body.consoleId);
      const xmlParts = [];
      if (requestedSites.length > 0) {
        for (const site of requestedSites) xmlParts.push(await fetchContentForSite(consoleConfig, contentType, site));
      } else {
        xmlParts.push(await fetchContentForSite(consoleConfig, contentType, null));
      }
      let parsed = xmlParts.flatMap(xml => parseContentXML(xml));
      console.log(`Fetched ${parsed.length} ${contentType}s by REST for ${requestedSites.length || 1} site scope(s)`);
      if (parsed.length === 0) {
        const sitesForQuery = requestedSites.length > 0 ? requestedSites : [{ name: body.siteId || 'all' }];
        const queryResults = [];
        for (const site of sitesForQuery) queryResults.push(...await queryContent(consoleConfig, contentType, site.name));
        parsed = queryResults;
        console.log(`Fetched ${parsed.length} ${contentType}s by relevance fallback`);
      }
      for (const item of parsed) {
        const siteId = decodeBigFixValue(item.SiteID || item.SourceName || body.siteId || '');
        upsertBy(db, 'bigfix_content', existing => existing.console_id === body.consoleId && existing.bigfix_id === item.ID, {
          console_id: body.consoleId,
          bigfix_id: item.ID,
          site_id: siteId,
          type: contentType,
          name: item.Name,
          description: item.Description,
          severity: item.Severity || 'normal',
          category: item.Category,
          source_id: item.SourceID,
          source_name: decodeBigFixValue(item.SourceName || siteId),
          relevance: item.Relevance,
          action_script: item.ActionScript,
          is_applicable_count: parseInt(item.IsApplicableCount, 10) || 0,
          is_enabled: item.IsEnabled !== 'false',
          is_hidden: String(item.IsHidden || '').toLowerCase() === 'true',
          updated_at: now(),
        });
      }
      writeDb(db);
      return { success: true, count: parsed.length, message: `Synced ${parsed.length} ${contentType}s` };
    }

    case 'fetch-sites': {
      const consoleConfig = getConsole(db, body.consoleId);
      const text = await bigfixRequest(consoleConfig, '/sites');
      const parsed = parseSitesXML(text, body.consoleId);
      db.bigfix_sites = db.bigfix_sites.filter(item => item.console_id !== body.consoleId);
      db.bigfix_sites.push(...parsed);
      writeDb(db);
      return { success: true, count: parsed.length, data: parsed, message: `Synced ${parsed.length} sites` };
    }

    case 'fetch-actions': {
      const consoleConfig = getConsole(db, body.consoleId);
      const summary = parseActionsXML(await bigfixRequest(consoleConfig, '/actions'));
      const parsed = [];
      for (const action of summary) {
        parsed.push({ ...action, ...await fetchActionDetails(consoleConfig, action.ID) });
      }
      if (parsed.length === 0) parsed.push(...await queryActions(consoleConfig));
      console.log(`Fetched ${parsed.length} actions`);
      for (const action of parsed) {
        upsertBy(db, 'bigfix_actions', item => item.console_id === body.consoleId && item.bigfix_id === action.ID, {
          console_id: body.consoleId,
          bigfix_id: action.ID,
          name: action.Name,
          type: action.Type || 'fixlet',
          status: deriveActionStatusFromSummary(action),
          target_count: parseInt(action.TargetCount, 10) || 0,
          completed_count: parseInt(action.CompletedCount, 10) || 0,
          failed_count: parseInt(action.FailedCount, 10) || 0,
          running_count: parseInt(action.RunningCount, 10) || 0,
          not_run_count: parseInt(action.NotRunCount, 10) || 0,
          start_time: action.StartTime || null,
          end_time: action.EndTime || null,
          created_by: action.CreatedBy,
          is_distributed: action.IsDistributed === 'true',
          updated_at: now(),
        });
        await fetchAndStoreActionStatus(db, consoleConfig, body.consoleId, action.ID);
      }
      writeDb(db);
      return { success: true, count: parsed.length, message: `Synced ${parsed.length} actions` };
    }

    case 'fetch-action-status': {
      const consoleConfig = getConsole(db, body.consoleId);
      const result = await fetchAndStoreActionStatus(db, consoleConfig, body.consoleId, body.actionBigfixId);
      writeDb(db);
      return { success: true, count: result.count, message: `Updated ${result.count} results` };
    }

    case 'deploy-action': {
      if (!Array.isArray(body.targetComputerIds) || body.targetComputerIds.length === 0) throw new Error('Select at least one target computer before deploying an action');
      const consoleConfig = getConsole(db, body.consoleId);
      const content = db.bigfix_content.find(item => item.id === body.contentId);
      if (!content) throw new Error('Content not found');
      const targetXml = body.targetComputerIds.map(id => `      <ComputerID>${escapeXml(id)}</ComputerID>`).join('\n');
      const actionXML = `<BES xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="BES.xsd">
  <SingleAction>
    <Title>${escapeXml(body.actionName || content.name)}</Title>
    <Relevance>${escapeXml(content.relevance || 'true')}</Relevance>
    <ActionScript>${escapeXml(content.action_script || '')}</ActionScript>
    <Target>
${targetXml}
    </Target>
  </SingleAction>
</BES>`;
      const text = await bigfixRequest(consoleConfig, '/action', 'POST', actionXML);
      const bigfixActionId = text.match(/<ID>([^<]+)<\/ID>/)?.[1] || '';
      const action = {
        id: randomUUID(),
        console_id: body.consoleId,
        bigfix_id: bigfixActionId,
        content_id: body.contentId,
        name: body.actionName || content.name,
        type: content.type,
        status: 'pending',
        target_count: body.targetComputerIds.length,
        completed_count: 0,
        failed_count: 0,
        running_count: 0,
        not_run_count: 0,
        start_time: null,
        end_time: null,
        created_by: consoleConfig.username,
        is_distributed: false,
        metadata: {},
        created_at: now(),
        updated_at: now(),
      };
      db.bigfix_actions.unshift(action);
      writeDb(db);
      return { success: true, actionId: action.id, bigfixActionId, message: 'Action deployed' };
    }

    case 'stop-action': {
      const consoleConfig = getConsole(db, body.consoleId);
      const action = db.bigfix_actions.find(item => item.id === body.actionId);
      if (!action?.bigfix_id) throw new Error('Action not found');
      await bigfixRequest(consoleConfig, `/action/${action.bigfix_id}/stop`, 'POST');
      action.status = 'stopped';
      action.updated_at = now();
      writeDb(db);
      return { success: true, message: 'Action stopped' };
    }

    case 'analyze-failures': {
      const action = db.bigfix_actions.find(item => item.id === body.actionId);
      if (!action) throw new Error('Action not found');
      const failed = db.bigfix_action_results.filter(item => item.action_id === body.actionId && item.status === 'Failed');
      const analysis = [];
      for (const result of failed) {
        const computer = db.bigfix_computers.find(item => item.id === result.computer_id);
        const resolution = matchResolution(db.bigfix_failure_resolutions, result);
        const diagnosis = diagnoseFailure(result, computer, action, resolution);
        const providerAnalysis = await analyzeWithHybridProvider(db, result, computer, action, resolution, diagnosis);
        analysis.push({
          actionResultId: result.id,
          computerId: computer?.bigfix_id || '',
          computerName: computer?.name || 'Unknown',
          status: result.result_code || result.error_message || 'ERROR',
          isError: true,
          state: result.state || 'Failed',
          lineNumber: result.line_number || 0,
          logExcerpt: result.log_excerpt || '',
          retryCount: result.retry_count || 0,
          rootCause: providerAnalysis.rootCause,
          confidence: providerAnalysis.confidence,
          evidence: providerAnalysis.evidence,
          detail: providerAnalysis.detail,
          analysisSource: providerAnalysis.source,
          computerOnline: diagnosis.computerOnline,
          proposedResolution: providerAnalysis.proposedResolution,
        });
      }
      return { success: true, analysis, failedComputers: analysis.length, totalComputers: action.target_count || 0, actionName: action.name };
    }

    case 'apply-fix': {
      const resolution = db.bigfix_failure_resolutions.find(item => item.id === body.resolutionId);
      if (!resolution) throw new Error('Resolution not found');
      const result = db.bigfix_action_results.find(item => item.id === body.actionResultId);
      const computer = result ? db.bigfix_computers.find(item => item.id === result.computer_id) : null;
      const action = result ? db.bigfix_actions.find(item => item.id === result.action_id) : null;
      const applied = {
        id: randomUUID(),
        action_result_id: body.actionResultId,
        resolution_id: body.resolutionId,
        status: 'running',
        applied_by: body.appliedBy,
        output: '',
        created_at: now(),
        completed_at: null,
      };
      db.bigfix_applied_resolutions.unshift(applied);
      if (body.appliedBy === 'auto' && resolution.resolution_type === 'auto' && resolution.resolution_script) {
        try {
          const consoleConfig = getConsole(db, body.consoleId);
          if (!computer?.bigfix_id) throw new Error('Target computer not found for this failed result');
          const fixXML = `<BES xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="BES.xsd">
  <SingleAction>
    <Title>${escapeXml(`Auto-Fix: ${resolution.title}`)}</Title>
    <Relevance>${escapeXml(`computer id = ${computer.bigfix_id}`)}</Relevance>
    <ActionScript>${escapeXml(resolution.resolution_script)}</ActionScript>
  </SingleAction>
</BES>`;
          await bigfixRequest(consoleConfig, '/action', 'POST', fixXML);
          if (body.redeployAfterFix && action?.bigfix_id) {
            await bigfixRequest(consoleConfig, `/action/${action.bigfix_id}/redeploy`, 'POST');
            Object.assign(action, { status: 'pending', completed_count: 0, failed_count: 0, running_count: 0, not_run_count: 0, updated_at: now() });
          }
          applied.status = 'succeeded';
          applied.output = body.redeployAfterFix
            ? `Auto-fix deployed to ${computer.name || computer.bigfix_id}; original action redeployed`
            : `Auto-fix deployed to ${computer.name || computer.bigfix_id}`;
        } catch (error) {
          applied.status = 'failed';
          applied.output = `Auto-fix failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      } else {
        applied.status = 'succeeded';
        applied.output = 'Manual resolution marked as applied';
      }
      applied.completed_at = now();
      resolution.use_count = (resolution.use_count || 0) + 1;
      resolution.updated_at = now();
      writeDb(db);
      return { success: applied.status !== 'failed', message: applied.output };
    }

    case 'apply-generated-fix': {
      const result = db.bigfix_action_results.find(item => item.id === body.actionResultId);
      if (!result) throw new Error('Action result not found');
      const computer = db.bigfix_computers.find(item => item.id === result.computer_id);
      const action = db.bigfix_actions.find(item => item.id === result.action_id);
      const proposed = body.proposedResolution || {};
      const script = String(proposed.script || '');
      if (!script.trim()) throw new Error('Generated fix script is empty');
      const generatedResolution = proposed.resolutionId ? null : {
        id: randomUUID(),
        error_code: result.result_code || '',
        error_pattern: result.error_message || result.log_excerpt || '',
        title: proposed.title || 'Generated auto-fix',
        description: proposed.description || 'Generated from failed action log details.',
        resolution_type: 'auto',
        resolution_script: script,
        resolution_steps: Array.isArray(proposed.steps) ? proposed.steps : [],
        is_verified: false,
        use_count: 0,
        success_rate: 0,
        created_by: null,
        created_at: now(),
        updated_at: now(),
      };
      if (generatedResolution) db.bigfix_failure_resolutions.unshift(generatedResolution);
      const applied = {
        id: randomUUID(),
        action_result_id: body.actionResultId,
        resolution_id: proposed.resolutionId || generatedResolution.id,
        status: 'running',
        applied_by: 'auto',
        output: '',
        created_at: now(),
        completed_at: null,
      };
      db.bigfix_applied_resolutions.unshift(applied);
      try {
        const consoleConfig = getConsole(db, body.consoleId);
        if (!computer?.bigfix_id) throw new Error('Target computer not found for this failed result');
        const fixXML = `<BES xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="BES.xsd">
  <SingleAction>
    <Title>${escapeXml(`Auto-Fix: ${proposed.title || action?.name || 'Generated remediation'}`)}</Title>
    <Relevance>${escapeXml(`computer id = ${computer.bigfix_id}`)}</Relevance>
    <ActionScript>${escapeXml(script)}</ActionScript>
  </SingleAction>
</BES>`;
        await bigfixRequest(consoleConfig, '/action', 'POST', fixXML);
        if (body.redeployAfterFix && action?.bigfix_id) {
          await bigfixRequest(consoleConfig, `/action/${action.bigfix_id}/redeploy`, 'POST');
          Object.assign(action, { status: 'pending', completed_count: 0, failed_count: 0, running_count: 0, not_run_count: 0, updated_at: now() });
        }
        applied.status = 'succeeded';
        applied.output = body.redeployAfterFix
          ? `Generated auto-fix deployed to ${computer.name || computer.bigfix_id}; original action redeployed`
          : `Generated auto-fix deployed to ${computer.name || computer.bigfix_id}`;
      } catch (error) {
        applied.status = 'failed';
        applied.output = `Generated auto-fix failed: ${error instanceof Error ? error.message : String(error)}`;
      }
      applied.completed_at = now();
      writeDb(db);
      return { success: applied.status !== 'failed', message: applied.output };
    }

    case 'redeploy-action': {
      const consoleConfig = getConsole(db, body.consoleId);
      const action = db.bigfix_actions.find(item => item.id === body.actionId);
      if (!action) throw new Error('Action not found');
      if (action.bigfix_id) await bigfixRequest(consoleConfig, `/action/${action.bigfix_id}/redeploy`, 'POST');
      Object.assign(action, { status: 'pending', completed_count: 0, failed_count: 0, running_count: 0, not_run_count: 0, updated_at: now() });
      writeDb(db);
      return { success: true, message: 'Action redeployed' };
    }

    default:
      throw new Error(`Unknown action: ${body.action}`);
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, { error: 'Use POST' }, 405);
    return;
  }

  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', async () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (!body.action) throw new Error('Missing action');
      sendJson(res, await handleAction(body));
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
});

server.listen(port, host, () => {
  console.log(`Local BigFix proxy listening on http://${host}:${port}`);
  console.log(`Local DB: ${dbPath}`);
  console.log(`TLS certificate validation: ${rejectUnauthorized ? 'enabled' : 'disabled for local testing'}`);
});
