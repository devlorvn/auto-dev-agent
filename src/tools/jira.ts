import { tool } from "@langchain/core/tools";
import { z } from "zod";

export interface JiraConfig {
  host: string;
  token: string;
  email?: string;
}

/**
 * Lấy cấu hình Jira từ environment variables hoặc .env
 * Hỗ trợ:
 * - JIRA_HOST hoặc JIRA_URL hoặc JIRA_BASE_URL (ví dụ: https://mycompany.atlassian.net)
 * - JIRA_API_TOKEN hoặc JIRA_TOKEN
 * - JIRA_EMAIL hoặc JIRA_USER (bắt buộc đối với Jira Cloud Basic Auth)
 */
export function getJiraConfig(): JiraConfig {
  let host =
    process.env.JIRA_HOST ||
    process.env.JIRA_URL ||
    process.env.JIRA_BASE_URL ||
    "";
  const token = process.env.JIRA_API_TOKEN || process.env.JIRA_TOKEN || "";
  const email =
    process.env.JIRA_EMAIL ||
    process.env.JIRA_USER ||
    process.env.JIRA_USERNAME ||
    "";

  if (!host) {
    throw new Error(
      'Jira Host is not configured. Please set JIRA_HOST in your .env file or environment (e.g. JIRA_HOST="https://your-domain.atlassian.net").',
    );
  }

  if (!token) {
    throw new Error(
      "Jira Token is not configured. Please set JIRA_API_TOKEN or JIRA_TOKEN in your .env file or environment.",
    );
  }

  // Chuẩn hóa host URL: thêm https:// nếu thiếu, bỏ trailing slashes
  host = host.trim();
  if (!/^https?:\/\//i.test(host)) {
    host = `https://${host}`;
  }
  host = host.replace(/\/+$/, "");

  return { host, token: token.trim(), email: email.trim() };
}

/**
 * Sinh headers xác thực cho Jira REST API:
 * - Jira Cloud: Basic Auth với base64(email:api_token)
 * - Jira Server / Data Center (PAT): Bearer token
 */
export function getJiraAuthHeaders(config: JiraConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  if (config.email) {
    const credentials = Buffer.from(
      `${config.email}:${config.token}`,
    ).toString("base64");
    headers.Authorization = `Basic ${credentials}`;
  } else if (
    config.token.startsWith("Basic ") ||
    config.token.startsWith("Bearer ")
  ) {
    headers.Authorization = config.token;
  } else {
    headers.Authorization = `Bearer ${config.token}`;
  }

  return headers;
}

/**
 * Chuyển đổi Atlassian Document Format (ADF) sang Markdown có cấu trúc
 */
export function parseAdfToMarkdown(node: any): string {
  if (!node) return "";

  if (typeof node === "string") return node;

  if (node.type === "text") {
    let text = node.text || "";
    if (node.marks && Array.isArray(node.marks)) {
      for (const mark of node.marks) {
        if (mark.type === "code") text = `\`${text}\``;
        else if (mark.type === "strong") text = `**${text}**`;
        else if (mark.type === "em") text = `*${text}*`;
        else if (mark.type === "strike") text = `~~${text}~~`;
        else if (mark.type === "link" && mark.attrs?.href) {
          text = `[${text}](${mark.attrs.href})`;
        }
      }
    }
    return text;
  }

  const childContents = Array.isArray(node.content)
    ? node.content.map(parseAdfToMarkdown)
    : [];

  switch (node.type) {
    case "doc":
      return childContents.join("").trim();
    case "paragraph":
      return `${childContents.join("")}\n\n`;
    case "heading": {
      const level = Math.min(Math.max(node.attrs?.level || 1, 1), 6);
      return `${"#".repeat(level)} ${childContents.join("")}\n\n`;
    }
    case "bulletList":
      return (
        childContents.map((item) => `- ${item.trim()}\n`).join("") + "\n"
      );
    case "orderedList":
      return (
        childContents
          .map((item, idx) => `${idx + 1}. ${item.trim()}\n`)
          .join("") + "\n"
      );
    case "listItem":
      return childContents.join(" ").trim();
    case "codeBlock":
      return `\`\`\`${node.attrs?.language || ""}\n${childContents.join("")}\n\`\`\`\n\n`;
    case "blockquote":
      return `> ${childContents.join("").trim()}\n\n`;
    case "hardBreak":
      return "\n";
    case "rule":
      return "\n---\n\n";
    default:
      return childContents.join("");
  }
}

export interface JiraIssueResult {
  key: string;
  title: string;
  body: string;
  labels: string[];
  issueType: string;
  status?: string;
  priority?: string;
}

/**
 * Gọi REST API của Jira để lấy thông tin chi tiết Issue
 */
