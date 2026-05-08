import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type BigFixConsoleConfig = {
  host: string;
  port: number;
  username: string;
  password_encrypted: string;
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 500) {
  return jsonResponse({ error: message }, status);
}

async function getConsole(supabase: ReturnType<typeof createClient>, consoleId: string) {
  const { data, error } = await supabase.from("bigfix_consoles").select("*").eq("id", consoleId).maybeSingle();
  if (error) throw new Error(`Failed to fetch console: ${error.message}`);
  if (!data) throw new Error("Console not found");
  return data;
}

function normalizeBigFixHost(host: string) {
  return host.trim().replace(/^https?:\/\//i, "").replace(/\/api\/?$/i, "").replace(/\/$/, "");
}

function getBigFixUrl(console: BigFixConsoleConfig, path: string) {
  const host = normalizeBigFixHost(console.host);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `https://${host}:${console.port}/api${normalizedPath}`;
}

function explainBigFixError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes("certificate") || lower.includes("cert") || lower.includes("tls")) {
    return `${message}. BigFix TLS certificate is not trusted by the edge runtime. Use a trusted certificate or deploy the proxy where your internal CA is trusted.`;
  }
  if (lower.includes("timed out") || lower.includes("abort")) {
    return `${message}. Check BigFix host, port 52311, firewall rules, and whether Supabase Edge Functions can reach that network.`;
  }
  if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("dns")) {
    return `${message}. BigFix may be unreachable from Supabase Edge Functions, blocked by firewall, or using a private DNS name.`;
  }

  return message;
}

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cleanXmlText(value: string) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function getXmlTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match ? cleanXmlText(match[1]) : "";
}

