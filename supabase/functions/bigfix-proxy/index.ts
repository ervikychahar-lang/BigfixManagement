import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
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

async function bigfixRequest(console: { host: string; port: number; username: string; password_encrypted: string }, path: string, method = "GET", body?: string) {
  const url = `https://${console.host}:${console.port}/api${path}`;
  const credentials = btoa(`${console.username}:${console.password_encrypted}`);
  const headers: Record<string, string> = {
    "Authorization": `Basic ${credentials}`,
    "Content-Type": "application/xml",
  };
  const opts: RequestInit = { method, headers };
  if (body) opts.body = body;
  const response = await fetch(url, opts);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`BigFix API error ${response.status}: ${text.substring(0, 500)}`);
  }
  return response;
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

function parseActionStatusXML(xml: string): Array<Record<string, string>> {
  const results: Array<Record<string, string>> = [];
  const resultRegex = /<Result\s+[^>]*?>([\s\S]*?)<\/Result>/g;
  let match;
  while ((match = resultRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      return m ? m[1].trim() : "";
    };
    results.push({
      ComputerID: get("ComputerID"),
      ComputerName: get("ComputerName"),
      Status: get("Status"),
      ResultCode: get("ResultCode"),
      ErrorMessage: get("ErrorMessage"),
      RetryCount: get("RetryCount") || "0",
      StartedAt: get("StartedAt"),
      CompletedAt: get("CompletedAt"),
    });
  }
  return results;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    switch (action) {
      case "test-connection": {
        const { consoleId } = body;
        const console = await getConsole(supabase, consoleId);
        try {
          const resp = await bigfixRequest(console, "/computers", "GET");
          const text = await resp.text();
          const versionMatch = text.match(/ServerVersion="([^"]+)"/);
          await supabase.from("bigfix_consoles").update({
            status: "connected",
            last_connected: new Date().toISOString(),
          }).eq("id", consoleId);
          return jsonResponse({ success: true, message: "Connection successful", serverVersion: versionMatch?.[1] || "Unknown" });
        } catch (e) {
          await supabase.from("bigfix_consoles").update({ status: "error" }).eq("id", consoleId);
          return jsonResponse({ success: false, message: (e as Error).message });
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
              .select("id").eq("bigfix_id", res.ComputerID).maybeSingle();

            if (compData.data) {
              const existing = await supabase.from("bigfix_action_results")
                .select("id").eq("action_id", actionData.data.id).eq("computer_id", compData.data.id).maybeSingle();

              const record = {
                action_id: actionData.data.id,
                computer_id: compData.data.id,
                status: res.Status,
                result_code: res.ResultCode,
                error_message: res.ErrorMessage,
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
        const console = await getConsole(supabase, consoleId);

        const contentData = await supabase.from("bigfix_content")
          .select("*").eq("id", contentId).maybeSingle();
        if (!contentData.data) throw new Error("Content not found");

        const actionXML = `<BES xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="BES.xsd">
  <SingleAction>
    <Title>${actionName || contentData.data.name}</Title>
    <Relevance>${contentData.data.relevance || "true"}</Relevance>
    <ActionScript>${contentData.data.action_script || ""}</ActionScript>
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
              .select("id").eq("bigfix_id", compBigfixId).maybeSingle();
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
        const { consoleId, actionId } = body;
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
              try { return new RegExp(r.error_pattern as string, "i").test((result.error_message as string) || ""); } catch { return false; }
            }
            return false;
          });

          const bestResolution = matchingResolutions[0];
          return {
            computerId: computer?.bigfix_id || "",
            computerName: computer?.name || "Unknown",
            status: result.result_code || "ERROR",
            isError: true,
            state: "Failed",
            lineNumber: 0,
            retryCount: result.retry_count || 0,
            proposedResolution: bestResolution ? {
              title: bestResolution.title,
              description: bestResolution.description,
              type: bestResolution.resolution_type,
              steps: bestResolution.resolution_steps || [],
              script: bestResolution.resolution_script || "",
            } : {
              title: "Generic Retry",
              description: "Retry the action on this computer",
              type: "manual",
              steps: ["Verify the endpoint is online", "Check disk space and permissions", "Retry the action"],
              script: "",
            },
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
              .select("*, bigfix_computers(bigfix_id), bigfix_actions(bigfix_id)")
              .eq("id", actionResultId).maybeSingle();

            if (resultData.data) {
              const computer = resultData.data.bigfix_computers as Record<string, string>;
              const act = resultData.data.bigfix_actions as Record<string, string>;
              const fixXML = `<BES xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="BES.xsd">
  <SingleAction>
    <Title>Auto-Fix: ${resolution.data.title}</Title>
    <Relevance>computer id = ${computer?.bigfix_id || "0"}</Relevance>
    <ActionScript>${resolution.data.resolution_script}</ActionScript>
  </SingleAction>
</BES>`;
              await bigfixRequest(console, "/action", "POST", fixXML);
            }

            await supabase.from("bigfix_applied_resolutions").update({
              status: "succeeded",
              output: "Auto-fix action deployed successfully",
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
