type ApprovalVisibilityRequest = {
  toolName?: string;
} | null | undefined;

function isMcpApprovalId(approvalId: string) {
  return approvalId.startsWith("mcp_approval_");
}

export function isPublicMcpApproval(request: ApprovalVisibilityRequest) {
  return typeof request?.toolName === "string" && request.toolName.startsWith("public/");
}

export function shouldShowPublicMcpApproval(
  approvalId: string,
  request: ApprovalVisibilityRequest,
) {
  return isMcpApprovalId(approvalId) && isPublicMcpApproval(request);
}

export function shouldShowStandaloneApproval(
  approvalId: string,
  approvalChatSessionId: string | null | undefined,
  activeSessionId: string | null | undefined,
  request?: ApprovalVisibilityRequest,
) {
  if (!isMcpApprovalId(approvalId)) return false;
  if (isPublicMcpApproval(request)) return false;
  return !approvalChatSessionId || !activeSessionId || approvalChatSessionId === activeSessionId;
}