export async function getJiraIssue(issueId: string): Promise<JiraIssueResult> {
  const config = getJiraConfig();
  const headers = getJiraAuthHeaders(config);

  const cleanIssueId = issueId.trim();
  const url = `${config.host}/rest/api/2/issue/${encodeURIComponent(cleanIssueId)}?expand=renderedFields,names`;

  let response = await fetch(url, { method: "GET", headers });

  // Nếu API v2 trả về 404 thì thử fallback sang API v3 (Jira Cloud hiện đại)
  if (!response.ok && response.status === 404) {
    const v3Url = `${config.host}/rest/api/3/issue/${encodeURIComponent(cleanIssueId)}?expand=renderedFields,names`;
    const v3Response = await fetch(v3Url, { method: "GET", headers });
    if (v3Response.ok) {
      response = v3Response;
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    let message = `Jira API request failed with status ${response.status} (${response.statusText})`;
    try {
      const errJson = JSON.parse(errorText);
      if (errJson.errorMessages && errJson.errorMessages.length > 0) {
        message += `: ${errJson.errorMessages.join(", ")}`;
      } else if (errJson.errors) {
        message += `: ${JSON.stringify(errJson.errors)}`;
      }
    } catch {
      if (errorText) message += `: ${errorText}`;
    }

    if (response.status === 401) {
      message +=
        "\n👉 Authentication failed. For Jira Cloud, make sure JIRA_EMAIL and JIRA_API_TOKEN are set correctly. For Jira Server/DC, check JIRA_TOKEN.";
    } else if (response.status === 404) {
      message += `\n👉 Jira issue "${cleanIssueId}" not found. Please verify the issue key/ID.`;
    }

    throw new Error(message);
  }

  const data = (await response.json()) as any;
  const fields = data.fields || {};

  const title = fields.summary || data.key || "Untitled Jira Issue";

  // Parse description: hỗ trợ chuỗi thông thường, rendered HTML hoặc ADF object
  let descriptionText = "";
  if (data.renderedFields?.description) {
    descriptionText = data.renderedFields.description
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .trim();
  } else if (typeof fields.description === "string") {
    descriptionText = fields.description;
  } else if (
    typeof fields.description === "object" &&
    fields.description !== null
  ) {
    descriptionText = parseAdfToMarkdown(fields.description);
  }

  const issueType = fields.issuetype?.name || "Task";
  const priority = fields.priority?.name || "";
  const status = fields.status?.name || "";
  const rawLabels: string[] = Array.isArray(fields.labels) ? fields.labels : [];

  // Tổng hợp labels, bổ sung nhãn gợi ý theo issueType
  const labels: string[] = [...rawLabels];
  if (/bug|defect|incident/i.test(issueType)) {
    if (!labels.includes("bug")) labels.push("bug");
  } else if (/story|feature|enhancement|epic|task/i.test(issueType)) {
    if (!labels.includes("feature")) labels.push("feature");
  }

  // Định dạng nội dung Issue chi tiết cho AI Agent
  let formattedBody = "";
  const metaParts: string[] = [];
  if (issueType) metaParts.push(`**Type:** ${issueType}`);
  if (priority) metaParts.push(`**Priority:** ${priority}`);
  if (status) metaParts.push(`**Status:** ${status}`);
  if (fields.components && fields.components.length > 0) {
    metaParts.push(
      `**Components:** ${fields.components.map((c: any) => c.name).join(", ")}`,
    );
  }

  if (metaParts.length > 0) {
    formattedBody += `${metaParts.join(" | ")}\n\n`;
  }

  if (descriptionText) {
    formattedBody += `### Description\n${descriptionText}\n`;
  } else {
    formattedBody += `*No description provided in Jira.*\n`;
  }

  // Trích xuất comments thảo luận gần nhất nếu có
  const comments = fields.comment?.comments;
  if (Array.isArray(comments) && comments.length > 0) {
    const recentComments = comments.slice(-3);
    formattedBody += `\n### Recent Comments\n`;
    for (const c of recentComments) {
      const author = c.author?.displayName || "User";
      let cBody = "";
      if (typeof c.body === "string") {
        cBody = c.body;
      } else if (typeof c.body === "object" && c.body !== null) {
        cBody = parseAdfToMarkdown(c.body);
      }
      formattedBody += `- **${author}**: ${cBody.trim()}\n`;
    }
  }

  return {
    key: data.key,
    title,
    body: formattedBody.trim(),
    labels,
    issueType,
    status,
    priority,
  };
}

export const getJiraIssueTool = tool(
  async ({ issueId }) => {
    try {
      const issue = await getJiraIssue(issueId);
      return JSON.stringify(issue, null, 2);
    } catch (error: any) {
      return `Failed to fetch Jira issue ${issueId}: ${error.message}`;
    }
  },
  {
    name: "get_jira_issue",
    description:
      "Fetch details, description, labels and comments of a Jira issue by its key or ID (e.g. PROJ-123).",
    schema: z.object({
      issueId: z
        .string()
        .describe("The Jira issue key or ID (e.g. PROJ-123 or 10001)"),
    }),
  },
);
