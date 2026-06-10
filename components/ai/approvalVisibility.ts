export function shouldShowStandaloneApproval(
  approvalId: string,
  approvalChatSessionId: string | null | undefined,
  activeSessionId: string | null | undefined,
) {
  if (!approvalId.startsWith("mcp_approval_")) return false;
  return !approvalChatSessionId || !activeSessionId || approvalChatSessionId === activeSessionId;
}