async function bigfixRequest(console: BigFixConsoleConfig, path: string, method = "GET", body?: string) {
  const url = getBigFixUrl(console, path);
  const credentials = btoa(`${console.username}:${console.password_encrypted}`);
  const headers: Record<string, string> = {
    "Authorization": `Basic ${credentials}`,
    "Content-Type": "application/xml",
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const opts: RequestInit = { method, headers, signal: controller.signal };
    if (body) opts.body = body;
    const response = await fetch(url, opts);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`BigFix API error ${response.status}: ${text.substring(0, 500)}`);
    }
    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`BigFix request timed out after 45 seconds for ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseComputersXML(xml: string): Array<Record<string, string>> {
  const computers: Array<Record<string, string>> = [];
  const computerRegex = /<Computer\s+[^>]*?>([\s\S]*?)<\/Computer>/g;
  let match;
  while ((match = computerRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      return m ? m[1].trim() : "";
    };
    computers.push({
      Name: get("Name"),
      ID: get("ID"),
      OS: get("OS"),
      IPAddress: get("IPAddress"),
      Subnet: get("Subnet"),
      AgentVersion: get("AgentVersion"),
      LastReport: get("LastReport"),
      IsOnline: get("IsOnline"),
      CustomSiteCount: get("CustomSiteCount"),
    });
  }
  return computers;
}

function parseContentXML(xml: string): Array<Record<string, string>> {
  const items: Array<Record<string, string>> = [];
  const itemRegex = /<(?:Fixlet|Task|Baseline|Patch)\s+[^>]*?>([\s\S]*?)<\/(?:Fixlet|Task|Baseline|Patch)>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      return m ? m[1].trim() : "";
    };
    items.push({
      Name: get("Name"),
      ID: get("ID"),
      Description: get("Description"),
      Severity: get("Severity") || "normal",
      Category: get("Category"),
      SourceID: get("SourceID"),
      SourceName: get("SourceName"),
      Relevance: get("Relevance"),
      ActionScript: get("ActionScript"),
      SiteID: get("SiteID"),
      IsApplicableCount: get("IsApplicableCount") || "0",
      IsEnabled: get("IsEnabled") || "true",
    });
  }
  return items;
}

function parseActionsXML(xml: string): Array<Record<string, string>> {
  const actions: Array<Record<string, string>> = [];
  const actionRegex = /<Action\s+[^>]*?>([\s\S]*?)<\/Action>/g;
  let match;
  while ((match = actionRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      return m ? m[1].trim() : "";
    };
    actions.push({
      Name: get("Name"),
      ID: get("ID"),
      Type: get("Type") || "fixlet",
      Status: get("Status") || "pending",
      TargetCount: get("TargetCount") || "0",
      CompletedCount: get("CompletedCount") || "0",
      FailedCount: get("FailedCount") || "0",
      RunningCount: get("RunningCount") || "0",
      NotRunCount: get("NotRunCount") || "0",
      StartTime: get("StartTime"),
      EndTime: get("EndTime"),
      CreatedBy: get("CreatedBy"),
      IsDistributed: get("IsDistributed") || "false",
    });
  }
  return actions;
}

function parseTupleQueryXML(xml: string): string[][] {
  const tuples: string[][] = [];
  const tupleRegex = /<Tuple\b[^>]*>([\s\S]*?)<\/Tuple>/g;
  let tupleMatch;
  while ((tupleMatch = tupleRegex.exec(xml)) !== null) {
    const answers = [...tupleMatch[1].matchAll(/<Answer\b[^>]*>([\s\S]*?)<\/Answer>/g)].map(match => cleanXmlText(match[1]));
    if (answers.length > 0) tuples.push(answers);
  }
  if (tuples.length > 0) return tuples;
  return [...xml.matchAll(/<Answer\b[^>]*>([\s\S]*?)<\/Answer>/g)].map(match => [cleanXmlText(match[1])]);
}

function contentRelevanceType(contentType: string) {
  if (contentType === "task") return "bes tasks";
  if (contentType === "baseline") return "bes baselines";
  return "bes fixlets";
}

function parseActionStatusXML(xml: string): Array<Record<string, string>> {
  const results: Array<Record<string, string>> = [];
  const resultRegex = /<Result\b[^>]*>([\s\S]*?)<\/Result>/g;
  let match;
  while ((match = resultRegex.exec(xml)) !== null) {
    const block = match[1];
    results.push({
      ComputerID: getXmlTag(block, "ComputerID"),
      ComputerName: getXmlTag(block, "ComputerName"),
      Status: getXmlTag(block, "Status"),
      State: getXmlTag(block, "State"),
      LineNumber: getXmlTag(block, "LineNumber") || getXmlTag(block, "Line"),
      ResultCode: getXmlTag(block, "ResultCode") || getXmlTag(block, "ExitCode"),
      ErrorMessage: getXmlTag(block, "ErrorMessage") || getXmlTag(block, "Error"),
      RetryCount: getXmlTag(block, "RetryCount") || "0",
      StartedAt: getXmlTag(block, "StartedAt") || getXmlTag(block, "StartTime"),
      CompletedAt: getXmlTag(block, "CompletedAt") || getXmlTag(block, "EndTime"),
      LogDetail: extractActionLogDetail(block),
    });
  }
  return results.map(result => ({ ...result, LogExcerpt: buildLogExcerpt(result, result.LogDetail) }));
}

function extractActionLogDetail(block: string) {
  const tags = [
    "Log",
    "ActionLog",
    "ActionLogText",
    "LogText",
    "LogExcerpt",
    "ExecutionLog",
    "Output",
    "StdOut",
    "StdErr",
    "ResultText",
    "ErrorText",
    "LastError",
    "FailureReason",
    "Message",
    "DownloadStatus",
  ];
  const details: string[] = [];
  for (const tag of tags) {
    const value = getXmlTag(block, tag);
    if (value && !details.includes(value)) details.push(value);
  }
  return details.join(" | ").slice(0, 4000);
}

function buildLogExcerpt(result: Record<string, string>, logDetail = "") {
  const parts = [];
  if (result.Status) parts.push(`Status: ${result.Status}`);
  if (result.State) parts.push(`State: ${result.State}`);
  if (result.LineNumber) parts.push(`Line: ${result.LineNumber}`);
  if (result.ResultCode) parts.push(`Exit/Result code: ${result.ResultCode}`);
  if (result.ErrorMessage) parts.push(`Message: ${result.ErrorMessage}`);
  if (logDetail) parts.push(`Log detail: ${logDetail}`);
  return parts.join(" | ");
}

function generateActionScriptFromSteps(steps: string[], title = "Generated Auto-Fix") {
  const text = `${title} ${(steps || []).join(" ")}`.toLowerCase();
  const lines = [
    `// Auto-generated from proposed solution steps: ${title}`,
    "if {windows of operating system}",
  ];
  let addedCommand = false;

  if (/besclient|client service|agent|relay autoselection|relay selection/.test(text)) {
    lines.push("waithidden sc.exe stop BESClient");
    lines.push('pause while {exists running service "BESClient"}');
    lines.push("waithidden sc.exe start BESClient");
    addedCommand = true;
  }
  if (/disk|space|temp|temporary|storage/.test(text)) {
    lines.push('waithidden cmd.exe /C if exist "%windir%\\Temp" del /q /f /s "%windir%\\Temp\\*"');
    addedCommand = true;
  }
  if (/download|prefetch|hash|sha1|sha256|relay cache/.test(text)) {
    lines.push("delete __Download");
    addedCommand = true;
  }
  if (!addedCommand) lines.push("waithidden cmd.exe /C echo Auto-fix analysis completed");
  lines.push("endif");
  return lines.join("\n");
}

function proposeLogBasedResolution(result: Record<string, unknown>, bestResolution?: Record<string, unknown>) {
  if (bestResolution) {
    const steps = (bestResolution.resolution_steps as string[] | undefined) || [];
    const type = String(bestResolution.resolution_type || "manual");
    const script = String(bestResolution.resolution_script || "") || (type === "auto" ? generateActionScriptFromSteps(steps, String(bestResolution.title || "Generated Auto-Fix")) : "");
    return {
      title: bestResolution.title,
      description: bestResolution.description,
      type,
      steps,
      script,
      resolutionId: bestResolution.id,
      generatedScript: type === "auto" && !bestResolution.resolution_script,
    };
  }

  const text = `${result.result_code || ""} ${result.error_message || ""} ${result.log_excerpt || ""} ${result.state || ""}`.toLowerCase();
  let title = "Manual log-based remediation";
  let description = "Generated from the failed action log evidence. Review the captured log detail before redeploying.";
  let type = "manual";
  let steps = [
    "Review the captured log line and result code for the exact failing operation.",
    "Fix the endpoint or package condition identified in the log evidence.",
    "Redeploy the original action after remediation.",
  ];

  if (/besclient|client service|agent.*stuck|not responding|relay autoselection|relay selection/.test(text)) {
    title = "Restart BigFix Client and retry";
    description = "The log evidence points to a stuck client or relay-processing condition.";
    type = "auto";
    steps = ["Restart the BESClient service on the affected endpoint.", "Wait for the client to report back.", "Redeploy the original action."];
  } else if (/download|prefetch|hash|sha1|sha256|size mismatch|relay cache/.test(text)) {
    title = "Clear BigFix download cache and retry";
    description = "The log evidence points to a download, prefetch, or hash-verification failure.";
    type = "auto";
    steps = ["Clear the BigFix action download cache.", "Force the endpoint to download a fresh payload from its relay.", "Redeploy the original action."];
  } else if (/temp|temporary/.test(text) && /disk|space|storage/.test(text)) {
    title = "Clean temporary files and retry";
    description = "The log evidence points to temporary storage pressure.";
    type = "auto";
    steps = ["Clean Windows temporary files.", "Confirm the endpoint can report back.", "Redeploy the original action."];
  } else if (/disk|space|not enough storage|insufficient/.test(text)) {
    title = "Free endpoint disk space";
    description = "The log evidence points to insufficient disk space. Keep this manual unless automated cleanup is approved.";
    steps = ["Check free space on the system and BigFix client drives.", "Remove stale payloads or expand disk capacity.", "Redeploy after enough free space is available."];
  } else if (/1618|another installation|msiexec/.test(text)) {
    title = "Wait for active installer and retry";
    description = "The log evidence points to another Windows Installer transaction.";
    steps = ["Check for active msiexec.exe or installation activity.", "Wait for it to finish or reboot if it is stuck.", "Redeploy the original action."];
  } else if (/1603|fatal error during installation|msi.*fatal/.test(text)) {
    title = "Investigate MSI fatal install condition";
    description = "The log evidence points to MSI error 1603, which usually needs package or endpoint validation.";
    steps = ["Check the failing MSI command and vendor log around the captured line.", "Verify prerequisites, pending reboot, permissions, and locked files.", "Fix the package condition and redeploy."];
  } else if (/locked/.test(text)) {
    title = "Unlock endpoint for actions";
    description = "The log evidence says the endpoint is locked for actions.";
    steps = ["Confirm the endpoint lock state in BigFix.", "Unlock the endpoint or adjust the locking policy.", "Redeploy the original action."];
  } else if (/timeout|timed out|unreachable|connection/.test(text)) {
    title = "Restore endpoint or relay connectivity";
    description = "The log evidence points to connectivity or timeout.";
    steps = ["Confirm the endpoint is online and reporting.", "Check relay connectivity and firewall path.", "Redeploy after the endpoint reports successfully."];
  }

  return {
    title,
    description,
    type,
    steps,
    script: type === "auto" ? generateActionScriptFromSteps(steps, title) : "",
    generatedScript: true,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action } = body;
    if (!action || typeof action !== "string") {
      return errorResponse("Missing action", 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      return errorResponse("Supabase function is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", 500);
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    switch (action) {
      case "test-connection": {
        const { consoleId } = body;
        if (!consoleId) return errorResponse("Missing consoleId", 400);
        const console = await getConsole(supabase, consoleId);
        try {
          const relevance = encodeURIComponent("version of server");
          const resp = await bigfixRequest(console, `/query?relevance=${relevance}`, "GET");
          const text = await resp.text();
          const versionMatch = text.match(/<Answer[^>]*>([^<]+)<\/Answer>/) || text.match(/ServerVersion="([^"]+)"/);
          await supabase.from("bigfix_consoles").update({
            status: "connected",
            last_connected: new Date().toISOString(),
          }).eq("id", consoleId);
          return jsonResponse({ success: true, message: "Connection successful", serverVersion: versionMatch?.[1] || "Unknown" });
        } catch (e) {
          await supabase.from("bigfix_consoles").update({ status: "error" }).eq("id", consoleId);
          return jsonResponse({ success: false, message: explainBigFixError(e) });
        }
      }

      case "fetch-computers": {
        const { consoleId } = body;
        const console = await getConsole(supabase, consoleId);
        const resp = await bigfixRequest(console, "/computers");
        const text = await resp.text();
        const parsed = parseComputersXML(text);

        for (const comp of parsed) {
          const existing = await supabase.from("bigfix_computers")
            .select("id").eq("console_id", consoleId).eq("bigfix_id", comp.ID).maybeSingle();

          const record = {
            console_id: consoleId,
            bigfix_id: comp.ID,
            name: comp.Name,
            os: comp.OS,
            ip_address: comp.IPAddress,
            subnet: comp.Subnet,
            agent_version: comp.AgentVersion,
            last_report: comp.LastReport || null,
            is_online: comp.IsOnline === "true",
            custom_site_count: parseInt(comp.CustomSiteCount) || 0,
            updated_at: new Date().toISOString(),
          };

          if (existing.data) {
            await supabase.from("bigfix_computers").update(record).eq("id", existing.data.id);
          } else {
            await supabase.from("bigfix_computers").insert(record);
          }
        }

        await supabase.from("bigfix_consoles").update({
          status: "connected",
          last_connected: new Date().toISOString(),
        }).eq("id", consoleId);

        return jsonResponse({ success: true, count: parsed.length, message: `Synced ${parsed.length} computers` });
      }

      case "fetch-content": {
        const { consoleId, type } = body;
        const console = await getConsole(supabase, consoleId);
        const contentType = type || "fixlet";
        const resp = await bigfixRequest(console, `/${contentType}s`);
        const text = await resp.text();
        const parsed = parseContentXML(text);

        for (const item of parsed) {
          const existing = await supabase.from("bigfix_content")
            .select("id").eq("console_id", consoleId).eq("bigfix_id", item.ID).maybeSingle();

          const record = {
            console_id: consoleId,
            bigfix_id: item.ID,
            site_id: item.SiteID,
            type: contentType,
            name: item.Name,
            description: item.Description,
            severity: item.Severity || "normal",
            category: item.Category,
            source_id: item.SourceID,
            source_name: item.SourceName,
            relevance: item.Relevance,
            action_script: item.ActionScript,
            is_applicable_count: parseInt(item.IsApplicableCount) || 0,
            is_enabled: item.IsEnabled !== "false",
            updated_at: new Date().toISOString(),
          };

          if (existing.data) {
            await supabase.from("bigfix_content").update(record).eq("id", existing.data.id);
          } else {
            await supabase.from("bigfix_content").insert(record);
          }
        }

        return jsonResponse({ success: true, count: parsed.length, message: `Synced ${parsed.length} ${contentType}s` });
      }

      case "list-applicable-computers": {
        const { consoleId, contentId } = body;
        const console = await getConsole(supabase, consoleId);
        const contentData = await supabase.from("bigfix_content")
          .select("*").eq("id", contentId).eq("console_id", consoleId).maybeSingle();
        if (!contentData.data) throw new Error("Content not found");

        const content = contentData.data as Record<string, string>;
        const objectType = contentRelevanceType(content.type);
        const filters = [`id of it as string = ${JSON.stringify(String(content.bigfix_id || ""))}`];
        const siteName = String(content.site_id || content.source_name || "");
        if (siteName) filters.push(`name of site of it = ${JSON.stringify(siteName)}`);
        const relevance = `(id of it as string, name of it | "", operating system of it | "", concatenation "," of ip addresses of it, last report time of it as string | "", if exists client version of it then client version of it as string else "", if active flag of it then "true" else "false") of applicable computers of ${objectType} whose (${filters.join(" and ")})`;
        const resp = await bigfixRequest(console, `/query?relevance=${encodeURIComponent(relevance)}`, "GET");
        const rows = parseTupleQueryXML(await resp.text());
        const seen = new Set<string>();
        const data = rows
          .map(row => ({
            id: row[0] || "",
            console_id: consoleId,
            bigfix_id: row[0] || "",
            name: row[1] || row[0] || "",
            os: row[2] || "",
            ip_address: row[3] || "",
            subnet: "",
            last_report: row[4] || null,
            is_online: row[6] === "true",
            agent_version: row[5] || "",
            custom_site_count: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }))
          .filter(item => {
            if (!item.bigfix_id || seen.has(item.bigfix_id)) return false;
            seen.add(item.bigfix_id);
            return true;
          })
          .sort((a, b) => String(a.name).localeCompare(String(b.name)));
        return jsonResponse({ data, count: data.length });
      }

      case "fetch-actions": {
        const { consoleId } = body;
        const console = await getConsole(supabase, consoleId);
        const resp = await bigfixRequest(console, "/actions");
        const text = await resp.text();
        const parsed = parseActionsXML(text);

        for (const act of parsed) {
          const existing = await supabase.from("bigfix_actions")
            .select("id").eq("console_id", consoleId).eq("bigfix_id", act.ID).maybeSingle();

          const record = {
            console_id: consoleId,
            bigfix_id: act.ID,
            name: act.Name,
            type: act.Type,
            status: act.Status.toLowerCase(),
            target_count: parseInt(act.TargetCount) || 0,
            completed_count: parseInt(act.CompletedCount) || 0,
            failed_count: parseInt(act.FailedCount) || 0,
            running_count: parseInt(act.RunningCount) || 0,
            not_run_count: parseInt(act.NotRunCount) || 0,
            start_time: act.StartTime || null,
            end_time: act.EndTime || null,
            created_by: act.CreatedBy,
            is_distributed: act.IsDistributed === "true",
            updated_at: new Date().toISOString(),
          };

          if (existing.data) {
            await supabase.from("bigfix_actions").update(record).eq("id", existing.data.id);
          } else {
            await supabase.from("bigfix_actions").insert(record);
          }
        }

        return jsonResponse({ success: true, count: parsed.length, message: `Synced ${parsed.length} actions` });
      }

      case "fetch-action-status": {
        const { consoleId, actionBigfixId } = body;
        const console = await getConsole(supabase, consoleId);
        const resp = await bigfixRequest(console, `/action/${actionBigfixId}/status`);
        const text = await resp.text();
        const parsed = parseActionStatusXML(text);

        const actionData = await supabase.from("bigfix_actions")
          .select("id").eq("console_id", consoleId).eq("bigfix_id", actionBigfixId).maybeSingle();

        if (actionData.data) {
          for (const res of parsed) {
            const compData = await supabase.from("bigfix_computers")
              .select("id").eq("console_id", consoleId).eq("bigfix_id", res.ComputerID).maybeSingle();

            if (compData.data) {
              const existing = await supabase.from("bigfix_action_results")
                .select("id").eq("action_id", actionData.data.id).eq("computer_id", compData.data.id).maybeSingle();

              const record = {
                action_id: actionData.data.id,
                computer_id: compData.data.id,
                status: res.Status,
                state: res.State,
                line_number: parseInt(res.LineNumber) || 0,
                result_code: res.ResultCode,
                error_message: res.ErrorMessage,
                log_excerpt: res.LogExcerpt,
                retry_count: parseInt(res.RetryCount) || 0,
                started_at: res.StartedAt || null,
                completed_at: res.CompletedAt || null,
                updated_at: new Date().toISOString(),
              };

              if (existing.data) {
                await supabase.from("bigfix_action_results").update(record).eq("id", existing.data.id);
              } else {
                await supabase.from("bigfix_action_results").insert(record);
              }
            }
          }

          const completed = parsed.filter(r => r.Status === "Completed").length;
          const failed = parsed.filter(r => r.Status === "Failed").length;
          const running = parsed.filter(r => r.Status === "Running").length;
          const notRun = parsed.filter(r => r.Status === "NotRun").length;
          const allDone = running === 0 && parsed.length > 0;
          await supabase.from("bigfix_actions").update({
            completed_count: completed,
            failed_count: failed,
            running_count: running,
            not_run_count: notRun,
            status: allDone ? (failed > 0 ? "failed" : "completed") : "running",
            updated_at: new Date().toISOString(),
          }).eq("id", actionData.data.id);
        }

        return jsonResponse({ success: true, count: parsed.length, message: `Updated ${parsed.length} results` });
      }

      case "deploy-action": {
        const { consoleId, contentId, targetComputerIds, actionName } = body;
        if (!Array.isArray(targetComputerIds) || targetComputerIds.length === 0) {
          return errorResponse("Select at least one target computer before deploying an action", 400);
        }
        const console = await getConsole(supabase, consoleId);

        const contentData = await supabase.from("bigfix_content")
          .select("*").eq("id", contentId).maybeSingle();
        if (!contentData.data) throw new Error("Content not found");

        const targetXml = (targetComputerIds || [])
          .map((id: string) => `      <ComputerID>${escapeXml(id)}</ComputerID>`)
          .join("\n");
        const actionXML = `<BES xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="BES.xsd">
  <SingleAction>
    <Title>${escapeXml(actionName || contentData.data.name)}</Title>
    <Relevance>${escapeXml(contentData.data.relevance || "true")}</Relevance>
    <ActionScript>${escapeXml(contentData.data.action_script || "")}</ActionScript>
    <Target>
${targetXml}
    </Target>
    <Settings>
      <HasRunningTimeLimit>true</HasRunningTimeLimit>
      <RunningTimeLimitMinutes>60</RunningTimeLimitMinutes>
    </Settings>
  </SingleAction>
</BES>`;

        const resp = await bigfixRequest(console, "/action", "POST", actionXML);
        const text = await resp.text();
        const idMatch = text.match(/<ID>([^<]+)<\/ID>/);
        const bigfixActionId = idMatch?.[1] || "";

        const { data: newAction } = await supabase.from("bigfix_actions").insert({
          console_id: consoleId,
          bigfix_id: bigfixActionId,
          content_id: contentId,
          name: actionName || contentData.data.name,
          type: contentData.data.type,
          status: "pending",
          target_count: targetComputerIds.length,
          created_by: console.username,
        }).select().maybeSingle();

        if (newAction) {
          for (const compBigfixId of targetComputerIds) {
            const comp = await supabase.from("bigfix_computers")
              .select("id").eq("console_id", consoleId).eq("bigfix_id", compBigfixId).maybeSingle();
            if (comp.data) {
              await supabase.from("bigfix_action_results").insert({
                action_id: newAction.id,
                computer_id: comp.data.id,
                status: "Pending",
              });
            }
          }
        }

        return jsonResponse({ success: true, actionId: newAction?.id, bigfixActionId, message: "Action deployed" });
      }

      case "stop-action": {
        const { consoleId, actionId } = body;
        const console = await getConsole(supabase, consoleId);
        const actionData = await supabase.from("bigfix_actions")
          .select("bigfix_id").eq("id", actionId).maybeSingle();
        if (!actionData.data?.bigfix_id) throw new Error("Action not found");

        await bigfixRequest(console, `/action/${actionData.data.bigfix_id}/stop`, "POST");
        await supabase.from("bigfix_actions").update({ status: "stopped", updated_at: new Date().toISOString() }).eq("id", actionId);

        return jsonResponse({ success: true, message: "Action stopped" });
      }

      case "analyze-failures": {
        const { actionId } = body;
        const actionData = await supabase.from("bigfix_actions")
          .select("*").eq("id", actionId).maybeSingle();
        if (!actionData.data) throw new Error("Action not found");

        const { data: failedResults } = await supabase.from("bigfix_action_results")
          .select("*, bigfix_computers(name, os, ip_address, bigfix_id)")
          .eq("action_id", actionId)
          .eq("status", "Failed");

        const { data: resolutions } = await supabase.from("bigfix_failure_resolutions")
          .select("*").order("use_count", { ascending: false });

        const analysis = (failedResults || []).map((result: Record<string, unknown>) => {
          const computer = result.bigfix_computers as Record<string, string>;
          const matchingResolutions = (resolutions || []).filter((r: Record<string, unknown>) => {
            if (r.error_code && result.result_code && r.error_code === result.result_code) return true;
            if (r.error_pattern) {
              try {
                return new RegExp(r.error_pattern as string, "i").test(`${result.error_message || ""} ${result.log_excerpt || ""} ${result.result_code || ""}`);
              } catch { return false; }
            }
            return false;
          });

          const bestResolution = matchingResolutions[0];
          return {
            actionResultId: result.id,
            computerId: computer?.bigfix_id || "",
            computerName: computer?.name || "Unknown",
            status: result.result_code || "ERROR",
            isError: true,
            state: result.state || "Failed",
            lineNumber: result.line_number || 0,
            logExcerpt: result.log_excerpt || "",
            retryCount: result.retry_count || 0,
            proposedResolution: proposeLogBasedResolution(result, bestResolution),
          };
        });

        return jsonResponse({
          success: true,
          analysis,
          failedComputers: analysis.length,
          totalComputers: actionData.data.target_count || 0,
          actionName: actionData.data.name,
        });
      }

      case "apply-fix": {
        const { consoleId, actionResultId, resolutionId, appliedBy } = body;
        const resolution = await supabase.from("bigfix_failure_resolutions")
          .select("*").eq("id", resolutionId).maybeSingle();
        if (!resolution.data) throw new Error("Resolution not found");

        const { data: appliedRes } = await supabase.from("bigfix_applied_resolutions").insert({
          action_result_id: actionResultId,
          resolution_id: resolutionId,
          status: "running",
          applied_by: appliedBy,
        }).select().maybeSingle();

        if (appliedRes && resolution.data.resolution_type === "auto" && resolution.data.resolution_script) {
          try {
            const console = await getConsole(supabase, consoleId);
            const resultData = await supabase.from("bigfix_action_results")
              .select("*, bigfix_computers(bigfix_id), bigfix_actions(id,bigfix_id)")
              .eq("id", actionResultId).maybeSingle();

            if (resultData.data) {
              const computer = resultData.data.bigfix_computers as Record<string, string>;
              const originalAction = resultData.data.bigfix_actions as Record<string, string>;
              const fixXML = `<BES xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="BES.xsd">
  <SingleAction>
    <Title>${escapeXml(`Auto-Fix: ${resolution.data.title}`)}</Title>
    <Relevance>${escapeXml(`computer id = ${computer?.bigfix_id || "0"}`)}</Relevance>
    <ActionScript>${escapeXml(resolution.data.resolution_script)}</ActionScript>
  </SingleAction>
</BES>`;
              await bigfixRequest(console, "/action", "POST", fixXML);
              if (body.redeployAfterFix && originalAction?.bigfix_id) {
                await bigfixRequest(console, `/action/${originalAction.bigfix_id}/redeploy`, "POST");
                await supabase.from("bigfix_actions").update({
                  status: "pending",
                  completed_count: 0,
                  failed_count: 0,
                  running_count: 0,
                  not_run_count: 0,
                  updated_at: new Date().toISOString(),
                }).eq("id", originalAction.id);
              }
            }

            await supabase.from("bigfix_applied_resolutions").update({
              status: "succeeded",
              output: body.redeployAfterFix ? "Auto-fix action deployed and original action redeployed" : "Auto-fix action deployed successfully",
              completed_at: new Date().toISOString(),
            }).eq("id", appliedRes.id);

            await supabase.from("bigfix_failure_resolutions").update({
              use_count: (resolution.data.use_count || 0) + 1,
            }).eq("id", resolutionId);
          } catch (e) {
            await supabase.from("bigfix_applied_resolutions").update({
              status: "failed",
              output: `Auto-fix failed: ${(e as Error).message}`,
              completed_at: new Date().toISOString(),
            }).eq("id", appliedRes.id);
          }
        } else {
          await supabase.from("bigfix_applied_resolutions").update({
            status: "succeeded",
            output: "Manual resolution marked as applied",
            completed_at: new Date().toISOString(),
          }).eq("id", appliedRes.id);
          await supabase.from("bigfix_failure_resolutions").update({
            use_count: (resolution.data.use_count || 0) + 1,
          }).eq("id", resolutionId);
        }

        return jsonResponse({ success: true, message: "Fix applied" });
      }

      case "apply-generated-fix": {
        const { consoleId, actionResultId, proposedResolution, redeployAfterFix } = body;
        const script = String(proposedResolution?.script || "");
        if (!script.trim()) throw new Error("Generated fix script is empty");
        const console = await getConsole(supabase, consoleId);
        const resultData = await supabase.from("bigfix_action_results")
          .select("*, bigfix_computers(bigfix_id,name), bigfix_actions(id,bigfix_id,name)")
          .eq("id", actionResultId).maybeSingle();
        if (!resultData.data) throw new Error("Action result not found");
        const computer = resultData.data.bigfix_computers as Record<string, string>;
        const originalAction = resultData.data.bigfix_actions as Record<string, string>;
        let resolutionId = proposedResolution?.resolutionId || null;
        if (!resolutionId) {
          const { data: generatedResolution } = await supabase.from("bigfix_failure_resolutions").insert({
            error_code: resultData.data.result_code || "",
            error_pattern: resultData.data.error_message || resultData.data.log_excerpt || "",
            title: proposedResolution?.title || "Generated auto-fix",
            description: proposedResolution?.description || "Generated from failed action log details.",
            resolution_type: "auto",
            resolution_script: script,
            resolution_steps: proposedResolution?.steps || [],
            is_verified: false,
            use_count: 0,
            success_rate: 0,
          }).select("id").maybeSingle();
          resolutionId = generatedResolution?.id || null;
        }

        const { data: appliedRes } = await supabase.from("bigfix_applied_resolutions").insert({
          action_result_id: actionResultId,
          resolution_id: resolutionId,
          status: "running",
          applied_by: "auto",
        }).select().maybeSingle();

        try {
          const fixXML = `<BES xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="BES.xsd">
  <SingleAction>
    <Title>${escapeXml(`Auto-Fix: ${proposedResolution?.title || originalAction?.name || "Generated remediation"}`)}</Title>
    <Relevance>${escapeXml(`computer id = ${computer?.bigfix_id || "0"}`)}</Relevance>
    <ActionScript>${escapeXml(script)}</ActionScript>
  </SingleAction>
</BES>`;
          await bigfixRequest(console, "/action", "POST", fixXML);
          if (redeployAfterFix && originalAction?.bigfix_id) {
            await bigfixRequest(console, `/action/${originalAction.bigfix_id}/redeploy`, "POST");
            await supabase.from("bigfix_actions").update({
              status: "pending",
              completed_count: 0,
              failed_count: 0,
              running_count: 0,
              not_run_count: 0,
              updated_at: new Date().toISOString(),
            }).eq("id", originalAction.id);
          }
          if (appliedRes) {
            await supabase.from("bigfix_applied_resolutions").update({
              status: "succeeded",
              output: redeployAfterFix ? "Generated auto-fix deployed and original action redeployed" : "Generated auto-fix deployed",
              completed_at: new Date().toISOString(),
            }).eq("id", appliedRes.id);
          }
          return jsonResponse({ success: true, message: "Generated auto-fix applied" });
        } catch (e) {
          if (appliedRes) {
            await supabase.from("bigfix_applied_resolutions").update({
              status: "failed",
              output: `Generated auto-fix failed: ${(e as Error).message}`,
              completed_at: new Date().toISOString(),
            }).eq("id", appliedRes.id);
          }
          throw e;
        }
      }

      case "redeploy-action": {
        const { consoleId, actionId } = body;
        const console = await getConsole(supabase, consoleId);
        const actionData = await supabase.from("bigfix_actions")
          .select("*").eq("id", actionId).maybeSingle();
        if (!actionData.data) throw new Error("Action not found");

        if (actionData.data.bigfix_id) {
          await bigfixRequest(console, `/action/${actionData.data.bigfix_id}/redeploy`, "POST");
        }

        await supabase.from("bigfix_actions").update({
          status: "pending",
          completed_count: 0,
          failed_count: 0,
          running_count: 0,
          not_run_count: 0,
          updated_at: new Date().toISOString(),
        }).eq("id", actionId);

        return jsonResponse({ success: true, message: "Action redeployed" });
      }

      case "fetch-sites": {
        const { consoleId } = body;
        const console = await getConsole(supabase, consoleId);
        const resp = await bigfixRequest(console, "/sites");
        const text = await resp.text();
        return jsonResponse({ success: true, data: text.substring(0, 2000) });
      }

      default:
        return errorResponse(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    return errorResponse((e as Error).message);
  }
});
